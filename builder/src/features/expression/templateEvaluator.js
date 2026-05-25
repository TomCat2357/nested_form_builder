/**
 * テンプレート文字列内の `{ ... }` を alasql 式として評価するエンジン。
 *
 * - `{...}` の中身は `alasqlExpressionEvaluator` に渡される単行式。
 * - バッククォート識別子 `` `field` `` は `preprocessAlaSqlExpression` で `|` を
 *   `__` 化してから評価する。
 * - 同期 API (`resolveTemplate`) は precompile 済み前提。alasql 未ロード or 未
 *   precompile の場合は opts.fallback（既定 ""）を返す。
 * - 初回評価でも結果を出したい場合は `precompileTemplate(template)` を await して
 *   から `resolveTemplate` を呼ぶ。`resolveTemplateAsync` はそのワンショット版。
 *
 * fallback の既定値はフロント (このファイル) では `""`、GAS の nfbEvaluateTemplate_
 * (gas/templateEvaluator.gs) ではトークン原文 (fullToken)。意図的な差異:
 * フロントは substitution フィールド表示・印刷プレビュー用途で空文字が無難、GAS は
 * Drive ファイル名・Google Doc 置換用途で原文を残して問題に気づけるようにするため。
 * なお唯一のフロント呼び出し元 utils/tokenReplacer.js は常に { fallback: "" } を明示渡し。
 */

import { collectBalancedBraces, scanAndReplace, escapeBraces, unescapeBraces, splitTopLevelCommas } from "./templateScanner.js";
import {
  precompileExpressions,
  getCompiledExpressionSync,
  evalExpression,
} from "./alasqlExpressionEvaluator.js";
import { preprocessAlaSqlExpression } from "./preprocessAlaSqlExpression.js";

const NFB_RESERVED_PREFIX = "_";

function normalizeBody(body) {
  return preprocessAlaSqlExpression(String(body || "").trim());
}

/**
 * テンプレート内の全 `{...}` を抽出し、preprocess 済みの式文字列の配列を返す。
 * 重複は保持する（同じ式が複数回登場するケースを再現できるよう）。
 */
export function extractExpressions(template) {
  if (!template || typeof template !== "string") return [];
  const escaped = escapeBraces(template);
  const tokens = collectBalancedBraces(escaped);
  const out = [];
  for (const tok of tokens) {
    const parts = splitTopLevelCommas(tok.body);
    for (const raw of parts) {
      const expr = normalizeBody(raw);
      if (expr) out.push(expr);
    }
  }
  return out;
}

/**
 * テンプレート内の全式を alasql.compile でプリコンパイルしてキャッシュに載せる。
 * 評価直前 / テンプレ保存時 / コンポーネントマウント時に呼ぶ。
 */
export async function precompileTemplate(template) {
  const exprs = extractExpressions(template);
  if (exprs.length === 0) return;
  await precompileExpressions(exprs);
}

// GAS 側の双子は gas/templateEvaluator.gs の nfbTplCoerceToString_。
// 振る舞いを変える場合は両側を揃えること。等価性は tests/coerce-to-string-equivalence.test.cjs で担保。
function coerceResultToString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? String(t) : "";
  }
  if (Array.isArray(value)) {
    return value.map((v) => coerceResultToString(v)).filter((s) => s !== "").join(", ");
  }
  if (typeof value === "object") {
    if (typeof value.name === "string") return value.name;
    try { return JSON.stringify(value); } catch (_e) { return ""; }
  }
  return String(value);
}

/**
 * テスト用 — coerceResultToString を外部から呼べるようにするフック。
 * tests/coerce-to-string-equivalence.test.cjs で GAS 側 nfbTplCoerceToString_ との
 * 等価性を確認するために使う。
 */
export function _coerceResultToStringForTest(value) {
  return coerceResultToString(value);
}

/**
 * 同期テンプレート解決。precompile 済み前提。
 *
 * @param {string} template
 * @param {object} row 単一ブレース `{...}`（元データモード）評価の暗黙コンテキスト
 *                     （buildRowForExpression 済み）
 * @param {object} [opts]
 *   - fallback   評価エラー / 未ロード時の置換値 (既定 "")
 *   - logError   (error, fullToken) => void
 *   - viewRow    連続二重ブレース `{{...}}`（ビューモード）評価用の行。未指定時は row。
 * @returns {string}
 */
export function resolveTemplate(template, row, opts) {
  if (template === undefined || template === null) return "";
  const text = String(template);
  if (!text) return "";
  if (text.indexOf("{") < 0) return text;

  const options = opts || {};
  const fallback = Object.prototype.hasOwnProperty.call(options, "fallback") ? options.fallback : "";
  const logError = typeof options.logError === "function" ? options.logError : null;
  const dataRow = row || {};
  const viewRow = options.viewRow || dataRow;

  const escaped = escapeBraces(text);
  const replaced = scanAndReplace(escaped, (tok) => {
    const tokRow = tok.mode === "view" ? viewRow : dataRow;
    const parts = splitTopLevelCommas(tok.body);
    if (parts.length <= 1) {
      const expr = normalizeBody(tok.body);
      if (!expr) return "";
      const compiled = getCompiledExpressionSync(expr);
      if (!compiled) {
        if (logError) logError(new Error("expression not precompiled: " + expr), tok.fullToken);
        return fallback;
      }
      let value;
      try {
        value = compiled(tokRow);
      } catch (err) {
        if (logError) logError(err, tok.fullToken);
        return fallback;
      }
      if (value === undefined || value === null) return "";
      return coerceResultToString(value);
    }
    const out = [];
    for (const raw of parts) {
      const expr = normalizeBody(raw);
      if (!expr) {
        out.push("");
        continue;
      }
      const compiled = getCompiledExpressionSync(expr);
      if (!compiled) {
        if (logError) logError(new Error("expression not precompiled: " + expr), tok.fullToken);
        return fallback;
      }
      let value;
      try {
        value = compiled(tokRow);
      } catch (err) {
        if (logError) logError(err, tok.fullToken);
        return fallback;
      }
      if (value === undefined || value === null) {
        out.push("");
      } else {
        out.push(coerceResultToString(value));
      }
    }
    return out.join(",");
  });
  return unescapeBraces(replaced);
}

/**
 * 非同期テンプレート解決。precompile を内部で行ってから sync eval する。
 * 呼び出し側を順次 async 化する移行用 API。
 */
export async function resolveTemplateAsync(template, row, opts) {
  if (template === undefined || template === null) return "";
  const text = String(template);
  if (!text) return "";
  if (text.indexOf("{") < 0) return text;

  const options = opts || {};
  const fallback = Object.prototype.hasOwnProperty.call(options, "fallback") ? options.fallback : "";
  const logError = typeof options.logError === "function" ? options.logError : null;
  const dataRow = row || {};
  const viewRow = options.viewRow || dataRow;

  await precompileTemplate(text);

  const escaped = escapeBraces(text);
  const tokens = collectBalancedBraces(escaped);
  const valueByToken = new Map();
  for (const tok of tokens) {
    const tokRow = tok.mode === "view" ? viewRow : dataRow;
    const parts = splitTopLevelCommas(tok.body);
    if (parts.length <= 1) {
      const expr = normalizeBody(tok.body);
      if (!expr) {
        valueByToken.set(tok.fullToken, "");
        continue;
      }
      try {
        const value = await evalExpression(expr, tokRow, { fallback: undefined });
        if (value === undefined) {
          if (logError) logError(new Error("expression eval returned undefined"), tok.fullToken);
          valueByToken.set(tok.fullToken, fallback);
        } else {
          valueByToken.set(tok.fullToken, coerceResultToString(value));
        }
      } catch (err) {
        if (logError) logError(err, tok.fullToken);
        valueByToken.set(tok.fullToken, fallback);
      }
      continue;
    }
    let abort = false;
    const out = [];
    for (const raw of parts) {
      const expr = normalizeBody(raw);
      if (!expr) {
        out.push("");
        continue;
      }
      try {
        const value = await evalExpression(expr, tokRow, { fallback: undefined });
        if (value === undefined) {
          if (logError) logError(new Error("expression eval returned undefined"), tok.fullToken);
          abort = true;
          break;
        }
        out.push(value === null ? "" : coerceResultToString(value));
      } catch (err) {
        if (logError) logError(err, tok.fullToken);
        abort = true;
        break;
      }
    }
    valueByToken.set(tok.fullToken, abort ? fallback : out.join(","));
  }

  const replaced = scanAndReplace(escaped, (tok) => {
    return valueByToken.has(tok.fullToken) ? valueByToken.get(tok.fullToken) : fallback;
  });
  return unescapeBraces(replaced);
}

const BACKTICK_IDENTIFIER_RE = /`([^`]+)`/g;

/**
 * テンプレート内のバッククォート識別子を集めて重複除去 + 予約名（`_` 始まり）
 * を除外したフィールド名一覧を返す。computedFields の依存抽出に使う。
 */
export function extractFieldRefs(template) {
  if (!template || typeof template !== "string") return [];
  const escaped = escapeBraces(template);
  const tokens = collectBalancedBraces(escaped);
  const seen = new Set();
  const out = [];
  for (const tok of tokens) {
    const parts = splitTopLevelCommas(tok.body);
    for (const raw of parts) {
      BACKTICK_IDENTIFIER_RE.lastIndex = 0;
      let m;
      while ((m = BACKTICK_IDENTIFIER_RE.exec(raw)) !== null) {
        const name = m[1];
        if (!name) continue;
        if (name.charAt(0) === NFB_RESERVED_PREFIX) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

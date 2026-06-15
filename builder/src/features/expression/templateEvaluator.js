/**
 * テンプレート文字列内の `{{ ... }}`（ビュー形式）を alasql 式として評価するエンジン。
 * 単一ブレース `{...}`（旧・元データ形式）は廃止され、リテラルとして出力される。
 *
 * - `{{...}}` の中身は `alasqlExpressionEvaluator` に渡される単行式。
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

import { collectBalancedBraces, scanAndReplace, escapeBraces, unescapeBraces, splitTopLevelCommas, findBalancedCloseIndex, isFullQueryBody } from "./templateScanner.js";
import {
  precompileExpressions,
  getCompiledExpressionSync,
  evalExpression,
  compileExpression,
} from "./alasqlExpressionEvaluator.js";
import { preprocessAlaSqlExpression } from "./preprocessAlaSqlExpression.js";
import { coerceResultToString } from "./coerceResultToString.js";

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
    // full-query トークン（先頭 SELECT）は単一スカラ式ではないので式コンパイル対象外。
    // 解決は prefetchQueryTokens（tokenReplacer）で別経路。
    if (isFullQueryBody(tok.body)) continue;
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

// escape 済みテキスト中で対応する `}` を持たない先頭の `{` の位置を返す（無ければ -1）。
function findUnclosedBraceIndex(escapedText) {
  let i = 0;
  const n = escapedText.length;
  while (i < n) {
    if (escapedText.charAt(i) === "{") {
      const close = findBalancedCloseIndex(escapedText, i);
      if (close < 0) return i;
      i = close + 1;
    } else {
      i += 1;
    }
  }
  return -1;
}

/**
 * テンプレート文字列の構文を検証する（フォーム保存前の置換式チェック用）。
 * 1. `{...}` の波括弧が対応しているか（未閉じ `{` がないか）
 * 2. 各式が alasql でコンパイルできるか
 *
 * alasql 自体がロードできない等、構文以外の理由で検証できなかった場合は
 * { ok: true } を返し、保存をブロックしない（誤検知で編集を妨げないため）。
 *
 * @param {string} template
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
export async function validateTemplateSyntax(template) {
  if (template === undefined || template === null) return { ok: true };
  const text = String(template);
  if (!text || text.indexOf("{") < 0) return { ok: true };

  const escaped = escapeBraces(text);
  if (findUnclosedBraceIndex(escaped) >= 0) {
    return { ok: false, message: "波括弧 { } が対応していません（閉じ括弧「}」が不足しています）。" };
  }

  // full-query トークン（先頭 SELECT）は extractExpressions が除外するため、ここでは
  // 式コンパイル検証の対象にならない（フォーム/列インデックスが保存時には無く、
  // false positive で保存をブロックしないための意図的なスキップ）。括弧対応チェックは上で全件実施済み。
  const exprs = extractExpressions(text);
  for (const expr of exprs) {
    try {
      await compileExpression(expr);
    } catch (err) {
      // compileFor が付与する err.expr の有無で「式の構文エラー」と「alasql ロード失敗等」を区別する。
      if (!err || err.expr === undefined) {
        if (typeof console !== "undefined") {
          console.warn("[template] 構文検証をスキップしました:", err && err.message);
        }
        return { ok: true };
      }
      const detail = err && err.message ? err.message.replace(/^alasql compile failed:\s*/, "") : String(err);
      return { ok: false, message: `式「{${expr}}」が解釈できません: ${detail}` };
    }
  }
  return { ok: true };
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
 * @param {object} row `{{...}}`（ビュー形式）評価の暗黙コンテキスト
 *                     （buildRowForExpression 済みの統一 view 行）
 * @param {object} [opts]
 *   - fallback          評価エラー / 未ロード時の置換値 (既定 "")
 *   - logError          (error, fullToken) => void
 *   - queryTokenValues  Map<fullToken, string>。full-query トークン（先頭 SELECT）の
 *                       解決済み値。prefetchQueryTokens（非同期）が事前に用意する。
 *                       無い / 未解決のトークンは fallback になる。
 *   - queryTokensReady  true のとき、未解決 full-query トークンを logError で警告する
 *                       （既定 false）。prefetch が非同期で完了する前の同期 resolve では
 *                       未解決が正常なので、prefetch 完了を呼び出し側が保証できるときだけ true。
 *   - valueTransform    各トークンの解決値（文字列）に適用する後処理 `(str) => str`。
 *                       トークン間のリテラル文字には適用しない。Webhook URL 解決で
 *                       encodeURIComponent を渡し、フィールド値・予約値を自動エンコードする。
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
  const queryTokenValues = options.queryTokenValues instanceof Map ? options.queryTokenValues : null;
  // prefetch が完了している（=未解決トークンは本物の欠落）ことを呼び出し側が保証するフラグ。
  // 既定 false。full-query は非同期 prefetch なので、同期 resolve が prefetch 前に走る初回描画では
  // 未解決が正常。false の間は警告を抑止し、prefetch 完了後の欠落だけ警告する。
  const queryTokensReady = options.queryTokensReady === true;
  const valueTransform = typeof options.valueTransform === "function" ? options.valueTransform : null;
  const apply = (value) => (valueTransform ? valueTransform(String(value === undefined || value === null ? "" : value)) : value);
  const tokRow = row || {};

  const escaped = escapeBraces(text);
  const replaced = scanAndReplace(escaped, (tok) => {
    // full-query トークンは prefetch 済みの値を引くだけ（同期評価しない）。
    if (isFullQueryBody(tok.body)) {
      if (queryTokenValues && queryTokenValues.has(tok.fullToken)) return apply(queryTokenValues.get(tok.fullToken));
      if (logError && queryTokensReady) logError(new Error("full-query token not prefetched: " + tok.fullToken), tok.fullToken);
      return apply(fallback);
    }
    const parts = splitTopLevelCommas(tok.body);
    if (parts.length <= 1) {
      const expr = normalizeBody(tok.body);
      if (!expr) return apply("");
      const compiled = getCompiledExpressionSync(expr);
      if (!compiled) {
        if (logError) logError(new Error("expression not precompiled: " + expr), tok.fullToken);
        return apply(fallback);
      }
      let value;
      try {
        value = compiled(tokRow);
      } catch (err) {
        if (logError) logError(err, tok.fullToken);
        return apply(fallback);
      }
      if (value === undefined || value === null) return apply("");
      return apply(coerceResultToString(value));
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
        return apply(fallback);
      }
      let value;
      try {
        value = compiled(tokRow);
      } catch (err) {
        if (logError) logError(err, tok.fullToken);
        return apply(fallback);
      }
      if (value === undefined || value === null) {
        out.push("");
      } else {
        out.push(coerceResultToString(value));
      }
    }
    return apply(out.join(","));
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
  const queryTokenValues = options.queryTokenValues instanceof Map ? options.queryTokenValues : null;
  const valueTransform = typeof options.valueTransform === "function" ? options.valueTransform : null;
  const apply = (value) => (valueTransform ? valueTransform(String(value === undefined || value === null ? "" : value)) : value);
  const tokRow = row || {};

  await precompileTemplate(text);

  const escaped = escapeBraces(text);
  const tokens = collectBalancedBraces(escaped);
  const valueByToken = new Map();
  for (const tok of tokens) {
    // full-query トークンは prefetch 済みの値を引くだけ（このメソッドでは実行しない）。
    if (isFullQueryBody(tok.body)) {
      if (queryTokenValues && queryTokenValues.has(tok.fullToken)) {
        valueByToken.set(tok.fullToken, queryTokenValues.get(tok.fullToken));
      } else {
        if (logError) logError(new Error("full-query token not prefetched: " + tok.fullToken), tok.fullToken);
        valueByToken.set(tok.fullToken, fallback);
      }
      continue;
    }
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
    return apply(valueByToken.has(tok.fullToken) ? valueByToken.get(tok.fullToken) : fallback);
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

/**
 * テンプレート内のバッククォート予約識別子（`_` 始まり）を集めて重複除去して返す。
 * extractFieldRefs の逆（予約名だけ収集）。Webhook URL の機微トークンゲートに使う。
 */
export function extractReservedRefs(template) {
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
        if (name.charAt(0) !== NFB_RESERVED_PREFIX) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

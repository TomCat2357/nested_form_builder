/**
 * Question SQL 本文の「フォーム参照トークン」だけを フォーム名 ⇔ fileId で双方向に
 * 置換する純関数群。
 *
 * 方針: 参照は fileId（formId）のみで保持する（GUI モード / formSources と対称）。
 *   - 保存時 (formRefsToIds): フォーム名 → fileId に置換して question.json に格納。
 *     リネーム耐性を持たせる。
 *   - 表示時 (formRefsToNames): fileId → フォーム名 に置換してエディタに表示。
 *
 * 置換するのは **テーブル参照トークン** だけ（FROM/JOIN のテーブル名と、修飾付き列参照
 * `[フォーム].[列]` の先頭フォーム部分）。列参照・SQL エイリアス・文字列リテラル・コメントは
 * 触らない。実装は preprocessSql の Pass1/Pass2 を踏襲した軽量版で、共通ユーティリティを再利用する。
 */

import { maskWithPlaceholders } from "./sqlLiteralMask.js";
import { resolveFormRef, formQualifiedName } from "./formIdentifierResolver.js";
import { canonicalDataAlias } from "./sqlPreprocessor.js";
import {
  scanAndReplace,
  isFullQueryBody,
  escapeBraces,
  restoreEscapedBraces,
} from "../../expression/templateScanner.js";
import { traverseSchema } from "../../../core/schemaUtils.js";

/**
 * SQL 内のテーブル参照トークンを mapToken で書き換える。
 * mapToken(ref) が文字列を返したらそのトークンに置換、null/undefined ならそのまま残す。
 *
 * @param {string} sql
 * @param {(ref: string) => (string|null|undefined)} mapToken
 * @returns {string}
 */
function rewriteRefs(sql, mapToken) {
  if (!sql) return sql || "";

  // リテラル / コメントを退避（preprocessSql と同じ呼び方）。[...] / `...` は退避しない。
  const masked = maskWithPlaceholders(sql, {
    includeLineComment: true,
    includeBlockComment: true,
  });
  let work = masked.masked;

  // バッククォート識別子を [...] に正規化（リテラル / コメントは退避済みなので安全）。
  work = work.replace(/`([^`]+)`/g, (_m, name) => "[" + name + "]");

  // Pass 1: FROM/JOIN [ref] のテーブル参照
  work = work.replace(/\b(FROM|JOIN)\b(\s+)\[([^\]]+)\]/gi, (m, kw, ws, ref) => {
    const next = mapToken(ref);
    return next == null ? m : kw + ws + "[" + next + "]";
  });

  // Pass 2: [ref].[col] 修飾付き列参照の先頭 ref（col は不変）
  work = work.replace(/\[([^\]]+)\](\s*\.\s*)\[([^\]]+)\]/g, (m, ref, dot, col) => {
    const next = mapToken(ref);
    return next == null ? m : "[" + next + "]" + dot + "[" + col + "]";
  });

  return masked.unmask(work);
}

/**
 * 保存用: フォーム名（パス / バレ名 / fileId）→ fileId に置換する。
 * resolveFormRef で解決できた参照だけを form.id に置換。未定義 / 曖昧バレ名は
 * 元のまま残す（実行時に従来どおりエラー提示される）。
 *
 * @param {string} sql
 * @param {object} formIndex - buildFormIndex の戻り値
 * @returns {string}
 */
export function formRefsToIds(sql, formIndex) {
  return rewriteRefs(sql, (ref) => {
    const form = resolveFormRef(ref, formIndex);
    return form ? form.id : null;
  });
}

/**
 * 表示用: fileId → フォーム名（formQualifiedName）に置換する。
 * formIndex.byId に一致する参照（＝確かに fileId）だけを置換し、
 * `data` などのエイリアスや既に名前のトークン・未知トークンは素通しする
 * （名前→名前の二重変換や `[data]` の誤変換を避ける）。
 *
 * @param {string} sql
 * @param {object} formIndex - buildFormIndex の戻り値
 * @returns {string}
 */
export function formRefsToNames(sql, formIndex) {
  return rewriteRefs(sql, (ref) => {
    if (!formIndex || !formIndex.byId || !formIndex.byId.has(ref)) return null;
    return formQualifiedName(formIndex.byId.get(ref)) || null;
  });
}

/**
 * GUI→SQL 変換専用: compileStages が出力する canonical alias（`FROM data_<id>`）を
 * エディタ表示用の `[フォーム名]` に寄せる。手書き SQL と同じ表示規約に揃えるため、
 * まず `data_<id>` を `[<fileId>]` に正規化し、続いて formRefsToNames で名前化する。
 * 保存時は formRefsToIds が `[フォーム名]` → `[fileId]` に戻すのでリネーム耐性も保たれる。
 *
 * @param {string} sql - compileStages が返した SQL
 * @param {string} formId - GUI で選択されていたフォームの fileId
 * @param {object} formIndex - buildFormIndex の戻り値
 * @returns {string}
 */
export function canonicalAliasToName(sql, formId, formIndex) {
  if (!sql || !formId) return sql || "";
  const canon = canonicalDataAlias(formId);
  const escaped = canon.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bracketed = sql.replace(
    new RegExp("\\b(FROM|JOIN)\\b(\\s+)" + escaped + "\\b", "gi"),
    (_m, kw, ws) => kw + ws + "[" + formId + "]",
  );
  return formRefsToNames(bracketed, formIndex);
}

// ---------------------------------------------------------------------------
// テンプレート文字列（`{{ ... }}`）に埋め込まれた full-query トークン（本文先頭
// SELECT）の **フォーム参照だけ** を双方向置換する。式トークン・地のテキスト・著者
// エスケープ `\{` `\}` は逐語のまま残す。フォーム編集時の「保存=fileId / 表示=論理パス」
// ラウンドトリップ用（Question SQL の formRefsToIds/Names と対称）。
// ---------------------------------------------------------------------------

/**
 * テンプレート文字列中の full-query トークン本文だけを transformSql で書き換える。
 *
 * - `escapeBraces` で著者エスケープ `\{` `\}` を退避してから走査するので、エスケープ列が
 *   誤ってトークン開始扱いされない。最後に `restoreEscapedBraces` で `\{` `\}` を逐語復元する。
 * - full-query 本文（`tok.body`）は退避マーカ込みのまま transformSql に渡す。form 参照書換は
 *   FROM/JOIN 後の `[..]` と `[form].[col]` 先頭しか触らず、マーカ（NFB_LBRACE 等）は
 *   `[..]` 外の素のテキストなので影響を受けない（= unescape/re-escape の往復破損を避ける）。
 * - 非 full-query トークンは `tok.fullToken` を逐語返却。
 *
 * @param {string} template
 * @param {(sql: string) => string} transformSql
 * @returns {string}
 */
function rewriteTemplateFullQueries(template, transformSql) {
  if (template === undefined || template === null) return "";
  const text = String(template);
  if (!text || text.indexOf("{") < 0) return text;
  const escaped = escapeBraces(text);
  const replaced = scanAndReplace(escaped, (tok) => {
    if (!isFullQueryBody(tok.body)) return tok.fullToken;
    return "{{" + transformSql(tok.body) + "}}";
  });
  return restoreEscapedBraces(replaced);
}

/**
 * 保存用: テンプレ内 full-query のフォーム参照（パス / バレ名）→ fileId に置換。
 * @param {string} template
 * @param {object} formIndex - buildFormIndex の戻り値
 * @returns {string}
 */
export function templateFormRefsToIds(template, formIndex) {
  return rewriteTemplateFullQueries(template, (sql) => formRefsToIds(sql, formIndex));
}

/**
 * 表示用: テンプレ内 full-query の fileId → フォーム名（論理パス）に置換。
 * @param {string} template
 * @param {object} formIndex - buildFormIndex の戻り値
 * @returns {string}
 */
export function templateFormRefsToNames(template, formIndex) {
  return rewriteTemplateFullQueries(template, (sql) => formRefsToNames(sql, formIndex));
}

// full-query を埋め込めるテンプレ文字列キー（substitution / printTemplate）。
const PRINT_TEMPLATE_KEYS = [
  "fileNameTemplate",
  "gmailTemplateTo",
  "gmailTemplateCc",
  "gmailTemplateBcc",
  "gmailTemplateSubject",
  "gmailTemplateBody",
];

/**
 * スキーマ（深いネスト込み）を deep clone し、テンプレ文字列キーに mapStr を適用した
 * 新スキーマを返す（入力は非破壊）。スキーマは JSON シリアライズ可能。
 *
 * @param {Array} schema
 * @param {(template: string) => string} mapStr
 * @returns {Array}
 */
function mapSchemaTemplates(schema, mapStr) {
  if (!Array.isArray(schema)) return schema;
  const clone = JSON.parse(JSON.stringify(schema));
  traverseSchema(clone, (field) => {
    if (!field || typeof field !== "object") return;
    if (field.type === "substitution" && typeof field.templateText === "string") {
      field.templateText = mapStr(field.templateText);
    }
    if (field.type === "printTemplate" && field.printTemplateAction && typeof field.printTemplateAction === "object") {
      const action = field.printTemplateAction;
      for (const key of PRINT_TEMPLATE_KEYS) {
        if (typeof action[key] === "string") action[key] = mapStr(action[key]);
      }
    }
  });
  return clone;
}

/**
 * 設定（form.settings）を浅く clone し、full-query を埋め込めるテンプレ設定キーに
 * mapStr を適用して返す（入力は非破壊）。対象は standardPrintFileNameTemplate のみ。
 *
 * @param {object} settings
 * @param {(template: string) => string} mapStr
 * @returns {object}
 */
function mapSettingsTemplates(settings, mapStr) {
  if (!settings || typeof settings !== "object") return settings;
  const clone = { ...settings };
  if (typeof clone.standardPrintFileNameTemplate === "string") {
    clone.standardPrintFileNameTemplate = mapStr(clone.standardPrintFileNameTemplate);
  }
  return clone;
}

/** 保存用: スキーマ内全テンプレの full-query フォーム参照を fileId 化。 */
export function schemaTemplateFormRefsToIds(schema, formIndex) {
  return mapSchemaTemplates(schema, (t) => templateFormRefsToIds(t, formIndex));
}

/** 表示用: スキーマ内全テンプレの full-query フォーム参照を論理パス化。 */
export function schemaTemplateFormRefsToNames(schema, formIndex) {
  return mapSchemaTemplates(schema, (t) => templateFormRefsToNames(t, formIndex));
}

/** 保存用: 設定内テンプレの full-query フォーム参照を fileId 化。 */
export function settingsTemplateFormRefsToIds(settings, formIndex) {
  return mapSettingsTemplates(settings, (t) => templateFormRefsToIds(t, formIndex));
}

/** 表示用: 設定内テンプレの full-query フォーム参照を論理パス化。 */
export function settingsTemplateFormRefsToNames(settings, formIndex) {
  return mapSettingsTemplates(settings, (t) => templateFormRefsToNames(t, formIndex));
}

/**
 * 表示用: formLink フィールドの表示キャッシュ childFormPath を、安定 ID childFormId から
 * 現在の論理パスに再計算する（リネーム追従）。childFormId 解決不可なら現状維持。
 * 表示専用で childFormId / 評価には無影響。入力は非破壊（deep clone）。
 *
 * @param {Array} schema
 * @param {object} formIndex - buildFormIndex の戻り値
 * @returns {Array}
 */
export function refreshFormLinkPaths(schema, formIndex) {
  if (!Array.isArray(schema)) return schema;
  if (!formIndex || !formIndex.byId) return schema;
  const clone = JSON.parse(JSON.stringify(schema));
  traverseSchema(clone, (field) => {
    if (!field || field.type !== "formLink") return;
    const id = typeof field.childFormId === "string" ? field.childFormId : "";
    if (!id || !formIndex.byId.has(id)) return;
    const path = formQualifiedName(formIndex.byId.get(id));
    if (path) field.childFormPath = path;
  });
  return clone;
}

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

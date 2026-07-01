/**
 * テンプレート full-query モード（`{{SELECT ...}}`）専用の SQL 前処理 / 結果整形。
 *
 * - `substituteCurrentIdLiteral`: 裸の `_id`（現レコード ID 記号）を、AlaSQL 解析前に
 *   現レコード ID のクォート済み文字列リテラルへ置換する。文字列リテラル / コメント /
 *   `[...]` / `` `...` `` 内の `_id` は退避して触らない（sqlLiteralMask を流用）。
 *   現フォーム記号 `_form` は preprocessSql 側で解決するため本モジュールでは扱わない。
 * - `collapseQueryResult`: クエリ結果（行 × 列）を 1 つのテンプレート文字列へ畳む
 *   （空セルも位置を保ったまま連結する）。
 *
 * パイプライン（呼び出し側 prefetchQueryTokens）:
 *   1. substituteCurrentIdLiteral(rawBody, recordId)
 *   2. preprocessSql(step1, { defaultFormId, formIndex, getColumnIndex })  ← _form / [col] 解決
 *   3. runAlaSql(transformedSql) → collapseQueryResult(rows, columns)
 */

import { ensureArray } from "../../utils/arrays.js";
import { maskWithPlaceholders } from "../analytics/utils/sqlLiteralMask.js";
import { coerceResultToString } from "./coerceResultToString.js";

// 裸の `_id` トークン（前後が識別子文字 [\w$] / `.` でない）にだけマッチする。
// `[_id]` / `` `_id` `` / `'_id'` / `-- _id` は事前マスクで保護されるのでここには来ない。
// `x_id` / `_idx` / `a._id` / `_id.b` は lookbehind / lookahead で除外。
const BARE_CURRENT_ID_RE = /(?<![\w$.])_id(?![\w$.])/g;

/**
 * SQL 中の裸 `_id` を現レコード ID のクォート済みリテラルへ置換する。
 * @param {string} sql full-query 本文（trim 済み想定）
 * @param {string} recordId 現レコード ID
 * @returns {string}
 */
export function substituteCurrentIdLiteral(sql, recordId) {
  const src = sql == null ? "" : String(sql);
  if (!src) return "";
  // 文字列リテラル / 行・ブロックコメント / [...] / `...` を退避してから置換する。
  const masked = maskWithPlaceholders(src, {
    includeLineComment: true,
    includeBlockComment: true,
    includeBracket: true,
    includeBacktick: true,
  });
  const literal = "'" + String(recordId == null ? "" : recordId).replace(/'/g, "''") + "'";
  const replaced = masked.masked.replace(BARE_CURRENT_ID_RE, literal);
  return masked.unmask(replaced);
}

/**
 * full-query の結果（行配列 + 列名）を 1 つのテンプレート文字列へ畳む。
 * - 0 行 → ""
 * - 1 行 × 1 列 → そのスカラ（coerceResultToString）
 * - それ以外 → 行優先で全セルを coerce し、空文字も含めて位置を保ったまま ", " 連結
 *
 * @param {Array<object>} rows
 * @param {string[]} columns 列名（初出順）
 * @returns {string}
 */
export function collapseQueryResult(rows, columns) {
  const list = ensureArray(rows);
  if (list.length === 0) return "";
  const cols = Array.isArray(columns) && columns.length > 0
    ? columns
    : Object.keys(list[0] || {});
  if (list.length === 1 && cols.length === 1) {
    return coerceResultToString(list[0] ? list[0][cols[0]] : undefined);
  }
  const cells = [];
  for (const row of list) {
    for (const col of cols) {
      cells.push(coerceResultToString(row ? row[col] : undefined));
    }
  }
  return cells.join(", ");
}

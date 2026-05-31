/**
 * ダッシュボード共通フィルタの値 → 各カードへの WHERE 句生成 + 実行ラッパ。
 *
 * Question 側の SQL/GUI は変更せず、`executeQuestion` の結果行 (rows) に対して
 * AlaSQL の外側 SELECT で WHERE をかぶせる「結果フィルタ」方式で動かす。
 *
 * 値は parameterized (`?`) で AlaSQL に渡す。識別子 (列名) のみ手動で `[col]` で囲む。
 */

import { executeQuestion } from "./analyticsStore.js";
import { runAlaSqlOnArray } from "./analyticsAlaSql.js";
import { bracketIdent } from "../expression/sqlEmit.js";
import { formatCanonical } from "../../utils/dateTime.js";
import { isPlainObject } from "../../utils/objectShape.js";

function isMeaningfulValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (isPlainObject(v)) {
    return Object.values(v).some((x) => x !== null && x !== undefined && x !== "");
  }
  return true;
}

// LIKE パターンのワイルドカード `%` `_` と `\` をエスケープする。
// これで `[col] LIKE ? ESCAPE '\\'` でユーザ入力をリテラルとして扱える。
function escapeLikePattern(s) {
  return String(s).replace(/[\\%_]/g, "\\$&");
}

/**
 * 1 つの (filter, value, mapping) を { clause, params } に変換する。
 * mapping.column は AlaSQL カラム名 (Question 結果列名)。
 * @returns {{clause: string, params: any[]} | null}
 */
function buildOneClause(filter, value, mapping) {
  if (!isMeaningfulValue(value)) return null;
  if (!mapping || !mapping.column) return null;
  const col = bracketIdent(mapping.column);

  switch (filter.type) {
    case "dateRange": {
      const parts = [];
      const params = [];
      const from = formatCanonical(value.from, "date");
      const to = formatCanonical(value.to, "date");
      if (from) { parts.push(col + " >= ?"); params.push(from); }
      if (to) { parts.push(col + " <= ?"); params.push(to); }
      return parts.length > 0 ? { clause: parts.join(" AND "), params } : null;
    }
    case "numberRange": {
      const parts = [];
      const params = [];
      const minV = value.min;
      const maxV = value.max;
      if (minV !== null && minV !== undefined && minV !== "") {
        const n = Number(minV);
        if (Number.isFinite(n)) { parts.push(col + " >= ?"); params.push(n); }
      }
      if (maxV !== null && maxV !== undefined && maxV !== "") {
        const n = Number(maxV);
        if (Number.isFinite(n)) { parts.push(col + " <= ?"); params.push(n); }
      }
      return parts.length > 0 ? { clause: parts.join(" AND "), params } : null;
    }
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? { clause: col + " = ?", params: [n] } : null;
    }
    case "text": {
      // ユーザ入力の `%` `_` `\` をエスケープして部分一致リテラルとして扱う
      const pattern = "%" + escapeLikePattern(value) + "%";
      return { clause: col + " LIKE ? ESCAPE '\\'", params: [pattern] };
    }
    case "category": {
      if (Array.isArray(value)) {
        if (value.length === 0) return null;
        const placeholders = value.map(() => "?").join(",");
        return { clause: col + " IN (" + placeholders + ")", params: value.slice() };
      }
      return { clause: col + " = ?", params: [value] };
    }
    default:
      return null;
  }
}

/**
 * ダッシュボード簡易フィルタ (simpleFilters) と入力値 (simpleFilterValues) から、
 * 元レコードテーブルへ適用するクローズ配列を生成する。
 * 各項目の min / max を valueType で正規化し、min は `>=`、max は `<=` のクローズにする。
 * 値が無い項目はスキップ。列名 (col) は元テーブルの AlaSQL safe key。
 *
 * @param {Array<{id, column, valueType}>} simpleFilters
 * @param {Object<string, {min, max}>} simpleFilterValues - filterId -> { min, max }
 * @returns {Array<{ col: string, comparator: string, value: any }>}
 */
export function buildSimpleFilterClauses(simpleFilters, simpleFilterValues) {
  if (!Array.isArray(simpleFilters) || simpleFilters.length === 0) return [];
  const clauses = [];
  for (const f of simpleFilters) {
    if (!f || !f.column) continue;
    const v = simpleFilterValues ? simpleFilterValues[f.id] : undefined;
    if (!v || typeof v !== "object") continue;
    const minNorm = normalizeSimpleValue(v.min, f.valueType);
    const maxNorm = normalizeSimpleValue(v.max, f.valueType);
    if (minNorm !== null) clauses.push({ col: f.column, comparator: ">=", value: minNorm });
    if (maxNorm !== null) clauses.push({ col: f.column, comparator: "<=", value: maxNorm });
  }
  return clauses;
}

// 簡易フィルタの入力値を valueType に合わせて正規化する。空値は null（クローズ不生成）。
function normalizeSimpleValue(raw, valueType) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  if (valueType === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (valueType === "date") {
    // canonical "YYYY-MM-DD"（辞書順=時系列順）に寄せて元テーブルの date 列と比較可能にする。
    return formatCanonical(raw, "date") ?? null;
  }
  // text: 文字列としてそのまま（辞書順比較）
  return String(raw);
}

/**
 * ダッシュボードフィルタとフィルタ値、カードの filterMappings から
 * そのカードに適用すべき WHERE 句 (AND 結合) と parameter 配列を生成する。
 * @returns {{where: string, params: any[]}} where が空文字なら適用フィルタなし
 */
export function buildCardFilterWhereClause(card, dashboardFilters, filterValues) {
  if (!card || !card.filterMappings) return { where: "", params: [] };
  const filtersById = new Map((dashboardFilters || []).map((f) => [f.id, f]));
  const clauses = [];
  const params = [];
  for (const filterId in card.filterMappings) {
    if (!Object.prototype.hasOwnProperty.call(card.filterMappings, filterId)) continue;
    const filter = filtersById.get(filterId);
    if (!filter) continue;
    const mapping = card.filterMappings[filterId];
    const value = filterValues ? filterValues[filterId] : undefined;
    const built = buildOneClause(filter, value, mapping);
    if (!built) continue;
    clauses.push(built.clause);
    for (const p of built.params) params.push(p);
  }
  return { where: clauses.join(" AND "), params };
}

/**
 * Question を実行してダッシュボードのフィルタ値を結果行に適用する。
 * @returns {Promise<{ ok: boolean, rows?: Array, columns?: Array, compiledColumns?: Array, fallbackTypeMap?: Map<string,string>|object, error?: string }>}
 */
export async function executeDashboardCard(question, card, dashboardFilters, filterValues, { forms, globalWhereExpr, simpleFilters, simpleFilterValues } = {}) {
  // 簡易フィルタは元レコードテーブル側に適用する（その列を持つカードにだけ効く）。
  const sourceFilterClauses = buildSimpleFilterClauses(simpleFilters, simpleFilterValues);
  const baseResult = await executeQuestion(question, { forms, globalWhereExpr, sourceFilterClauses });
  if (!baseResult.ok) return baseResult;

  const { where, params } = buildCardFilterWhereClause(card, dashboardFilters, filterValues);
  if (!where) return baseResult;

  const filtered = await runAlaSqlOnArray(baseResult.rows || [], "SELECT * FROM ? WHERE " + where, params);
  if (!filtered.ok) {
    return { ok: false, error: "フィルタ適用に失敗しました: " + filtered.error };
  }
  return {
    ok: true,
    rows: filtered.rows,
    columns: filtered.columns.length > 0 ? filtered.columns : (baseResult.columns || []),
    compiledColumns: baseResult.compiledColumns,
    fallbackTypeMap: baseResult.fallbackTypeMap,
    compiledSql: baseResult.compiledSql,
  };
}

/**
 * alasql 式 / クエリの戻り値をテンプレート用文字列へ変換する共通ユーティリティ。
 *
 * 式モード（templateEvaluator.resolveTemplate）と full-query モード
 * （fullQuerySql.collapseQueryResult）の双方が同じ変換規則を共有するため、
 * 1 箇所に切り出している（循環 import を避ける目的もある）。
 *
 * GAS 側の双子は gas/templateEvaluator.gs の nfbTplCoerceToString_。
 * 振る舞いを変える場合は両側を揃えること。等価性は
 * tests/coerce-to-string-equivalence.test.cjs で担保。
 */

export function coerceResultToString(value) {
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

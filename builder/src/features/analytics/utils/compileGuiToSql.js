import { headerKeyToAlaSqlKey } from "./headerToAlaSqlKey.js";
import { canonicalFormAlias } from "./sqlPreprocessor.js";

const NUMERIC_OPERATORS = new Set([">", ">=", "<", "<=", "between"]);
const STRING_OPERATORS = new Set(["contains", "startsWith"]);
const NO_VALUE_OPERATORS = new Set(["isNull", "isNotNull"]);

function quoteString(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function formatLiteral(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const num = Number(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(num) && String(num) === value.trim()) {
    return String(num);
  }
  return quoteString(value);
}

function formatNumeric(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return String(num);
}

function bracketColumn(alaSqlKey) {
  return "[" + alaSqlKey + "]";
}

function dimensionExpression(group, snapshotIndex) {
  const col = snapshotIndex.get(group.column);
  const alaSqlKey = col ? col.alaSqlKey : headerKeyToAlaSqlKey(group.column);
  const bracketed = bracketColumn(alaSqlKey);
  if (group.bucket === "month") {
    return { expr: "SUBSTRING(" + bracketed + ", 1, 7)", alias: alaSqlKey + "__month" };
  }
  if (group.bucket === "year") {
    return { expr: "SUBSTRING(" + bracketed + ", 1, 4)", alias: alaSqlKey + "__year" };
  }
  return { expr: bracketed, alias: alaSqlKey };
}

function aggregationExpression(agg, snapshotIndex) {
  const id = agg.id || "agg";
  if (agg.type === "count") {
    return { expr: "COUNT(*)", alias: id, ok: true };
  }
  if (!agg.column) {
    return { ok: false, error: "集計対象の列が指定されていません: " + agg.type };
  }
  const col = snapshotIndex.get(agg.column);
  const alaSqlKey = col ? col.alaSqlKey : headerKeyToAlaSqlKey(agg.column);
  const bracketed = bracketColumn(alaSqlKey);
  if (agg.type === "countNotNull") return { expr: "COUNT(" + bracketed + ")", alias: id, ok: true };
  if (agg.type === "sum") return { expr: "SUM(" + bracketed + ")", alias: id, ok: true };
  if (agg.type === "avg") return { expr: "AVG(" + bracketed + ")", alias: id, ok: true };
  if (agg.type === "min") return { expr: "MIN(" + bracketed + ")", alias: id, ok: true };
  if (agg.type === "max") return { expr: "MAX(" + bracketed + ")", alias: id, ok: true };
  return { ok: false, error: "未対応の集計種別: " + agg.type };
}

function filterExpression(filter, snapshotIndex) {
  if (!filter || !filter.column || !filter.operator) {
    return { ok: false, error: "フィルター列または演算子が未指定です" };
  }
  const col = snapshotIndex.get(filter.column);
  const alaSqlKey = col ? col.alaSqlKey : headerKeyToAlaSqlKey(filter.column);
  const bracketed = bracketColumn(alaSqlKey);
  const op = filter.operator;

  if (op === "isNull") return { ok: true, expr: bracketed + " IS NULL" };
  if (op === "isNotNull") return { ok: true, expr: bracketed + " IS NOT NULL" };

  if (op === "between") {
    const a = formatNumeric(filter.value);
    const b = formatNumeric(filter.value2);
    if (a === null || b === null) return { ok: false, error: "between には数値 2 つが必要です" };
    return { ok: true, expr: bracketed + " BETWEEN " + a + " AND " + b };
  }

  if (op === "in") {
    const values = Array.isArray(filter.value) ? filter.value : [];
    if (values.length === 0) return { ok: false, error: "in には 1 つ以上の値が必要です" };
    const literals = values.map(formatLiteral).join(", ");
    return { ok: true, expr: bracketed + " IN (" + literals + ")" };
  }

  if (op === "contains") {
    return { ok: true, expr: bracketed + " LIKE " + quoteString("%" + (filter.value ?? "") + "%") };
  }
  if (op === "startsWith") {
    return { ok: true, expr: bracketed + " LIKE " + quoteString((filter.value ?? "") + "%") };
  }

  if (NUMERIC_OPERATORS.has(op)) {
    const v = formatNumeric(filter.value);
    if (v === null) return { ok: false, error: op + " には数値が必要です" };
    return { ok: true, expr: bracketed + " " + op + " " + v };
  }

  if (op === "=" || op === "!=") {
    return { ok: true, expr: bracketed + " " + op + " " + formatLiteral(filter.value) };
  }

  return { ok: false, error: "未対応の演算子: " + op };
}

function orderByExpression(order, dimAliases, aggAliases) {
  if (!order || !order.ref) return null;
  const direction = order.direction === "desc" ? "DESC" : "ASC";
  const ref = String(order.ref);
  if (ref.startsWith("agg:")) {
    const id = ref.slice(4);
    if (!aggAliases.has(id)) return null;
    return "[" + id + "] " + direction;
  }
  if (ref.startsWith("col:")) {
    const colKey = ref.slice(4);
    const alaSqlKey = headerKeyToAlaSqlKey(colKey);
    if (!dimAliases.has(alaSqlKey)) return null;
    return "[" + alaSqlKey + "] " + direction;
  }
  return null;
}

export function compileGuiToSql(gui, opts) {
  const options = opts || {};
  const snapshotColumns = Array.isArray(options.snapshotColumns) ? options.snapshotColumns : [];
  const snapshotIndex = new Map();
  for (const col of snapshotColumns) {
    if (col && col.key) snapshotIndex.set(col.key, col);
  }

  const errors = [];

  if (!gui || !gui.formId) errors.push("フォームが選択されていません");
  const aggs = Array.isArray(gui?.aggregations) ? gui.aggregations : [];
  if (aggs.length === 0) errors.push("集計を 1 つ以上追加してください");

  if (errors.length > 0) return { ok: false, errors };

  const groupBy = Array.isArray(gui.groupBy) ? gui.groupBy : [];
  const filters = Array.isArray(gui.filters) ? gui.filters : [];
  const orderBy = Array.isArray(gui.orderBy) ? gui.orderBy : [];

  const selectParts = [];
  const groupByExprs = [];
  const dimColumns = [];
  const dimAliases = new Set();

  for (const g of groupBy) {
    if (!g || !g.column) continue;
    const dim = dimensionExpression(g, snapshotIndex);
    selectParts.push(dim.expr + " AS [" + dim.alias + "]");
    groupByExprs.push(dim.expr);
    dimColumns.push({ name: dim.alias, role: "dimension" });
    dimAliases.add(dim.alias);
  }

  const metricColumns = [];
  const aggAliases = new Set();
  for (const a of aggs) {
    const r = aggregationExpression(a, snapshotIndex);
    if (!r.ok) {
      errors.push(r.error);
      continue;
    }
    selectParts.push(r.expr + " AS [" + r.alias + "]");
    metricColumns.push({ name: r.alias, role: "metric", aggId: r.alias, aggType: a.type });
    aggAliases.add(r.alias);
  }

  const whereParts = [];
  for (const f of filters) {
    if (!f || !f.column || !f.operator) continue;
    const r = filterExpression(f, snapshotIndex);
    if (!r.ok) {
      errors.push(r.error);
      continue;
    }
    whereParts.push(r.expr);
  }

  if (errors.length > 0) return { ok: false, errors };

  const tableAlias = canonicalFormAlias(gui.formId);
  let sql = "SELECT " + selectParts.join(", ") + " FROM " + tableAlias;

  if (whereParts.length > 0) sql += " WHERE " + whereParts.join(" AND ");
  if (groupByExprs.length > 0) sql += " GROUP BY " + groupByExprs.join(", ");

  const orderParts = [];
  for (const o of orderBy) {
    const expr = orderByExpression(o, dimAliases, aggAliases);
    if (expr) orderParts.push(expr);
  }
  if (orderParts.length > 0) sql += " ORDER BY " + orderParts.join(", ");

  if (typeof gui.limit === "number" && gui.limit > 0) {
    sql += " LIMIT " + Math.floor(gui.limit);
  }

  return {
    ok: true,
    sql,
    columns: dimColumns.concat(metricColumns),
  };
}

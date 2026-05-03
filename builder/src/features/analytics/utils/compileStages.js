/**
 * v2 ステージ配列を AlaSQL に流せる単一の SELECT 文へコンパイルする。
 *
 * 入力:
 *   query = { schemaVersion, stages: Stage[] }
 *   opts  = { snapshotColumns?: [{ key, alaSqlKey, path, label }] }
 *
 * 出力:
 *   { ok: true,  sql: string, columns: ColumnMeta[] }
 *   { ok: false, errors: string[] }
 *
 * Step 1 でサポートするステージ:
 *   pick_data → filter* → summarize? → filter* → sort? → limit?
 * の "フラット形" のみ。これは v1 形式（migrateLegacyGui の出力）と一致する。
 *
 * 後続ステップで対応する範囲:
 *   Step 4: 同種ブロック複数 / 任意順序 → サブクエリ畳み込み
 *   Step 5: custom_columns
 *   Step 6: join
 *   Step 7: pick_data.source.kind === "question"
 */

import { headerKeyToAlaSqlKey } from "./headerToAlaSqlKey.js";
import { canonicalFormAlias } from "./sqlPreprocessor.js";
import { assertAggColumnType } from "./aggregationCompatibility.js";

const NUMERIC_OPERATORS = new Set([">", ">=", "<", "<=", "between"]);

function bracketColumn(alaSqlKey) {
  return "[" + alaSqlKey + "]";
}

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

function buildSnapshotIndex(snapshotColumns) {
  const index = new Map();
  for (const col of snapshotColumns || []) {
    if (col && col.key) index.set(col.key, col);
  }
  return index;
}

function resolveAlaSqlKey(columnKey, snapshotIndex) {
  if (!columnKey) return "";
  const col = snapshotIndex.get(columnKey);
  return col ? col.alaSqlKey : headerKeyToAlaSqlKey(columnKey);
}

function dimensionExpression(group, snapshotIndex) {
  const alaSqlKey = resolveAlaSqlKey(group.column, snapshotIndex);
  const bracketed = bracketColumn(alaSqlKey);
  // 日付列は ISO 文字列 (YYYY-MM-DD...) 想定で SUBSTRING で切り出す。
  // quarter / week は AlaSQL の DATE 関数挙動が不安定なため後続ステップで対応。
  if (group.bucket === "year") {
    return { expr: "SUBSTRING(" + bracketed + ", 1, 4)", alias: alaSqlKey + "__year" };
  }
  if (group.bucket === "month") {
    return { expr: "SUBSTRING(" + bracketed + ", 1, 7)", alias: alaSqlKey + "__month" };
  }
  if (group.bucket === "day") {
    return { expr: "SUBSTRING(" + bracketed + ", 1, 10)", alias: alaSqlKey + "__day" };
  }
  return { expr: bracketed, alias: alaSqlKey };
}

function aggregationExpression(agg, snapshotIndex) {
  const id = agg.id || "agg";
  if (agg.type === "count") {
    return { ok: true, expr: "COUNT(*)", alias: id };
  }
  if (!agg.column) {
    return { ok: false, error: "集計対象の列が指定されていません: " + agg.type };
  }
  const alaSqlKey = resolveAlaSqlKey(agg.column, snapshotIndex);
  const bracketed = bracketColumn(alaSqlKey);
  if (agg.type === "countNotNull") return { ok: true, expr: "COUNT(" + bracketed + ")", alias: id };
  if (agg.type === "sum") return { ok: true, expr: "SUM(" + bracketed + ")", alias: id };
  if (agg.type === "avg") return { ok: true, expr: "AVG(" + bracketed + ")", alias: id };
  if (agg.type === "min") return { ok: true, expr: "MIN(" + bracketed + ")", alias: id };
  if (agg.type === "max") return { ok: true, expr: "MAX(" + bracketed + ")", alias: id };
  return { ok: false, error: "未対応の集計種別: " + agg.type };
}

function filterConditionExpression(cond, snapshotIndex) {
  if (!cond || !cond.column || !cond.operator) {
    return { ok: false, error: "フィルター列または演算子が未指定です" };
  }
  const alaSqlKey = resolveAlaSqlKey(cond.column, snapshotIndex);
  const bracketed = bracketColumn(alaSqlKey);
  const op = cond.operator;

  if (op === "isNull") return { ok: true, expr: bracketed + " IS NULL" };
  if (op === "isNotNull") return { ok: true, expr: bracketed + " IS NOT NULL" };

  if (op === "between") {
    const a = formatNumeric(cond.value);
    const b = formatNumeric(cond.value2);
    if (a === null || b === null) return { ok: false, error: "between には数値 2 つが必要です" };
    return { ok: true, expr: bracketed + " BETWEEN " + a + " AND " + b };
  }

  if (op === "in") {
    const values = Array.isArray(cond.value) ? cond.value : [];
    if (values.length === 0) return { ok: false, error: "in には 1 つ以上の値が必要です" };
    const literals = values.map(formatLiteral).join(", ");
    return { ok: true, expr: bracketed + " IN (" + literals + ")" };
  }

  if (op === "contains") {
    return { ok: true, expr: bracketed + " LIKE " + quoteString("%" + (cond.value ?? "") + "%") };
  }
  if (op === "startsWith") {
    return { ok: true, expr: bracketed + " LIKE " + quoteString((cond.value ?? "") + "%") };
  }

  if (NUMERIC_OPERATORS.has(op)) {
    const v = formatNumeric(cond.value);
    if (v === null) return { ok: false, error: op + " には数値が必要です" };
    return { ok: true, expr: bracketed + " " + op + " " + v };
  }

  if (op === "=" || op === "!=") {
    return { ok: true, expr: bracketed + " " + op + " " + formatLiteral(cond.value) };
  }

  return { ok: false, error: "未対応の演算子: " + op };
}

function sortEntryExpression(entry, dimAliases, aggAliases, snapshotIndex) {
  if (!entry || !entry.column) return null;
  const direction = entry.direction === "desc" ? "DESC" : "ASC";
  const col = String(entry.column);

  // 1. agg のエイリアスに直接マッチ
  if (aggAliases.has(col)) return "[" + col + "] " + direction;
  // 2. dimension のエイリアスに直接マッチ
  if (dimAliases.has(col)) return "[" + col + "] " + direction;
  // 3. パイプ区切りの列キーを alaSqlKey に変換してマッチ
  const ala = resolveAlaSqlKey(col, snapshotIndex);
  if (dimAliases.has(ala)) return "[" + ala + "] " + direction;
  if (aggAliases.has(ala)) return "[" + ala + "] " + direction;
  return null;
}

/**
 * stages を種別ごとに分類する。Step 1 の制約「フラット形」のチェックも行う。
 */
function categorizeFlatStages(stages) {
  const errors = [];
  if (!Array.isArray(stages) || stages.length === 0) {
    return { ok: false, errors: ["ステージが定義されていません"] };
  }
  const pickData = stages[0];
  if (!pickData || pickData.type !== "pick_data") {
    return { ok: false, errors: ["最初のステージは pick_data である必要があります"] };
  }

  const filtersBefore = [];
  const filtersAfter = [];
  let summarize = null;
  let sort = null;
  let limit = null;
  let phase = "before"; // before | after-summarize | post-sort

  for (let i = 1; i < stages.length; i++) {
    const s = stages[i];
    if (!s || !s.type) continue;

    if (s.type === "filter") {
      if (phase === "before") filtersBefore.push(s);
      else if (phase === "after-summarize") filtersAfter.push(s);
      else errors.push("filter は sort/limit より前に置く必要があります");
      continue;
    }
    if (s.type === "summarize") {
      if (summarize) {
        errors.push("複数の summarize は Step 4 で対応予定です");
        continue;
      }
      summarize = s;
      phase = "after-summarize";
      continue;
    }
    if (s.type === "sort") {
      if (sort) errors.push("複数の sort はサポートしていません");
      sort = s;
      phase = "post-sort";
      continue;
    }
    if (s.type === "limit") {
      if (limit) errors.push("複数の limit はサポートしていません");
      if (i !== stages.length - 1) errors.push("limit は最後のステージである必要があります");
      limit = s;
      continue;
    }
    if (s.type === "join" || s.type === "custom_columns") {
      errors.push(s.type + " は後続ステップで実装予定です");
      continue;
    }
    errors.push("未対応のステージ種別: " + s.type);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, pickData, filtersBefore, filtersAfter, summarize, sort, limit };
}

/**
 * 公開 API: ステージ配列を SQL にコンパイルする。
 */
export function compileStages(query, opts) {
  const options = opts || {};
  const snapshotColumns = Array.isArray(options.snapshotColumns) ? options.snapshotColumns : [];
  const snapshotIndex = buildSnapshotIndex(snapshotColumns);

  const stages = (query && Array.isArray(query.stages)) ? query.stages : [];
  const cat = categorizeFlatStages(stages);
  if (!cat.ok) return { ok: false, errors: cat.errors };

  const errors = [];

  // pick_data
  const src = cat.pickData.source;
  if (!src || src.kind !== "form" || !src.formId) {
    errors.push("フォームが選択されていません");
  }
  if (src && src.kind === "question") {
    errors.push("Question を入力に取る pick_data は Step 7 で対応予定です");
  }
  if (errors.length > 0) return { ok: false, errors };

  const tableAlias = canonicalFormAlias(src.formId);

  // SELECT/GROUP BY 部の構築
  const selectParts = [];
  const groupByExprs = [];
  const dimAliases = new Set();
  const aggAliases = new Set();
  const dimColumns = [];
  const metricColumns = [];

  if (cat.summarize) {
    const groupBy = Array.isArray(cat.summarize.groupBy) ? cat.summarize.groupBy : [];
    for (const g of groupBy) {
      if (!g || !g.column) continue;
      const dim = dimensionExpression(g, snapshotIndex);
      selectParts.push(dim.expr + " AS " + bracketColumn(dim.alias));
      groupByExprs.push(dim.expr);
      dimAliases.add(dim.alias);
      // bucket 適用後の型は基本的に "string"（年/月/日は文字列扱い）。それ以外は元列の型を継承。
      const sourceCol = snapshotColumns.find((c) => c && c.key === g.column);
      const sourceType = sourceCol && sourceCol.type ? sourceCol.type : "unknown";
      const dimType = g.bucket ? "string" : sourceType;
      dimColumns.push({ name: dim.alias, role: "dimension", type: dimType });
    }
    const aggregations = Array.isArray(cat.summarize.aggregations) ? cat.summarize.aggregations : [];
    for (const a of aggregations) {
      const typeError = assertAggColumnType(a, snapshotColumns);
      if (typeError) {
        errors.push(typeError);
        continue;
      }
      const r = aggregationExpression(a, snapshotIndex);
      if (!r.ok) {
        errors.push(r.error);
        continue;
      }
      selectParts.push(r.expr + " AS " + bracketColumn(r.alias));
      aggAliases.add(r.alias);
      // 集計結果の型: count/countNotNull/sum/avg は number。min/max は元列の型を継承。
      let metricType = "number";
      if ((a.type === "min" || a.type === "max") && a.column) {
        const sourceCol = snapshotColumns.find((c) => c && c.key === a.column);
        if (sourceCol && sourceCol.type) metricType = sourceCol.type;
      }
      metricColumns.push({ name: r.alias, role: "metric", aggId: r.alias, aggType: a.type, type: metricType });
    }
  } else {
    // raw mode: SELECT *。columns は呼び出し側の Object.keys(rows[0]) で決まる
    selectParts.push("*");
  }

  // WHERE
  const whereParts = [];
  for (const stage of cat.filtersBefore) {
    const conditions = Array.isArray(stage.conditions) ? stage.conditions : [];
    for (const c of conditions) {
      if (!c || !c.column || !c.operator) continue;
      const r = filterConditionExpression(c, snapshotIndex);
      if (!r.ok) {
        errors.push(r.error);
        continue;
      }
      whereParts.push(r.expr);
    }
  }

  // HAVING（summarize 後の filter）
  const havingParts = [];
  for (const stage of cat.filtersAfter) {
    const conditions = Array.isArray(stage.conditions) ? stage.conditions : [];
    for (const c of conditions) {
      if (!c || !c.column || !c.operator) continue;
      const r = filterConditionExpression(c, snapshotIndex);
      if (!r.ok) {
        errors.push(r.error);
        continue;
      }
      havingParts.push(r.expr);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // SQL 組み立て
  let sql = "SELECT " + selectParts.join(", ") + " FROM " + tableAlias;
  if (whereParts.length > 0) sql += " WHERE " + whereParts.join(" AND ");
  if (groupByExprs.length > 0) sql += " GROUP BY " + groupByExprs.join(", ");
  if (havingParts.length > 0) sql += " HAVING " + havingParts.join(" AND ");

  // ORDER BY
  if (cat.sort) {
    const entries = Array.isArray(cat.sort.entries) ? cat.sort.entries : [];
    const orderParts = [];
    for (const e of entries) {
      const expr = sortEntryExpression(e, dimAliases, aggAliases, snapshotIndex);
      if (expr) orderParts.push(expr);
    }
    if (orderParts.length > 0) sql += " ORDER BY " + orderParts.join(", ");
  }

  // LIMIT
  if (cat.limit && typeof cat.limit.count === "number" && cat.limit.count > 0) {
    sql += " LIMIT " + Math.floor(cat.limit.count);
  }

  return {
    ok: true,
    sql,
    columns: dimColumns.concat(metricColumns),
  };
}

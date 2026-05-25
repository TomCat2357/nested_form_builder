/**
 * v2 ステージ配列を AlaSQL に流せる単一の SELECT 文へコンパイルする。
 *
 * 入力:
 *   query = { schemaVersion, stages: Stage[] }
 *   opts  = { formColumns?: [{ key, alaSqlKey, path, label }] }
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
import { canonicalDataAlias, canonicalViewAlias } from "./sqlPreprocessor.js";
import { assertAggColumnType, isAggCompatible, ALL_COLUMNS_TOKEN } from "./aggregationCompatibility.js";
import { migrateLegacyGui, isLegacyShape } from "./migrateLegacyGui.js";
import { bracketIdent, quoteString } from "../../expression/sqlEmit.js";

const NUMERIC_OPERATORS = new Set([">", ">=", "<", "<=", "between"]);

// 集計結果列の AS 別名サフィックス（列必須集計）。count は列なしなので "件数" 単独。
const AGG_ALIAS_SUFFIX = {
  countNotNull: "_件数",
  sum: "_合計",
  avg: "_平均",
  min: "_最小",
  max: "_最大",
};

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

function buildColumnIndex(formColumns) {
  const index = new Map();
  for (const col of formColumns || []) {
    if (col && col.key) index.set(col.key, col);
  }
  return index;
}

function resolveAlaSqlKey(columnKey, columnIndex) {
  if (!columnKey) return "";
  const col = columnIndex.get(columnKey);
  return col ? col.alaSqlKey : headerKeyToAlaSqlKey(columnKey);
}

function dimensionExpression(group, columnIndex) {
  const alaSqlKey = resolveAlaSqlKey(group.column, columnIndex);
  const bracketed = bracketIdent(alaSqlKey);
  // 日付列はエポック ms / Date / canonical 文字列が混在しうるため、DATETIME UDF で
  // canonical 文字列（YYYY/MM/DD HH:mm:ss.SSS）へ正規化してから先頭 N 文字を切り出す。
  // SUBSTRING を直接使うと数値値に対して .substr が呼ばれて落ちるため DATETIME を噛ませる。
  // （adminMigrations.gs の旧 DATE_BIN(x,n) → SUBSTRING(DATETIME(x),1,n) と同じ展開。）
  // quarter / week は AlaSQL の DATE 関数挙動が不安定なため後続ステップで対応。
  if (group.bucket === "year") {
    return { expr: "SUBSTRING(DATETIME(" + bracketed + "), 1, 4)", alias: alaSqlKey + "__year" };
  }
  if (group.bucket === "month") {
    return { expr: "SUBSTRING(DATETIME(" + bracketed + "), 1, 7)", alias: alaSqlKey + "__month" };
  }
  if (group.bucket === "day") {
    return { expr: "SUBSTRING(DATETIME(" + bracketed + "), 1, 10)", alias: alaSqlKey + "__day" };
  }
  return { expr: bracketed, alias: alaSqlKey };
}

// 集計式（FUNC(...)）のみ返す。AS 別名は呼び出し側が決める（computeAggAlias / dedupeAlias）。
// "*"（全列対象）トークンはここまで来ない：呼び出し側で個別列に展開してから渡す。
function aggregationExpression(agg, columnIndex) {
  if (agg.type === "count") {
    return { ok: true, expr: "COUNT(*)" };
  }
  if (!agg.column) {
    return { ok: false, error: "集計対象の列が指定されていません: " + agg.type };
  }
  const alaSqlKey = resolveAlaSqlKey(agg.column, columnIndex);
  const bracketed = bracketIdent(alaSqlKey);
  if (agg.type === "countNotNull") return { ok: true, expr: "COUNT(" + bracketed + ")" };
  if (agg.type === "sum") return { ok: true, expr: "SUM(" + bracketed + ")" };
  if (agg.type === "avg") return { ok: true, expr: "AVG(" + bracketed + ")" };
  if (agg.type === "min" || agg.type === "max") {
    // alasql 4 の組み込み MIN/MAX は値を number/bigint に強制し、文字列・canonical 日付文字列を捨てる
    // （非数値列の結果が NULL になる）。数値列のみネイティブを使い、それ以外（date / string / unknown）は
    // STR_MIN / STR_MAX UDF（辞書順 = 日付の時系列順で `<` / `>` 比較）に委ねる。registerNfbUdfs.js 参照。
    const col = columnIndex.get(agg.column);
    const colType = (col && col.type) ? col.type : "unknown";
    if (colType === "number") {
      return { ok: true, expr: (agg.type === "max" ? "MAX(" : "MIN(") + bracketed + ")" };
    }
    return { ok: true, expr: (agg.type === "max" ? "STR_MAX(" : "STR_MIN(") + bracketed + ")" };
  }
  return { ok: false, error: "未対応の集計種別: " + agg.type };
}

// 集計の AS 別名のベース文字列。agg.label > "件数"(count) > <alaSqlKey><サフィックス>。
function computeAggAlias(agg, resolvedAlaSqlKey) {
  if (agg && typeof agg.label === "string" && agg.label.trim()) return agg.label.trim();
  if (agg && agg.type === "count") return "件数";
  return String(resolvedAlaSqlKey || "") + (AGG_ALIAS_SUFFIX[agg && agg.type] || "");
}

// base が usedSet に未登録ならそのまま、登録済みなら "_2", "_3" … と空くまで試して採用・登録。
function dedupeAlias(base, usedSet) {
  let alias = base || "値";
  if (usedSet.has(alias)) {
    let n = 2;
    while (usedSet.has(alias + "_" + n)) n++;
    alias = alias + "_" + n;
  }
  usedSet.add(alias);
  return alias;
}

const AGG_DISPLAY_SUFFIX = {
  count: "件数",
  countNotNull: "件数",
  sum: "合計",
  avg: "平均",
  min: "最小",
  max: "最大",
};

function metricDisplayLabel(agg, formColumns) {
  if (agg && typeof agg.label === "string" && agg.label.trim()) return agg.label.trim();
  if (agg && agg.type === "count") return "件数";
  const suffix = AGG_DISPLAY_SUFFIX[agg && agg.type];
  if (!suffix) return agg && agg.id ? agg.id : "値";
  let sourceLabel = "";
  if (agg && agg.column) {
    const sourceCol = (formColumns || []).find((c) => c && c.key === agg.column);
    sourceLabel = (sourceCol && sourceCol.label) ? sourceCol.label : String(agg.column);
  }
  return sourceLabel ? sourceLabel + " " + suffix : suffix;
}

function filterConditionExpression(cond, columnIndex) {
  if (!cond || !cond.column || !cond.operator) {
    return { ok: false, error: "フィルター列または演算子が未指定です" };
  }
  const alaSqlKey = resolveAlaSqlKey(cond.column, columnIndex);
  const bracketed = bracketIdent(alaSqlKey);
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

function sortEntryExpression(entry, dimAliases, aggAliases, columnIndex, aggIdToAlias) {
  if (!entry || !entry.column) return null;
  const direction = entry.direction === "desc" ? "DESC" : "ASC";
  const col = String(entry.column);

  // 0. 旧 agg id（a_1 等）→ 現在の可読別名にマッピング（旧 orderBy "agg:<id>" の後方互換）
  if (aggIdToAlias && aggIdToAlias.has(col)) return bracketIdent(aggIdToAlias.get(col)) + " " + direction;
  // 1. agg のエイリアスに直接マッチ
  if (aggAliases.has(col)) return bracketIdent(col) + " " + direction;
  // 2. dimension のエイリアスに直接マッチ
  if (dimAliases.has(col)) return bracketIdent(col) + " " + direction;
  // 3. パイプ区切りの列キーを alaSqlKey に変換してマッチ
  const ala = resolveAlaSqlKey(col, columnIndex);
  if (dimAliases.has(ala)) return bracketIdent(ala) + " " + direction;
  if (aggAliases.has(ala)) return bracketIdent(ala) + " " + direction;
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

function validateLegacyV1(gui) {
  const errors = [];
  if (!gui || !gui.formId) errors.push("フォームが選択されていません");
  const aggs = Array.isArray(gui && gui.aggregations) ? gui.aggregations : [];
  const hasRaw = aggs.some((a) => a && a.type === "raw");
  if (!hasRaw && aggs.length === 0) errors.push("集計を 1 つ以上追加してください");
  return errors;
}

/**
 * 公開 API: ステージ配列 (v2) または旧フラット形式 (v1) を SQL にコンパイルする。
 * v1 形式が渡された場合は migrateLegacyGui で v2 に変換した上で v1 専用の前段
 * バリデーション (formId 必須・aggregations 必須) も実施する。
 */
export function compileStages(query, opts) {
  const options = opts || {};
  const formColumns = Array.isArray(options.formColumns) ? options.formColumns : [];
  const columnIndex = buildColumnIndex(formColumns);

  let normalized = query;
  if (isLegacyShape(query)) {
    const v1Errors = validateLegacyV1(query);
    if (v1Errors.length > 0) return { ok: false, errors: v1Errors };
    normalized = migrateLegacyGui(query);
  }

  const stages = (normalized && Array.isArray(normalized.stages)) ? normalized.stages : [];
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

  // pick_data.source.variant により、元データ形式 (data) とビュー形式 (view) を切り替える。
  // 未指定は "data"（後方互換）。
  const tableAlias = src.variant === "view"
    ? canonicalViewAlias(src.formId)
    : canonicalDataAlias(src.formId);

  // SELECT/GROUP BY 部の構築
  const selectParts = [];
  const groupByExprs = [];
  const dimAliases = new Set();
  const aggAliases = new Set();
  const dimColumns = [];
  const metricColumns = [];
  // SELECT に出した全別名（dim + metric）。可読別名の重複回避に使う。
  const selectAliases = new Set();
  // 元の GUI agg id（a_1 等）→ 最終別名。ORDER BY / HAVING の旧 id 参照の解決に使う。
  const aggIdToAlias = new Map();

  if (cat.summarize) {
    const groupBy = Array.isArray(cat.summarize.groupBy) ? cat.summarize.groupBy : [];
    const groupedKeys = new Set(groupBy.map((g) => g && g.column).filter(Boolean));
    for (const g of groupBy) {
      if (!g || !g.column) continue;
      const dim = dimensionExpression(g, columnIndex);
      selectParts.push(dim.expr + " AS " + bracketIdent(dim.alias));
      groupByExprs.push(dim.expr);
      dimAliases.add(dim.alias);
      selectAliases.add(dim.alias);
      // bucket 適用後の型は基本的に "string"（年/月/日は文字列扱い）。それ以外は元列の型を継承。
      const sourceCol = formColumns.find((c) => c && c.key === g.column);
      const sourceType = sourceCol && sourceCol.type ? sourceCol.type : "unknown";
      const dimType = g.bucket ? "string" : sourceType;
      const sourceLabel = sourceCol && sourceCol.label ? sourceCol.label : String(g.column || dim.alias);
      const bucketSuffix = g.bucket === "year" ? "（年）" : g.bucket === "month" ? "（月）" : g.bucket === "day" ? "（日）" : "";
      dimColumns.push({
        name: dim.alias,
        role: "dimension",
        type: dimType,
        displayLabel: sourceLabel + bucketSuffix,
      });
    }
    // 1 件の集計を SELECT に追加するヘルパー。
    // perCol = 実際に集計する設定（{ type, column? }）, srcAggId = 元の GUI agg id（あれば）, aliasBase = 別名ベース
    const pushMetric = (perCol, srcAggId, aliasBase) => {
      const r = aggregationExpression(perCol, columnIndex);
      if (!r.ok) {
        errors.push(r.error);
        return null;
      }
      const alias = dedupeAlias(aliasBase, selectAliases);
      selectParts.push(r.expr + " AS " + bracketIdent(alias));
      aggAliases.add(alias);
      // 集計結果の型: count/countNotNull/sum/avg は number。min/max は元列の型を継承。
      let metricType = "number";
      if ((perCol.type === "min" || perCol.type === "max") && perCol.column) {
        const sourceCol = formColumns.find((c) => c && c.key === perCol.column);
        if (sourceCol && sourceCol.type) metricType = sourceCol.type;
      }
      metricColumns.push({
        name: alias,
        role: "metric",
        aggId: alias,
        aggType: perCol.type,
        type: metricType,
        displayLabel: metricDisplayLabel(perCol, formColumns),
        ...(srcAggId ? { srcAggId } : {}),
      });
      return alias;
    };

    const aggregations = Array.isArray(cat.summarize.aggregations) ? cat.summarize.aggregations : [];
    for (const a of aggregations) {
      const typeError = assertAggColumnType(a, formColumns);
      if (typeError) {
        errors.push(typeError);
        continue;
      }
      if (a.column === ALL_COLUMNS_TOKEN) {
        // 全列対象：互換性のある全列（グループ化列を除く）へ同じ集計を展開する。
        if (formColumns.length === 0) {
          errors.push("全列対象を使うには列情報が必要です: " + a.type);
          continue;
        }
        const targets = formColumns.filter((c) =>
          c && c.key && !groupedKeys.has(c.key) && isAggCompatible(a.type, c.type));
        if (targets.length === 0) {
          errors.push(a.type + " を適用できる列がありません（全列対象）");
          continue;
        }
        let firstAlias = null;
        for (const col of targets) {
          const aliasBase = String(col.alaSqlKey || "") + (AGG_ALIAS_SUFFIX[a.type] || "");
          const alias = pushMetric({ type: a.type, column: col.key }, a.id, aliasBase);
          if (alias && !firstAlias) firstAlias = alias;
        }
        if (a.id && firstAlias) aggIdToAlias.set(a.id, firstAlias);
        continue;
      }
      const resolvedKey = a.column ? resolveAlaSqlKey(a.column, columnIndex) : "";
      const alias = pushMetric(a, a.id, computeAggAlias(a, resolvedKey));
      if (a.id && alias) aggIdToAlias.set(a.id, alias);
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
      const r = filterConditionExpression(c, columnIndex);
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
      // 旧「集計結果を a_1 等の id で参照」を現在の可読別名へ解決する。
      const cond = aggIdToAlias.has(c.column) ? { ...c, column: aggIdToAlias.get(c.column) } : c;
      const r = filterConditionExpression(cond, columnIndex);
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
      const expr = sortEntryExpression(e, dimAliases, aggAliases, columnIndex, aggIdToAlias);
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

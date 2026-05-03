/**
 * 旧フラット形式の GUI クエリを v2 のステージ配列へ変換する。
 *
 * 旧形式 (schemaVersion <= 1):
 *   { formId, aggregations[], groupBy[], filters[], orderBy[], limit }
 *
 * 新形式 (schemaVersion = 2):
 *   { schemaVersion: 2, stages: [
 *       { id, type: "pick_data", source: { kind: "form", formId } },
 *       { id, type: "filter",   conditions: [...] },         // filters があれば
 *       { id, type: "summarize", aggregations, groupBy },     // aggregations があれば
 *       { id, type: "sort",     entries: [...] },             // orderBy があれば
 *       { id, type: "limit",    count }                       // limit があれば
 *     ]
 *   }
 *
 * 既に v2 形式（stages を持つ）の場合は素通し。
 */

let nextId = 0;
function makeId(prefix) {
  nextId += 1;
  return prefix + "_" + nextId;
}

function isLegacyShape(gui) {
  if (!gui || typeof gui !== "object") return false;
  if (Array.isArray(gui.stages)) return false;
  // 旧形式は formId をトップに持つ
  return Object.prototype.hasOwnProperty.call(gui, "formId")
    || Object.prototype.hasOwnProperty.call(gui, "aggregations")
    || Object.prototype.hasOwnProperty.call(gui, "groupBy")
    || Object.prototype.hasOwnProperty.call(gui, "filters");
}

/**
 * 旧 orderBy の `agg:<id>` / `col:<key>` 参照を新 `entries[].column` 形式に正規化する。
 * 新形式では集計エイリアスも単なる列名扱い。
 */
function migrateOrderBy(orderBy, summarizeColumns) {
  const entries = [];
  for (const o of orderBy || []) {
    if (!o || !o.ref) continue;
    const direction = o.direction === "desc" ? "desc" : "asc";
    const ref = String(o.ref);
    let column = null;
    if (ref.startsWith("agg:")) {
      const id = ref.slice(4);
      // summarize 後の列名は agg.id がそのまま使われる
      if (summarizeColumns && summarizeColumns.has(id)) column = id;
      else column = id;
    } else if (ref.startsWith("col:")) {
      column = ref.slice(4);
    } else {
      column = ref;
    }
    entries.push({ column, direction });
  }
  return entries;
}

export function migrateLegacyGui(gui) {
  if (!gui) return { schemaVersion: 2, stages: [] };
  if (Array.isArray(gui.stages)) {
    // 既に v2。そのまま返す（schemaVersion 補完のみ）
    return { schemaVersion: 2, ...gui, stages: gui.stages };
  }
  if (!isLegacyShape(gui)) {
    return { schemaVersion: 2, stages: [] };
  }

  const stages = [];
  // ID をリセットして決定的に振り直す
  nextId = 0;

  stages.push({
    id: makeId("s"),
    type: "pick_data",
    source: { kind: "form", formId: gui.formId },
  });

  const filters = Array.isArray(gui.filters) ? gui.filters.filter(Boolean) : [];
  if (filters.length > 0) {
    stages.push({
      id: makeId("s"),
      type: "filter",
      conditions: filters.map((f) => ({
        id: f.id || makeId("c"),
        column: f.column,
        operator: f.operator,
        ...(f.value !== undefined ? { value: f.value } : {}),
        ...(f.value2 !== undefined ? { value2: f.value2 } : {}),
      })),
      conjunction: "and",
    });
  }

  const rawAggregations = Array.isArray(gui.aggregations) ? gui.aggregations.filter(Boolean) : [];
  // type === "raw" は raw mode 指定（集計しない）。1 つでも含まれていれば summarize を生成しない。
  const hasRaw = rawAggregations.some((a) => a.type === "raw");
  const aggregations = hasRaw ? [] : rawAggregations;
  const groupBy = Array.isArray(gui.groupBy) ? gui.groupBy.filter(Boolean) : [];
  let summarizeAggIds = null;
  if (aggregations.length > 0) {
    summarizeAggIds = new Set(aggregations.map((a) => a.id).filter(Boolean));
    stages.push({
      id: makeId("s"),
      type: "summarize",
      aggregations: aggregations.map((a) => ({
        id: a.id || makeId("a"),
        type: a.type,
        ...(a.column ? { column: a.column } : {}),
      })),
      groupBy: groupBy.map((g) => ({
        column: g.column,
        ...(g.bucket ? { bucket: g.bucket } : {}),
      })),
    });
  }
  // aggregations 0 件 / raw mode の場合は summarize ステージを生成しない（compileStages の SELECT * 経路に流す）。

  const orderBy = Array.isArray(gui.orderBy) ? gui.orderBy : [];
  const sortEntries = migrateOrderBy(orderBy, summarizeAggIds);
  if (sortEntries.length > 0) {
    stages.push({ id: makeId("s"), type: "sort", entries: sortEntries });
  }

  if (typeof gui.limit === "number" && gui.limit > 0) {
    stages.push({ id: makeId("s"), type: "limit", count: Math.floor(gui.limit) });
  }

  return { schemaVersion: 2, stages };
}

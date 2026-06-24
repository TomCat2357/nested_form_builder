// QuestionEditorPage のペイロード構築（純関数）。
// React state から「実行用クエリ」「保存用クエリ」「可視化定義」を組み立てる変換を
// コンポーネントから切り出してユニットテスト可能にする。state を読まず副作用も持たない。

import { formRefsToIds, collectFormRefIds } from "../../features/analytics/utils/rewriteSqlFormRefs.js";
import { buildFormIndex, formQualifiedName } from "../../features/analytics/utils/formIdentifierResolver.js";
import { normalizeTableStyle } from "../../features/analytics/utils/tableStyle.js";

// formId から論理パス（formQualifiedName）を導出する。未解決は "" を返す。
function formPathForId(formId, formIndex) {
  if (!formId || !formIndex || !formIndex.byId) return "";
  const form = formIndex.byId.get(String(formId));
  return form ? (formQualifiedName(form) || "") : "";
}

// "a, b ,,c" → ["a","b","c"]
export function parseYFields(yFields) {
  return String(yFields || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// クエリ実行用ペイロードを組み立てる。
//  - gui モードで formId 未選択 → { error }
//  - sql モードで本文が空      → { skip: true }（実行を黙ってスキップ）
//  - sources.error あり        → { error }
//  - 成功                       → { query }
export function buildRunQuery({ mode, gui, sql, sources }) {
  if (mode === "gui") {
    if (!gui || !gui.formId) return { error: "フォームを選択してください。" };
    return { query: { mode: "gui", gui } };
  }
  if (!String(sql || "").trim()) return { skip: true };
  if (sources && sources.error) return { error: sources.error };
  return {
    query: {
      mode: "sql",
      formSources: (sources && sources.formSources) || [],
      sql,
    },
  };
}

// 保存用クエリを組み立てる。参照は fileId（formId）を正本に持ち、復旧アンカーとして論理パス formPath を
// 冗長保存する（旧 formName は剥がす）。SQL 本文のフォーム参照は formRefsToIds で fileId へ変換する。
//  - gui モードで formId 未選択 → { error }
//  - sources.error あり          → { error }
//  - 成功                         → { query }
export function buildSaveQuery({ mode, gui, sql, sources, forms }) {
  const formIndex = buildFormIndex(forms || []);
  if (mode === "gui") {
    if (!gui || !gui.formId) return { error: "フォームを選択してください。" };
    const { formName: _staleGuiFormName, formPath: _staleGuiFormPath, ...guiRest } = gui;
    return { query: { mode: "gui", gui: { ...guiRest, formPath: formPathForId(gui.formId, formIndex) } } };
  }
  if (sources && sources.error) return { error: sources.error };
  // 明示 sources（selectedFormId 由来。alias:"data" / 既定フォーム順を温存）を先頭に置き、
  // SQL 本文に実在するフォーム参照（collectFormRefIds）で未収録の fileId を追記する。
  // 手書き SQL（ドロップダウン未選択）でも全フォーム参照に formPath 復旧アンカーが刻まれる。
  const explicit = ((sources && sources.formSources) || []).map(
    ({ formName: _staleFormName, formPath: _staleFormPath, ...rest }) => rest
  );
  const seen = new Set(explicit.map((s) => s.formId).filter(Boolean));
  const merged = explicit.slice();
  for (const formId of collectFormRefIds(sql, formIndex)) {
    if (seen.has(formId)) continue;
    seen.add(formId);
    merged.push({ formId });
  }
  return {
    query: {
      mode: "sql",
      formSources: merged.map((src) => ({
        ...src,
        formPath: formPathForId(src.formId, formIndex),
      })),
      sql: formRefsToIds(sql, formIndex),
    },
  };
}

// visualization 定義オブジェクトを state から組み立てる（保存ペイロード用）。
export function buildQuestionVisualization({ vizType, xField, yFields, heatmap, vizOptions }) {
  const hm = heatmap || {};
  const vo = vizOptions || {};
  return {
    type: vizType,
    xField: String(xField || "").trim(),
    yFields: parseYFields(yFields),
    showLegend: true,
    heatmap: {
      enabled: !!hm.enabled,
      direction: hm.direction || "column",
      excludeRows: typeof hm.excludeRows === "string" ? hm.excludeRows.slice(0, 500) : "",
      excludeColumns: typeof hm.excludeColumns === "string" ? hm.excludeColumns : "",
      minColor: typeof hm.minColor === "string" ? hm.minColor : "",
      maxColor: typeof hm.maxColor === "string" ? hm.maxColor : "",
    },
    format: vo.format,
    goal: vo.goal,
    pivot: vo.pivot,
    geo: vo.geo,
    sankey: vo.sankey,
    axis: vo.axis,
    lineStyle: vo.lineStyle,
    series: vo.series || {},
    tableStyle: normalizeTableStyle(vo.tableStyle),
    chartStyle: vo.chartStyle || null,
  };
}

// QuestionEditorPage のペイロード構築（純関数）。
// React state から「実行用クエリ」「保存用クエリ」「可視化定義」を組み立てる変換を
// コンポーネントから切り出してユニットテスト可能にする。state を読まず副作用も持たない。

import { formRefsToIds } from "../../features/analytics/utils/rewriteSqlFormRefs.js";
import { buildFormIndex } from "../../features/analytics/utils/formIdentifierResolver.js";
import { normalizeTableStyle } from "../../features/analytics/utils/tableStyle.js";

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

// 保存用クエリを組み立てる。参照は fileId（formId）のみで保持し、読み込んだ旧 formName は剥がす。
// SQL 本文のフォーム参照は formRefsToIds で fileId へ変換する（リネーム耐性）。
//  - gui モードで formId 未選択 → { error }
//  - sources.error あり          → { error }
//  - 成功                         → { query }
export function buildSaveQuery({ mode, gui, sql, sources, forms }) {
  if (mode === "gui") {
    if (!gui || !gui.formId) return { error: "フォームを選択してください。" };
    const { formName: _staleGuiFormName, ...guiRest } = gui;
    return { query: { mode: "gui", gui: guiRest } };
  }
  if (sources && sources.error) return { error: sources.error };
  return {
    query: {
      mode: "sql",
      formSources: ((sources && sources.formSources) || []).map(
        ({ formName: _staleFormName, ...rest }) => rest
      ),
      sql: formRefsToIds(sql, buildFormIndex(forms || [])),
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

// QuestionEditorPage の state 初期値・ロード変換・プレビュー組み立て（純関数）。
// React state に依存しない変換ロジックをコンポーネントから切り出してユニットテスト可能にする。
// state を読まず副作用も持たない。

import { resolveColumnRef } from "../../features/analytics/utils/columnIdentifierResolver.js";
import { normalizeTableStyle } from "../../features/analytics/utils/tableStyle.js";
import { DEFAULT_LINE_STYLE } from "../../features/analytics/utils/chartPalette.js";

// GUI クエリの空初期値。
export function emptyGui(formId) {
  return {
    schemaVersion: 1,
    formId: formId || "",
    aggregations: [{ id: "a_1", type: "count" }],
    groupBy: [],
    filters: [],
    orderBy: [],
    limit: null,
  };
}

// 可視化オプションの空初期値。
export function emptyVizOptions() {
  return {
    format: { prefix: "", suffix: "", decimals: null, locale: "" },
    goal: null,
    pivot: { rowField: "", colField: "", valueField: "", agg: "sum" },
    geo: { latField: "", lngField: "", valueField: "", regionField: "", gridSize: 0.1 },
    sankey: { sourceField: "", targetField: "", valueField: "" },
    axis: {
      x: { auto: true, min: null, max: null, title: "" },
      y: { auto: true, min: null, max: null, title: "" },
    },
    // 折れ線系のグローバル設定。
    // curve: "linear" (カクカク) | "smooth" (曲線)
    // borderDash: [] = 実線 / [5,5] = 破線 / [2,3] = 点線
    // pointStyle: Chart.js の組込み形状名（circle / rect / triangle / rectRot / cross / star / none）
    lineStyle: { ...DEFAULT_LINE_STYLE },
    // 系列ごとの色上書き。key = 系列名（yField または x のカテゴリ値）/ value = { color }
    series: {},
    tableStyle: null,
    // グラフ全般の見た目（タイトル / 凡例 / グリッド / 背景 / 余白 等）。
    // null = 未設定（既定）/ オブジェクト = 個別カスタム。normalizeChartStyle 経由で
    // 欠落キーを補完したものを ChartStyleControls / ChartRenderer に渡す。
    chartStyle: null,
  };
}

export const buildQuestionEditPath = (id) => `/admin/questions/${id}`;

// ロードした Question 定義 q から可視化系 state を組み立てる（純変換）。
// 戻り値: { vizType, xField, yFields, heatmap, vizOptions }
export function questionVisualizationToState(visualization) {
  const v = visualization || {};
  const baseOpts = emptyVizOptions();
  return {
    vizType: v.type || "table",
    xField: v.xField || "",
    yFields: Array.isArray(v.yFields) ? v.yFields.join(",") : "",
    heatmap: {
      enabled: !!v.heatmap?.enabled,
      direction: v.heatmap?.direction || "column",
      excludeRows: typeof v.heatmap?.excludeRows === "string" ? v.heatmap.excludeRows : "",
      excludeColumns: typeof v.heatmap?.excludeColumns === "string" ? v.heatmap.excludeColumns : "",
      minColor: typeof v.heatmap?.minColor === "string" ? v.heatmap.minColor : "",
      maxColor: typeof v.heatmap?.maxColor === "string" ? v.heatmap.maxColor : "",
    },
    vizOptions: {
      format: { ...baseOpts.format, ...(v.format || {}) },
      goal: v.goal === undefined ? null : v.goal,
      pivot: { ...baseOpts.pivot, ...(v.pivot || {}) },
      geo: { ...baseOpts.geo, ...(v.geo || {}) },
      sankey: { ...baseOpts.sankey, ...(v.sankey || {}) },
      axis: {
        x: { ...baseOpts.axis.x, ...(v.axis?.x || {}) },
        y: { ...baseOpts.axis.y, ...(v.axis?.y || {}) },
      },
      lineStyle: { ...baseOpts.lineStyle, ...(v.lineStyle || {}) },
      series: v.series && typeof v.series === "object" ? v.series : {},
      tableStyle: normalizeTableStyle(v.tableStyle),
      chartStyle: v.chartStyle && typeof v.chartStyle === "object" ? v.chartStyle : null,
    },
  };
}

// VisualizePanel に渡す viz プレビューオブジェクトを組み立てる。
// columnIndex は列トークン→正規名解決用（null 可）。
export function buildVizPreview({ vizType, xField, yFields, heatmap, vizOptions, columnIndex }) {
  const resolveCol = (token) => resolveColumnRef(token, columnIndex) || token;
  return {
    type: vizType,
    xField: resolveCol(String(xField || "").trim()),
    yFields: String(yFields || "").split(",").map((s) => s.trim()).filter(Boolean).map(resolveCol),
    heatmap,
    format: vizOptions.format,
    goal: vizOptions.goal,
    pivot: vizOptions.pivot,
    geo: vizOptions.geo,
    sankey: vizOptions.sankey,
    axis: vizOptions.axis,
    lineStyle: vizOptions.lineStyle,
    series: vizOptions.series,
    tableStyle: vizOptions.tableStyle,
    chartStyle: vizOptions.chartStyle,
  };
}

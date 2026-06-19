/**
 * クエリ結果の列プロファイルから初期チャート種別を推奨する。
 *
 * @param {Array<{name: string, role?: string, type?: string}>} columns
 *   compileStages の `compiledColumns`（{ name, role, type? }）想定。
 *   role: "dimension" | "metric" | "raw"。type: "string"|"number"|"date"|"boolean"|"unknown"。
 * @param {number} [rowCount]
 *
 * @returns {"scalar"|"bar"|"line"|"pie"|"scatter"|"table"}
 */
import { ensureArray } from "../../../utils/arrays.js";

export function suggestChartType(columns, rowCount) {
  const cols = ensureArray(columns);
  if (cols.length === 0) return "table";

  const dims = cols.filter((c) => c && c.role === "dimension");
  const metrics = cols.filter((c) => c && c.role === "metric");

  // (0 dim, 1 metric) → 単一値
  if (dims.length === 0 && metrics.length === 1) return "scalar";

  // (1 dim + 1 以上 metric)
  if (dims.length === 1 && metrics.length >= 1) {
    if (isDateLikeDimension(dims[0])) return "line";
    return "bar";
  }

  // (raw, 数値 2 列, dim/metric なし) → 散布図
  if (dims.length === 0 && metrics.length === 0) {
    const numerics = cols.filter((c) => c.type === "number");
    if (numerics.length >= 2 && cols.length <= 3) return "scatter";
  }

  return "table";
}

function isDateLikeDimension(col) {
  if (!col) return false;
  if (col.type === "date") return true;
  // bucket 適用後のエイリアス（例: 受付日__month, 受付日__year, 受付日__day）も日付軸とみなす
  if (typeof col.name === "string" && /__(year|quarter|month|week|day)$/.test(col.name)) return true;
  return false;
}

/**
 * 可視化タイプの選択肢（value=内部キー / label=表示名）。
 * VisualizePanel（管理者エディタ）と CardVizOverridePanel（閲覧者の一時上書き）で共有する。
 */
export const VIZ_TYPES = [
  { value: "table", label: "テーブル" },
  { value: "pivotTable", label: "ピボットテーブル" },
  { value: "scalar", label: "単一値" },
  { value: "number", label: "数値" },
  { value: "trend", label: "トレンド" },
  { value: "progressBar", label: "プログレスバー" },
  { value: "gauge", label: "ゲージ" },
  { value: "detail", label: "詳細" },
  { value: "bar", label: "棒グラフ" },
  { value: "stackedBar", label: "積み上げ棒グラフ" },
  { value: "row", label: "横棒グラフ" },
  { value: "line", label: "折れ線グラフ" },
  { value: "area", label: "面グラフ" },
  { value: "combo", label: "複合グラフ" },
  { value: "waterfall", label: "ウォーターフォール" },
  { value: "funnel", label: "ファネル" },
  { value: "pie", label: "円グラフ" },
  { value: "donut", label: "ドーナツグラフ" },
  { value: "sunburst", label: "サンバースト" },
  { value: "sankey", label: "サンキー" },
  { value: "scatter", label: "散布図" },
  { value: "pinMap", label: "ピンマップ" },
  { value: "gridMap", label: "グリッドマップ" },
  { value: "regionMap", label: "都道府県マップ" },
];

// 軸 min/max 設定が意味を持つグラフ種別（Chart.js 軸を持つもの）。
export const AXIS_TYPES = new Set(["bar", "stackedBar", "row", "line", "area", "combo", "scatter"]);

// 凡例 ON/OFF が意味を持つグラフ種別（Chart.js 系）。
export const LEGEND_TYPES = new Set(["bar", "stackedBar", "row", "line", "area", "combo", "pie", "donut", "scatter"]);

/**
 * チャート種別ごとに必要な軸ロール定義。VisualizePanel の入力 UI 切替に使う。
 *
 * x / y の値:
 *   false      … 入力不要
 *   "single"   … 1 列のみ
 *   "multi"    … カンマ区切り複数列
 *
 * 個別キー (extras): pivot / geo / format / goal などタイプ固有の追加設定の有無。
 */
export const CHART_AXIS_REQUIREMENTS = {
  table: { x: false, y: false, multiY: false, extras: ["tableStyle"] },
  scalar: { x: false, y: "single", label: "値の列" },
  number: { x: false, y: "single", label: "値の列", extras: ["format"] },
  detail: { x: false, y: false },
  progressBar: { x: false, y: "single", label: "値の列", extras: ["goal"] },
  trend: { x: "single", y: "single", xLabel: "時間軸", yLabel: "値の列", extras: ["format"] },
  gauge: { x: false, y: "single", label: "値の列", extras: ["goal"] },
  bar: { x: "single", y: "multi", label: "Y 軸" },
  stackedBar: { x: "single", y: "multi", label: "Y 軸" },
  row: { x: "single", y: "multi", label: "Y 軸" },
  line: { x: "single", y: "multi", label: "Y 軸" },
  area: { x: "single", y: "multi", label: "Y 軸" },
  combo: { x: "single", y: "multi", label: "Y 軸（先頭=棒, 残り=線）" },
  waterfall: { x: "single", y: "single", xLabel: "ラベル列", yLabel: "増減値" },
  funnel: { x: "single", y: "single", xLabel: "ステップ", yLabel: "値の列" },
  pie: { x: "single", y: "single", xLabel: "ラベル列", yLabel: "値の列" },
  donut: { x: "single", y: "single", xLabel: "ラベル列", yLabel: "値の列" },
  sunburst: { x: false, y: "single", label: "値の列", extras: ["pivot"] },
  sankey: { x: false, y: false, extras: ["sankey"] },
  scatter: { x: "single", y: "multi", label: "Y 軸（数値）" },
  pivotTable: { x: false, y: false, extras: ["pivot", "tableStyle"] },
  pinMap: { x: false, y: false, extras: ["geo"] },
  gridMap: { x: false, y: false, extras: ["geo"] },
  regionMap: { x: false, y: false, extras: ["geo"] },
};

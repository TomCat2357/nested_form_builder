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
export function suggestChartType(columns, rowCount) {
  const cols = Array.isArray(columns) ? columns : [];
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
 * チャート種別ごとに必要な軸ロール定義。VisualizePanel の入力 UI 切替に使う。
 */
export const CHART_AXIS_REQUIREMENTS = {
  table: { x: false, y: false, multiY: false },
  scalar: { x: false, y: "single", label: "値の列" },
  bar: { x: "single", y: "multi", label: "Y 軸" },
  line: { x: "single", y: "multi", label: "Y 軸" },
  pie: { x: "single", y: "single", xLabel: "ラベル列", yLabel: "値の列" },
  scatter: { x: "single", y: "multi", label: "Y 軸（数値）" },
};

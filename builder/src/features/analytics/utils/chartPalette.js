/**
 * チャート系列・セグメント描画用の既定カラーパレットと参照ヘルパ。
 *
 * 同じパレットが従来 ChartRenderer / ChartStyleControls / SimpleVizRenderers の
 * 3 ファイルに独立定義されていたのを 1 か所に統合。色を変えるときはここだけ触る。
 */

import { deepClone } from "../../../core/schema.js";

export const CHART_PALETTE = [
  "#4C7EFF", "#FF6B6B", "#48CFAD", "#FFCE54", "#A67FE6",
  "#FC6E51", "#37BC9B", "#E8B86D", "#5D9CEC", "#F6BB42",
];

/** インデックスに応じた既定色（パレットを循環）。 */
export function paletteColor(index) {
  return CHART_PALETTE[((index % CHART_PALETTE.length) + CHART_PALETTE.length) % CHART_PALETTE.length];
}

/**
 * viz.series（`{ [seriesKey]: { color } }`）に色上書きがあればそれ、無ければ既定パレットを返す。
 */
export function resolveSeriesColor(viz, seriesKey, index) {
  const override = viz?.series?.[seriesKey]?.color;
  if (override && typeof override === "string") return override;
  return paletteColor(index);
}

/**
 * 折れ線/散布図系の既定スタイル（curve / borderDash / pointStyle / pointRadius）。
 * QuestionEditorPage の emptyVizOptions と ChartStyleControls のローカル既定が
 * 同じ内容で重複していたので統合。Question 保存形式の互換のためキー名はそのまま。
 */
export const DEFAULT_LINE_STYLE = {
  curve: "linear",
  borderDash: [],
  pointStyle: "circle",
  pointRadius: 3,
};

/**
 * グラフ全般の「見た目」設定。tableStyle と対応する位置づけで、
 * 既存の lineStyle / series / axis(.title/.min/.max) とは独立に保存する。
 *
 * 空文字 "" は「既定値（Chart.js / CSS にお任せ）」を意味し、render 側は
 * 値が空のときは Chart.js のデフォルト挙動に委ねる。
 *
 * 一覧:
 *   title       : グラフ全体のタイトル（text + font）
 *   legend.position: "top" | "right" | "bottom" | "left" | "hidden"
 *   grid.x/y    : 軸グリッド線の表示・色
 *   tick        : 軸目盛りラベルのフォント
 *   axisTitle   : 軸タイトル（既存の axis.x.title / axis.y.title）のフォント
 *   background  : チャート全体（canvas コンテナ）の背景色
 *   padding     : チャート外側の余白（top/right/bottom/left, px）
 */
export const DEFAULT_CHART_STYLE = {
  title: { text: "", fontSize: 16, color: "" },
  legend: { position: "top", fontSize: 12, color: "" },
  grid: {
    x: { display: true, color: "" },
    y: { display: true, color: "" },
  },
  tick: { fontSize: 11, color: "" },
  axisTitle: { fontSize: 12, color: "" },
  background: "",
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
};

const LEGEND_POSITIONS = new Set(["top", "right", "bottom", "left", "hidden"]);

function numOr(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function strOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

/**
 * 保存済み chartStyle を既定値とマージして欠落キーを補う。
 * null / undefined / 非オブジェクトは全 default を返す。
 */
export function normalizeChartStyle(input) {
  const def = DEFAULT_CHART_STYLE;
  if (!input || typeof input !== "object") {
    return deepClone(def);
  }
  const inTitle = input.title || {};
  const inLegend = input.legend || {};
  const inGrid = input.grid || {};
  const inGridX = inGrid.x || {};
  const inGridY = inGrid.y || {};
  const inTick = input.tick || {};
  const inAxisTitle = input.axisTitle || {};
  const inPadding = input.padding || {};
  const legendPos = LEGEND_POSITIONS.has(inLegend.position) ? inLegend.position : def.legend.position;
  return {
    title: {
      text: strOr(inTitle.text, def.title.text),
      fontSize: numOr(inTitle.fontSize, def.title.fontSize),
      color: strOr(inTitle.color, def.title.color),
    },
    legend: {
      position: legendPos,
      fontSize: numOr(inLegend.fontSize, def.legend.fontSize),
      color: strOr(inLegend.color, def.legend.color),
    },
    grid: {
      x: {
        display: inGridX.display !== false,
        color: strOr(inGridX.color, def.grid.x.color),
      },
      y: {
        display: inGridY.display !== false,
        color: strOr(inGridY.color, def.grid.y.color),
      },
    },
    tick: {
      fontSize: numOr(inTick.fontSize, def.tick.fontSize),
      color: strOr(inTick.color, def.tick.color),
    },
    axisTitle: {
      fontSize: numOr(inAxisTitle.fontSize, def.axisTitle.fontSize),
      color: strOr(inAxisTitle.color, def.axisTitle.color),
    },
    background: strOr(input.background, def.background),
    padding: {
      top: numOr(inPadding.top, 0),
      right: numOr(inPadding.right, 0),
      bottom: numOr(inPadding.bottom, 0),
      left: numOr(inPadding.left, 0),
    },
  };
}

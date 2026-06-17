// 折れ線・棒・円・散布図 のスタイル UI 表示制御と borderDash 変換の純ロジック。
// ChartStyleControls.jsx から切り出し、ユニットテスト可能にする（描画と無関係）。

const LINE_LIKE = new Set(["line", "area", "combo"]);
const BAR_LIKE = new Set(["bar", "stackedBar", "row"]);
const PIE_LIKE = new Set(["pie", "donut"]);
const SCATTER_LIKE = new Set(["scatter"]);

// 円グラフ系（pie/donut）か。系列色ラベルの「セグメント色 / 系列色」出し分けに使う。
export function isPieLike(vizType) {
  return PIE_LIKE.has(vizType);
}

// VisualizePanel が「この vizType でグラフスタイル UI を出すべきか」を判定するための公開判定。
// LINE/BAR/PIE/SCATTER のいずれかに該当すれば true。
export function isChartStyleSupported(vizType) {
  return LINE_LIKE.has(vizType) || BAR_LIKE.has(vizType) || PIE_LIKE.has(vizType) || SCATTER_LIKE.has(vizType);
}

// vizType ごとに各セクションの表示可否フラグをまとめて返す。
//   line / area / combo  → 線種・ポイント形状 + 系列色 + 軸ラベル + 軸カスタマイズ
//   bar / stackedBar / row → 系列色 + 軸ラベル + 軸カスタマイズ
//   pie / donut          → セグメント色のみ（軸なし）
//   scatter              → ポイント形状 + 系列色 + 軸ラベル + 軸カスタマイズ
export function getChartControlVisibility(vizType) {
  return {
    showLineControls: LINE_LIKE.has(vizType),
    showPointControls: LINE_LIKE.has(vizType) || SCATTER_LIKE.has(vizType),
    showAxisLabels: !PIE_LIKE.has(vizType), // pie/donut は軸なし
    showSeriesColors: LINE_LIKE.has(vizType) || BAR_LIKE.has(vizType) || PIE_LIKE.has(vizType) || SCATTER_LIKE.has(vizType),
    showAxisCustomization: !PIE_LIKE.has(vizType), // grid / tick / axisTitle は軸を持つチャートのみ
  };
}

// borderDash は配列で保存するが、UI ではプリセットセレクト or カスタム数値カンマ表記で扱う。
export function dashToString(dash) {
  if (!Array.isArray(dash) || dash.length === 0) return "";
  return dash.join(",");
}

export function stringToDash(s) {
  if (!s || typeof s !== "string") return [];
  return s
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * 時系列クエリ結果から「最新値」と「前回値」を計算する。
 * Trend ビジュアライゼーション用。
 *
 * 仮定: rows は xField で昇順ソート済みであることを呼び出し側で保証する
 * (compileStages の orderBy で昇順にする運用)。
 *
 * @param {Array<Object>} rows
 * @param {string} xField   時間軸となる列 (ラベル取得のみに使用)
 * @param {string} yField   値の列
 * @returns {{
 *   current: number|null,
 *   previous: number|null,
 *   currentLabel: string|null,
 *   previousLabel: string|null,
 *   sparkline: number[],
 * }}
 */
import { toFiniteNumberOrNull } from "./computeShared.js";

export function computeTrend(rows, xField, yField) {
  const result = { current: null, previous: null, currentLabel: null, previousLabel: null, sparkline: [] };
  if (!Array.isArray(rows) || rows.length === 0 || !yField) return result;

  const series = [];
  for (const r of rows) {
    const n = r ? toFiniteNumberOrNull(r[yField]) : null;
    if (n === null) continue;
    series.push({ x: r[xField], y: n });
  }
  if (series.length === 0) return result;

  result.sparkline = series.map((p) => p.y);
  const last = series[series.length - 1];
  result.current = last.y;
  result.currentLabel = last.x === null || last.x === undefined ? null : String(last.x);
  if (series.length >= 2) {
    const prev = series[series.length - 2];
    result.previous = prev.y;
    result.previousLabel = prev.x === null || prev.x === undefined ? null : String(prev.x);
  }
  return result;
}

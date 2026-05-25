/**
 * Waterfall チャート用に、各行の値を累積遷移バー [start, end] に変換する。
 *
 * 入力: rows = [{ [xField]: ラベル, [yField]: 増減値 }, ...]
 * 出力: { bars: [{ label, start, end, kind: "up"|"down"|"flat" }], total }
 *
 * 累積開始は 0。各行の値を加算し、その bar は [前累積, 新累積] となる。
 *
 * 例:
 *   rows = [{ step: "A", v: 100 }, { step: "B", v: -30 }, { step: "C", v: 20 }]
 *   bars = [
 *     { label: "A", start: 0, end: 100, kind: "up" },
 *     { label: "B", start: 100, end: 70, kind: "down" },
 *     { label: "C", start: 70, end: 90, kind: "up" },
 *   ]
 */
import { toFiniteNumberOrNull } from "./computeShared.js";

export function computeWaterfall(rows, xField, yField) {
  const bars = [];
  if (!Array.isArray(rows) || rows.length === 0 || !yField) {
    return { bars, total: 0 };
  }
  let acc = 0;
  for (const r of rows) {
    const n = r ? toFiniteNumberOrNull(r[yField]) : null;
    if (n === null) continue;
    const start = acc;
    const end = acc + n;
    bars.push({
      label: r[xField] === null || r[xField] === undefined ? "" : String(r[xField]),
      start,
      end,
      kind: n > 0 ? "up" : n < 0 ? "down" : "flat",
      delta: n,
    });
    acc = end;
  }
  return { bars, total: acc };
}

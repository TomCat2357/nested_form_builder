/**
 * ヒートマップ着色用 min/max 範囲算出ヘルパ。
 *
 * 3 方向 ("column" | "row" | "all") それぞれで min/max を算出する。除外行は
 * excludeRowPredicate(row, dispRow) === true のセルを min/max スキャンから外す。
 * 除外列は呼出側で numericCols から既に取り除かれている前提（detectNumericColumns）。
 *
 * 戻り値:
 *   { kind:"column", ranges:Map<col,[min,max]> }
 *   { kind:"row",    rowRanges:Array<[min,max]|null> }（除外行は null）
 *   { kind:"all",    range:[min,max]|null }
 */

import { toFiniteNumberOrNull as toFiniteNumber } from "./computeShared.js";

function isExcludedRow(excludeRowPredicate, row, dispRow) {
  return !!(excludeRowPredicate && excludeRowPredicate(row, dispRow));
}

export function buildHeatRanges(rows, columns, numericCols, direction, excludeRowPredicate) {
  if (direction === "column") {
    const ranges = new Map();
    for (const col of columns) {
      if (!numericCols.has(col)) continue;
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (isExcludedRow(excludeRowPredicate, r, i + 1)) continue;
        const n = toFiniteNumber(r[col]);
        if (n === null) continue;
        if (n < min) min = n;
        if (n > max) max = n;
      }
      if (Number.isFinite(min) && Number.isFinite(max)) ranges.set(col, [min, max]);
    }
    return { kind: "column", ranges };
  }
  if (direction === "row") {
    const rowRanges = rows.map((r, idx) => {
      if (isExcludedRow(excludeRowPredicate, r, idx + 1)) return null;
      let min = Infinity, max = -Infinity;
      for (const col of columns) {
        if (!numericCols.has(col)) continue;
        const n = toFiniteNumber(r[col]);
        if (n === null) continue;
        if (n < min) min = n;
        if (n > max) max = n;
      }
      return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : null;
    });
    return { kind: "row", rowRanges };
  }
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (isExcludedRow(excludeRowPredicate, r, i + 1)) continue;
    for (const col of columns) {
      if (!numericCols.has(col)) continue;
      const n = toFiniteNumber(r[col]);
      if (n === null) continue;
      if (n < min) min = n;
      if (n > max) max = n;
    }
  }
  const range = Number.isFinite(min) && Number.isFinite(max) ? [min, max] : null;
  return { kind: "all", range };
}

export function getHeatRange(meta, col, rowIdx) {
  if (!meta) return null;
  if (meta.kind === "column") return meta.ranges.get(col) || null;
  if (meta.kind === "row") return meta.rowRanges[rowIdx] || null;
  return meta.range || null;
}

/**
 * クエリ結果のフラットな rows をクロス集計表 (pivot) に変換する純関数。
 *
 * @param {Array<Object>} rows
 * @param {string} rowField   行軸となる列
 * @param {string} colField   列軸となる列
 * @param {string} valueField 値の列
 * @param {"sum"|"count"|"avg"|"min"|"max"} agg
 *
 * @returns {{
 *   rowKeys: string[],
 *   colKeys: string[],
 *   cells: { [rowKey: string]: { [colKey: string]: number|string|null } },
 *   rowTotals: { [rowKey: string]: number },
 *   colTotals: { [colKey: string]: number },
 *   grandTotal: number,
 * }}
 *
 * 注意: rowKeys / colKeys は登場順を保つ (Set で重複除外)。
 *       sum / avg は数値以外の値を集計対象外として無視する。
 *       min / max は値が全て非数値ならば辞書順比較 (string MIN/MAX) で代替する。
 *       count は値の型に関係なく行数を返す。
 *       rowTotals / colTotals / grandTotal は数値セルのみ加算 (文字列セルはスキップ)。
 */
import { stringifyKey } from "./computeShared.js";

export function pivot(rows, rowField, colField, valueField, agg) {
  const aggType = agg || "sum";
  const empty = { rowKeys: [], colKeys: [], cells: {}, rowTotals: {}, colTotals: {}, grandTotal: 0 };
  if (!Array.isArray(rows) || rows.length === 0 || !rowField || !colField) return empty;

  // 各 (rowKey, colKey) ごとの { sum, count, min, max } を収集
  const buckets = new Map(); // key: "rowcol" → bucket
  const rowKeys = [];
  const colKeys = [];
  const rowSet = new Set();
  const colSet = new Set();

  for (const r of rows) {
    if (!r) continue;
    const rk = stringifyKey(r[rowField]);
    const ck = stringifyKey(r[colField]);
    if (!rowSet.has(rk)) { rowSet.add(rk); rowKeys.push(rk); }
    if (!colSet.has(ck)) { colSet.add(ck); colKeys.push(ck); }
    const key = rk + "" + ck;
    let b = buckets.get(key);
    if (!b) {
      b = {
        sum: 0,
        count: 0,
        min: Infinity,
        max: -Infinity,
        hasNumeric: false,
        // 非数値値のための辞書順 MIN/MAX 追跡 (ISO 日付文字列も辞書順 = 時系列順で正しく機能)
        strMin: undefined,
        strMax: undefined,
        hasAny: false,
      };
      buckets.set(key, b);
    }
    const raw = valueField ? r[valueField] : 1;
    if (raw === null || raw === undefined || raw === "") {
      // count は値の有無に関係なく 1 を加算する Metabase 流ではなく、
      // ここでは「行があれば count + 1」の SQL COUNT(*) 流とする。
      b.count += 1;
      continue;
    }
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n)) {
      b.sum += n;
      b.count += 1;
      if (n < b.min) b.min = n;
      if (n > b.max) b.max = n;
      b.hasNumeric = true;
      b.hasAny = true;
    } else {
      b.count += 1; // 非数値でも行は数える
      // 辞書順 MIN/MAX 用に生の値を保持して比較する。
      // ISO 日付文字列は辞書順 = 時系列順なので正しく機能する。
      if (b.strMin === undefined || raw < b.strMin) b.strMin = raw;
      if (b.strMax === undefined || raw > b.strMax) b.strMax = raw;
      b.hasAny = true;
    }
  }

  const cells = {};
  const rowTotals = {};
  const colTotals = {};
  for (const rk of rowKeys) {
    cells[rk] = {};
    rowTotals[rk] = 0;
  }
  for (const ck of colKeys) {
    colTotals[ck] = 0;
  }
  let grandTotal = 0;

  for (const rk of rowKeys) {
    for (const ck of colKeys) {
      const b = buckets.get(rk + "" + ck);
      let v = null;
      if (b) {
        if (aggType === "count") v = b.count;
        else if (aggType === "sum") v = b.hasNumeric ? b.sum : null;
        else if (aggType === "avg") v = b.hasNumeric && b.count > 0 ? b.sum / b.count : null;
        // min/max: 数値があれば数値のまま、無ければ辞書順で文字列 MIN/MAX を返す
        else if (aggType === "min") v = b.hasNumeric ? b.min : (b.hasAny ? b.strMin : null);
        else if (aggType === "max") v = b.hasNumeric ? b.max : (b.hasAny ? b.strMax : null);
        else v = b.hasNumeric ? b.sum : null;
      }
      cells[rk][ck] = v === undefined ? null : v;
      if (typeof v === "number" && Number.isFinite(v)) {
        rowTotals[rk] += v;
        colTotals[ck] += v;
        grandTotal += v;
      }
    }
  }

  return { rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal };
}

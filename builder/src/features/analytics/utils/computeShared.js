/**
 * クエリ結果 rows を各種チャート用データへ変換する compute ヘルパー間で共有する純関数。
 *
 * 各 compute の上位の集計ループ（空値を count するか / スキップするか等）はチャート毎に
 * 異なるため共通化しない。ここに置くのはキー文字列化・数値 coerce などのプリミティブのみ。
 */

/**
 * 軸キーを表示用文字列に正規化する。null/undefined と空文字を区別して可視ラベルにする。
 * @param {*} v
 * @returns {string}
 */
export function stringifyKey(v) {
  if (v === null || v === undefined) return "(null)";
  if (v === "") return "(空)";
  return String(v);
}

export { toFiniteNumberOrNull } from "../../../utils/numbers.js";

/**
 * 「valueField があればその数値、無ければ 1（＝件数）」の値を返す。
 * valueField はあるが空値・非数値の行は 0。sankey / sunburst の葉ノード値計算用。
 * @param {Object} row
 * @param {string} [valueField]
 * @returns {number}
 */
export function rowValueOrCount(row, valueField) {
  if (!valueField) return 1;
  const raw = row ? row[valueField] : undefined;
  if (raw === null || raw === undefined || raw === "") return 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 行配列の全キーの和集合を「初出順」で返す。
 * フォーム records は回答済みフィールドだけが data に入るため不均質で、結果列を
 * rows[0] のキーだけから決めると後続行にしか無い列が落ちる。
 * @param {Array<object>} rows
 * @returns {string[]}
 */
export function unionRowKeys(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const k of Object.keys(row)) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

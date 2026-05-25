/**
 * クエリ結果の列名・値から、地理データ列を自動検出する。
 * 地図系ビジュアライゼーション (pinMap / gridMap / regionMap) の列ピッカー初期値に利用。
 */
import { countPrefectureMatches } from "./japanPrefectures.js";

const LAT_PATTERNS = [
  /^lat$/i,
  /^latitude$/i,
  /lat[._-]?deg/i,
  /緯度/u,
  /latitude/i,
];

const LNG_PATTERNS = [
  /^lng$/i,
  /^lon$/i,
  /^long$/i,
  /^longitude$/i,
  /lng[._-]?deg/i,
  /経度/u,
  /longitude/i,
];

const PREFECTURE_NAME_PATTERNS = [
  /都道府県/u,
  /^pref(ecture)?$/i,
  /都道府県名/u,
];

/**
 * 列名から緯度列の候補を返す。一致が無ければ null。
 */
export function detectLatField(columns) {
  return matchByName(columns, LAT_PATTERNS);
}

export function detectLngField(columns) {
  return matchByName(columns, LNG_PATTERNS);
}

/**
 * 都道府県列の検出。
 * 1) 列名がパターンマッチ → 採用
 * 2) 値の半数以上が JAPAN_PREFECTURES に一致する列 → 採用
 *
 * @param {string[]} columns
 * @param {Array<Object>} [rows]   値ベース検出に使う rows (省略可)
 */
export function detectPrefectureField(columns, rows) {
  const byName = matchByName(columns, PREFECTURE_NAME_PATTERNS);
  if (byName) return byName;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let best = null;
  let bestScore = 0;
  for (const c of columns || []) {
    const matches = countPrefectureMatches(rows, c);
    const score = matches / rows.length;
    if (score >= 0.5 && score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

function matchByName(columns, patterns) {
  if (!Array.isArray(columns)) return null;
  for (const c of columns) {
    if (typeof c !== "string") continue;
    for (const p of patterns) {
      if (p.test(c)) return c;
    }
  }
  return null;
}

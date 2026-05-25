/**
 * 数値変換ユーティリティ。フロント全体で使う「有限数値 or null」の判定を集約する。
 */

/**
 * 値を有限数値へ。null/undefined/空文字、または数値化できない値は null を返す。
 * @param {*} raw
 * @returns {number|null}
 */
export const toFiniteNumberOrNull = (raw) => {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
};

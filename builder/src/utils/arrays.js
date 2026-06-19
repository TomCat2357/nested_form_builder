/**
 * 配列正規化ユーティリティ。フロント全体に散らばっていた
 * 「Array.isArray(x) ? x : []」系の防御的定型を集約する。
 */

/**
 * 配列でなければ空配列を返す（最頻パターン）。
 * @template T
 * @param {T[]|*} value
 * @returns {T[]}
 */
export const ensureArray = (value) => (Array.isArray(value) ? value : []);

/**
 * 配列でなければ単一要素として配列に包む。null/undefined もそのまま [value] になる点に注意。
 * @template T
 * @param {T[]|T} value
 * @returns {T[]}
 */
export const wrapArray = (value) => (Array.isArray(value) ? value : [value]);

/**
 * 単数/複数いずれの入力も falsy 除外済みの ID リストへ正規化する。
 * @param {string|string[]|*} value
 * @returns {Array<*>}
 */
export const toIdList = (value) => wrapArray(value).filter(Boolean);

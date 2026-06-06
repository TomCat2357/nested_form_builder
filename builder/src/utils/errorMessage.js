/**
 * Error / 文字列 / 任意値から表示用メッセージ文字列を取り出す共通ヘルパ。
 *
 * `error?.message || error`（または `error?.message || "既定文言"`）の null 合体パターンが
 * 各所に散在していたため一本化する。message を持つオブジェクト（Error 等）はその message を、
 * それ以外は値自体を、いずれも falsy なら fallback を返す。
 *
 * @param {unknown} error 捕捉した例外・拒否値
 * @param {string} [fallback] message も値も得られないときの既定文言
 * @returns {string}
 */
export const toErrorMessage = (error, fallback = "エラーが発生しました") => {
  if (error && typeof error === "object" && error.message) return error.message;
  return error || fallback;
};

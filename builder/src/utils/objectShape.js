// オブジェクト/配列の形を正規化する小さな共通ユーティリティ。
// 「プレーンオブジェクトか判定」「非オブジェクトはデフォルトへ畳む」パターンが
// 各所に点在していたため 1 箇所へ集約する。

// プレーンオブジェクト（null・配列を除くオブジェクト）かどうかを返す。
export const isPlainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

// プレーンオブジェクトならそのまま、それ以外は空オブジェクトを返す。
export const asPlainObject = (value) => (isPlainObject(value) ? value : {});

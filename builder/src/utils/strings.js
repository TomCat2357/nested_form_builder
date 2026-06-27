// 文字列防御パターンの共通化。typeof チェック＋デフォルト畳み込みが各所に点在していたため集約する。

// 文字列ならそのまま、それ以外は fallback（既定は空文字）を返す。
export const asString = (value, fallback = "") => (typeof value === "string" ? value : fallback);

// 文字列なら trim した値、それ以外は空文字を返す。
export const asTrimmedString = (value) => (typeof value === "string" ? value.trim() : "");

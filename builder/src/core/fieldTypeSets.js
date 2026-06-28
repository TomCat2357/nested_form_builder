// フィールド型カテゴリの単一ソース（葉モジュール：他を import しない）。
// 旧来 utils/responses.js / core/collect.js / core/schema.js / features/search で
// ["checkboxes","radio","select"] のリテラル列挙が分散していたのをここへ集約する。
// 葉に置くことで responses.js ↔ collect.js などの循環 import を避ける
// （responses.js は本モジュールを re-export して従来の import 経路を維持）。

// 選択肢系（複数/単一選択）フィールド型。
export const CHOICE_TYPES = new Set(["checkboxes", "radio", "select"]);

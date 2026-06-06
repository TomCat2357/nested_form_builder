/**
 * 検索クエリ変換の共有ヘルパ。
 *
 * 簡易検索（searchSimpleTranslate.js）とヒット抜粋ハイライト（searchQueryEngine.js）で
 * 重複していた純粋関数を集約する。
 * ここに置くのは「入力 → 出力」が副作用なく決まるユーティリティのみ（トークナイザ/パーサ本体は
 * 各経路の意味論が異なるため各ファイルに残す）。
 */
import { escapeRegExp } from "../../utils/folderTree.js";
import { matchColumnName, normalizeColumnName } from "./searchTableValues.js";

/**
 * 比較演算子の別名を正規化する: ":" "==" → "=" / "!=" "><" → "<>"。
 * トークナイザで ":" / "==" を処理済みの経路でも、追加で渡って害はない（恒等的に通過）。
 */
export const canonicalSearchOperator = (operator) => {
  if (operator === ":" || operator === "==") return "=";
  if (operator === "!=" || operator === "><") return "<>";
  return operator;
};

// 旧構文 `/.../ ` の囲みスラッシュを剥がす（後方互換）。
const stripRegexSlashes = (source) => {
  const src = String(source ?? "");
  if (src.length >= 2 && src.startsWith("/") && src.endsWith("/")) return src.slice(1, -1);
  return src;
};

/**
 * 自由文 → 有効な正規表現パターン文字列。
 * 前後 `/.../ ` を剥がし、不正な正規表現は escapeRegExp 済みリテラルへフォールバックする
 * （入力途中で壊れない）。alasql の REGEXP_LIKE へ渡すパターン文字列として使う。
 */
export const toSafeRegexSource = (source) => {
  const src = stripRegexSlashes(source);
  try {
    // eslint-disable-next-line no-new
    new RegExp(src, "i");
    return src;
  } catch {
    return escapeRegExp(src);
  }
};

/**
 * 自由文 → 大文字小文字無視の RegExp。
 * toSafeRegexSource で必ず有効なパターンに正規化してからコンパイルするため throw しない。
 */
export const compileSearchRegex = (source) => new RegExp(toSafeRegexSource(source), "i");

/**
 * 列名から対応する column オブジェクトを返す。見つからなければ null。
 * 一致は matchColumnName（key / path / aliases / segments の OR）。
 */
export const findColumnByName = (columns, name) => {
  const normalized = normalizeColumnName(name);
  if (!columns || !normalized) return null;
  for (const column of columns) {
    if (matchColumnName(column, normalized)) return column;
  }
  return null;
};

/**
 * 列なし述語を全検索対象列への OR 展開にする。safeKeys が空なら "FALSE"。
 * buildPredicate は AlaSQL 安全名（バッククォートなしの素のキー）を受け取り、1 列分の述語文字列を返す。
 */
export const expandColumnlessOr = (safeKeys, buildPredicate) => {
  const keys = safeKeys || [];
  if (keys.length === 0) return "FALSE";
  return "(" + keys.map((k) => "(" + buildPredicate(k) + ")").join(" OR ") + ")";
};

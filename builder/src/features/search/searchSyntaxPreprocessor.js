/**
 * 検索バー構文のモード判定・正規化ヘルパー。
 *
 * 検索バーには 2 モードがある:
 * - **簡易モード**（プレフィックスなし）: searchSimpleTranslate.js が裸単語 LIKE / 列:値 /
 *   暗黙 AND などを alasql WHERE 式へ翻訳する（トークナイザは searchQueryEngine.js を共有）。
 * - **SQL モード**（先頭 `SELECT`）: 検索バーに最上位 SQL を直接書く。runSearchSelect が
 *   preprocessSql → AlaSQL で実行し、結果行の自フォーム `id` 集合で一覧を絞る。
 *
 * このファイルはモード横断で使う純粋ヘルパーだけを持つ:
 * - 簡易モード入力の全角記号オペレータ正規化（normalizeFullWidthSearchOperators）
 * - SQL モード判定の正規表現（SQL_MODE_RE）
 */

// 全角記号オペレータ → 半角。簡易モードの入力で全角のまま比較・括弧・IN リストが書けるようにする。
const FULLWIDTH_OP_MAP = {
  "：": ":",
  "＝": "=",
  "＞": ">",
  "＜": "<",
  "！": "!",
  "（": "(",
  "）": ")",
  "，": ",",
};

/**
 * 簡易モード検索クエリの全角記号オペレータを半角へ正規化する。
 * 引用符（' / "）で囲まれた値の中は変換せず保護するため、`氏名="田中：太郎"` の
 * 値中の全角コロンは保持され、オペレータ位置の全角記号だけが半角化される。
 * SQL モード（先頭 SELECT）には適用しないこと。
 *
 * @param {string} input
 * @returns {string}
 */
export function normalizeFullWidthSearchOperators(input) {
  const s = String(input == null ? "" : input);
  let out = "";
  let quote = null; // 引用符内なら "'" または '"'
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    out += Object.prototype.hasOwnProperty.call(FULLWIDTH_OP_MAP, ch) ? FULLWIDTH_OP_MAP[ch] : ch;
  }
  return out;
}

// SQL モード判定。検索バーに `SELECT ... FROM ...` を直接書く最上位 SQL。
// 自フォームは `_` で参照でき、本文にサブクエリ・別フォーム参照（JOIN/IN）を書ける。
// 実行結果のうち「自フォームの id」を持つ行だけが検索結果（その id のレコード）に対応する
// （SELECT * / SELECT [id] FROM _ は対応づき表示、id を含まない射影や別フォーム最上位は対応せず 0 件）。
export const SQL_MODE_RE = /^\s*SELECT\b/i;

/**
 * テンプレート文字列内の `{{ ... }}` トップレベルトークンを抽出する balanced scanner。
 *
 * - トークンは **連続二重ブレース `{{ ... }}`（ビュー形式）のみ**。単一ブレース
 *   `{ ... }`（旧・元データ形式）は廃止され、リテラル `{` として扱う。
 * - エスケープは `\{` / `\}` で `{` `}` をリテラル化（呼び出し側が前後で
 *   templateEscape / templateUnescape を行う想定）。
 * - 未閉じの `{` / `}}` で閉じないトークンはそのままリテラルとして残す。
 * - GAS 側の同等実装は gas/templateEvaluator.gs（balanced scanner + splitTopLevelCommas）。
 */

// full-query モード判定: トークン本文（trim 前後どちらでも可）が先頭 SELECT で
// 始まるか。true のときは「単一スカラ式」ではなく完全な AlaSQL クエリとして扱う
// （splitTopLevelCommas を通さず、SELECT (<expr>) ラップもしない）。
// 検索バーの searchSyntaxPreprocessor.js SQL_MODE_RE と同型。
// GAS 側の双子は gas/templateEvaluator.gs の nfbTplIsFullQueryBody_。
const FULL_QUERY_RE = /^\s*SELECT\b/i;

/**
 * トークン本文がフル SQL クエリ（先頭 SELECT）かどうか。
 * @param {string} body
 * @returns {boolean}
 */
export function isFullQueryBody(body) {
  return FULL_QUERY_RE.test(String(body == null ? "" : body));
}

/**
 * トークン本文が full-query（先頭 SELECT）そのものか、または **ネストした `{{...}}`
 * の中に full-query を含む**かを再帰的に判定する。
 *
 * `{{SELECT ...}}`（自身が full-query）だけでなく `{{UNIQUE_CSV({{SELECT ...}})}}` の
 * ように式/UDF が full-query を囲む形も true になる。これらは同期式コンパイルではなく
 * prefetchQueryTokens（非同期・クエリエンジン経由）で解決する対象。
 *
 * @param {string} body escape 済み本文でも可（`\{`/`\}` はマーカに退避済み・実 `{{` は残る）
 * @returns {boolean}
 */
export function tokenHasFullQuery(body) {
  const text = String(body == null ? "" : body);
  if (isFullQueryBody(text)) return true;
  if (text.indexOf("{{") < 0) return false;
  return collectBalancedBraces(text).some((t) => tokenHasFullQuery(t.body));
}

/**
 * `{` の位置 openIndex から対応する `}` の位置を返す。
 * 見つからなければ -1。
 */
export function findBalancedCloseIndex(text, openIndex) {
  if (text.charAt(openIndex) !== "{") return -1;
  const n = text.length;
  let depth = 1;
  let j = openIndex + 1;
  while (j < n) {
    const c = text.charAt(j);
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return -1;
}

/**
 * 開き位置 i が連続二重ブレース `{{ ... }}`（ビュー形式トークン）かを判定する。
 *
 * - `{{` で始まり対応する `}}` で閉じるトークンのみ認識し、mode="view"、body は
 *   内側（外周の 1 ペアを剥がしたもの）を返す。
 * - 単一ブレース `{ ... }`（旧・元データ形式）は **廃止** され、トークンとして
 *   認識せず null を返す（呼び出し側でリテラル `{` として扱う）。
 * - `}}` で閉じない / 未閉じも null（リテラル扱い）。
 */
function describeToken(text, i) {
  if (text.charAt(i) !== "{" || text.charAt(i + 1) !== "{") return null;
  const close = findBalancedCloseIndex(text, i);
  if (close < 0) return null;
  if (!(close - 1 > i + 1 && text.charAt(close - 1) === "}")) return null;
  return {
    mode: "view",
    body: text.substring(i + 2, close - 1),
    fullToken: text.substring(i, close + 1),
    start: i,
    end: close + 1,
  };
}

/**
 * テンプレート文字列を走査し、各 `{{ ... }}` トップレベルトークンを replacer に
 * 渡して結果を連結した新しい文字列を返す。トークンでない `{` を含むその他の文字は
 * そのままリテラルとして流す（単一ブレース `{...}` は廃止＝リテラル）。
 *
 * @param {string} text
 * @param {(tok: { body: string, fullToken: string, mode: "view", start: number, end: number }) => string} replacer
 * @returns {string}
 */
export function scanAndReplace(text, replacer) {
  if (!text) return "";
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text.charAt(i);
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }
    const tok = describeToken(text, i);
    if (!tok) {
      // 単一ブレース / 未閉じ / `}}` で閉じない → リテラル `{`
      out += ch;
      i++;
      continue;
    }
    out += replacer(tok);
    i = tok.end;
  }
  return out;
}

/**
 * テンプレート文字列のトップレベル `{{ ... }}` トークンを全て収集する。
 * 単一ブレースや未閉じの `{` はトークンとして扱わずスキップする。
 *
 * @param {string} text
 * @returns {Array<{ body: string, fullToken: string, mode: "view", start: number, end: number }>}
 */
export function collectBalancedBraces(text) {
  const results = [];
  if (!text) return results;
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (text.charAt(i) !== "{") {
      i++;
      continue;
    }
    const tok = describeToken(text, i);
    if (!tok) {
      i++;
      continue;
    }
    results.push(tok);
    i = tok.end;
  }
  return results;
}

/**
 * トークン body をトップレベルカンマで分割する。
 *
 * - 文字列リテラル `'...'` 内のカンマは無視（`''` でエスケープされた quote も保護）。
 * - `(` `[` `{` のネスト深度をカウントし、深度 > 0 のカンマは無視（関数引数内の
 *   カンマを保護する）。
 * - 各要素は前後の空白を `trim()` する。
 * - 末尾カンマ・連続カンマで空要素を保持する（`{`A`,}` → `["`A`", ""]`）。
 * - カンマが 1 つも無ければ `[trim(body)]` を返す（既存単一式パスと整合）。
 *
 * @param {string} body
 * @returns {string[]}
 */
export function splitTopLevelCommas(body) {
  const text = String(body == null ? "" : body);
  const n = text.length;
  const parts = [];
  let buf = "";
  let depth = 0;
  let i = 0;
  let hasComma = false;
  while (i < n) {
    const c = text.charAt(i);
    if (c === "'") {
      buf += c;
      i++;
      while (i < n) {
        const cc = text.charAt(i);
        buf += cc;
        if (cc === "'") {
          if (i + 1 < n && text.charAt(i + 1) === "'") {
            buf += text.charAt(i + 1);
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      buf += c;
      i++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      if (depth > 0) depth--;
      buf += c;
      i++;
      continue;
    }
    if (c === "," && depth === 0) {
      hasComma = true;
      parts.push(buf.trim());
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (!hasComma) return [buf.trim()];
  parts.push(buf.trim());
  return parts;
}

const ESCAPE_OPEN = "NFB_LBRACE";
const ESCAPE_CLOSE = "NFB_RBRACE";

/**
 * `\{` `\}` を一時マーカに退避する。scan の前に呼ぶ。
 */
export function escapeBraces(text) {
  if (!text) return "";
  return String(text)
    .split("\\{").join(ESCAPE_OPEN)
    .split("\\}").join(ESCAPE_CLOSE);
}

/**
 * escapeBraces で退避したマーカを `{` `}` に戻す。scan の後に呼ぶ。
 */
export function unescapeBraces(text) {
  if (!text) return "";
  return String(text)
    .split(ESCAPE_OPEN).join("{")
    .split(ESCAPE_CLOSE).join("}");
}

/**
 * escapeBraces で退避したマーカを **バックスラッシュ付き** `\{` `\}` に戻す。
 *
 * 出力用テンプレ生成（tokenReplacer.resolveQueryTokensInTemplate）専用。
 * クライアントで full-query トークンだけを事前解決して残りを GAS に渡すとき、
 * 著者エスケープ `\{` をそのまま GAS へ届けたい（GAS 側が後段で `\{`→リテラル `{` に
 * 変換するため）。通常の unescapeBraces は `{` に戻して backslash を落とすので使えない。
 */
export function restoreEscapedBraces(text) {
  if (!text) return "";
  return String(text)
    .split(ESCAPE_OPEN).join("\\{")
    .split(ESCAPE_CLOSE).join("\\}");
}

/**
 * テンプレート文字列内の `{ ... }` トップレベルトークンを抽出する balanced scanner。
 *
 * - エスケープは `\{` / `\}` で `{` `}` をリテラル化（呼び出し側が前後で
 *   templateEscape / templateUnescape を行う想定）。
 * - 未閉じの `{` はそのままリテラルとして残す。
 * - GAS 側の同等実装は gas/templateEvaluator.gs（balanced scanner + splitTopLevelCommas）。
 */

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
 * テンプレート文字列を走査し、各 `{ ... }` トップレベルトークンを replacer に
 * 渡して結果を連結した新しい文字列を返す。`{` 以外の文字はそのまま流す。
 *
 * @param {string} text
 * @param {(tok: { body: string, fullToken: string, start: number, end: number }) => string} replacer
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
    const close = findBalancedCloseIndex(text, i);
    if (close < 0) {
      // 未閉じはそのままリテラル化
      out += text.substring(i);
      return out;
    }
    const body = text.substring(i + 1, close);
    const fullToken = text.substring(i, close + 1);
    out += replacer({ body, fullToken, start: i, end: close + 1 });
    i = close + 1;
  }
  return out;
}

/**
 * テンプレート文字列のトップレベル `{ ... }` トークンを全て収集する。
 * 未閉じの `{` 以降は無視される（収集を打ち切り）。
 *
 * @param {string} text
 * @returns {Array<{ body: string, fullToken: string, start: number, end: number }>}
 */
export function collectBalancedBraces(text) {
  const results = [];
  if (!text) return results;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text.charAt(i);
    if (ch !== "{") {
      i++;
      continue;
    }
    const close = findBalancedCloseIndex(text, i);
    if (close < 0) return results;
    results.push({
      body: text.substring(i + 1, close),
      fullToken: text.substring(i, close + 1),
      start: i,
      end: close + 1,
    });
    i = close + 1;
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

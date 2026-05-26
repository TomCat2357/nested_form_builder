/**
 * 検索バー構文 → alasql 式文字列 への変換器。
 *
 * モード:
 * - **簡易モード**（プレフィックスなし）: 自動ラップを多用してユーザーの省略入力を吸収する。
 *   - 比較演算子を伴わない裸トークン → LIKE_ANY('word', `col1`, ..., `colN`)
 *   - トップレベル空白 → 暗黙の AND
 *   - 日付型列 ⇔ 日付/時刻リテラル (YYYY/MM/DD / YYYY-MM-DD ± 時刻) → リテラル側のみ canonical 文字列へ正規化
 * - **strict モード**（先頭 `WHERE` / `SEARCH`）: alasql 標準動作に任せる。
 *   - 関数解決は alasql 組み込み → JS グローバル → カスタム UDF (`alasql.fn.*`) の順
 *   - 列無し述語（`> 'x'` 等）は全検索対象列への OR 展開
 *   - 日付/時刻列は buildSearchRow / entriesToViewTableRows で canonical 文字列化されて渡るため
 *     文字列としての日付比較になる（簡易・strict 両モードともリテラルのみ canonical 正規化）
 *
 * 共通:
 * - 識別子（バッククォートなし日本語/英数字）は alasql 式中で `` ` `` で囲み補完
 *   かつ headerKeyToAlaSqlKey で `|` → `__` に正規化（行 dict のキーと整合）
 * - LIKE / NOT LIKE / IN / IS NULL / IS NOT NULL / 比較演算子 / 関数呼び出し / 括弧 / NOT / AND / OR は alasql そのまま
 *
 * パーサ: 再帰下降。
 *   query   := orExpr
 *   orExpr  := andExpr (OR andExpr)*
 *   andExpr := term ((AND | implicit) term)*
 *   term    := NOT term | "(" orExpr ")" | comparable
 *   comparable :=
 *       atom
 *     | atom cmpOp atom
 *     | atom IS [NOT] NULL
 *     | atom [NOT] LIKE atom
 *     | atom [NOT] IN "(" valueList ")"
 *   atom    := number | string | backtickIdent | functionCall | identifier | "(" orExpr ")"
 */
import { headerKeyToAlaSqlKey } from "../analytics/utils/headerToAlaSqlKey.js";
import { quoteString } from "../expression/sqlEmit.js";
import { formatCanonical } from "../../utils/dateTime.js";

const KEYWORDS = new Set(["AND", "OR", "NOT", "IS", "NULL", "LIKE", "IN", "TRUE", "FALSE"]);
const CMP_OPS = ["<=", ">=", "<>", "!=", "=", "<", ">"];

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
 * 厳密モード（SEARCH/WHERE）には適用しないこと。
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

function isIdentStartChar(ch) {
  if (!ch) return false;
  // ASCII letters, underscore, or anything outside ASCII control range
  if (/[A-Za-z_]/.test(ch)) return true;
  const code = ch.charCodeAt(0);
  return code >= 0x80; // 日本語/中文/その他多バイト
}

function isIdentBodyChar(ch) {
  if (!ch) return false;
  if (isIdentStartChar(ch)) return true;
  // 数字に加え、列名で頻出する . （例: "No."）と | （例: "親質問|子質問"）も識別子本体に許可
  return /[0-9.|]/.test(ch);
}

function tokenize(input) {
  const src = String(input || "");
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src.charAt(i);
    // whitespace
    if (/\s/.test(ch)) { i++; continue; }
    // string literal (single or double)
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (src.charAt(j) === quote && src.charAt(j + 1) === quote) { j += 2; continue; }
        if (src.charAt(j) === quote) { j++; break; }
        j++;
      }
      tokens.push({ type: "STRING", raw: src.substring(i, j), value: src.substring(i + 1, j - 1).replace(quote + quote, quote) });
      i = j;
      continue;
    }
    // backtick identifier
    if (ch === "`") {
      let j = i + 1;
      while (j < n && src.charAt(j) !== "`") j++;
      const name = src.substring(i + 1, j);
      tokens.push({ type: "BACKTICK", value: name });
      i = j < n ? j + 1 : j;
      continue;
    }
    // bracket identifier (alasql 互換)
    if (ch === "[") {
      let j = i + 1;
      while (j < n && src.charAt(j) !== "]") j++;
      const name = src.substring(i + 1, j);
      tokens.push({ type: "BACKTICK", value: name });
      i = j < n ? j + 1 : j;
      continue;
    }
    // 日付/時刻リテラル（YYYY-MM-DD, YYYY/MM/DD, optional time 部。日付↔時刻の区切りは `_` / 半角スペース / `T`）→ 文字列扱い
    {
      const dateMatch = src.substring(i).match(/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}(?:[T\s_]\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d+)?)?(?:Z|z|[+-]\d{2}:?\d{2})?)?/);
      if (dateMatch) {
        tokens.push({ type: "STRING", raw: dateMatch[0], value: dateMatch[0] });
        i += dateMatch[0].length;
        continue;
      }
      // 時刻のみ
      const timeMatch = src.substring(i).match(/^\d{1,2}:\d{2}(?::\d{2})?(?=\s|$|[)])/);
      if (timeMatch) {
        tokens.push({ type: "STRING", raw: timeMatch[0], value: timeMatch[0] });
        i += timeMatch[0].length;
        continue;
      }
    }
    // number
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(src.charAt(i + 1)) && (tokens.length === 0 || ["OP", "LP", "COMMA", "KEYWORD"].includes(tokens[tokens.length - 1].type)))) {
      let j = i;
      if (src.charAt(j) === "-") j++;
      while (j < n && /[0-9.]/.test(src.charAt(j))) j++;
      tokens.push({ type: "NUMBER", value: src.substring(i, j) });
      i = j;
      continue;
    }
    // comparison operators
    let matched = null;
    for (const op of CMP_OPS) {
      if (src.substring(i, i + op.length) === op) { matched = op; break; }
    }
    if (matched) {
      // normalize != to <>
      tokens.push({ type: "OP", value: matched === "!=" ? "<>" : matched });
      i += matched.length;
      continue;
    }
    // punctuation
    if (ch === "(") { tokens.push({ type: "LP" }); i++; continue; }
    if (ch === ")") { tokens.push({ type: "RP" }); i++; continue; }
    if (ch === ",") { tokens.push({ type: "COMMA" }); i++; continue; }
    // identifier / keyword
    if (isIdentStartChar(ch)) {
      let j = i + 1;
      while (j < n && isIdentBodyChar(src.charAt(j))) j++;
      const word = src.substring(i, j);
      const upper = word.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: "KEYWORD", value: upper });
      } else {
        tokens.push({ type: "IDENT", value: word });
      }
      i = j;
      continue;
    }
    // 不明文字: そのままスキップ（緩いパース）
    i++;
  }
  return tokens;
}

class Parser {
  constructor(tokens, columns, strict) {
    this.tokens = tokens;
    this.pos = 0;
    this.columns = Array.isArray(columns) ? columns : [];
    this.errors = [];
    this.valueDepth = 0; // 関数引数 / IN リスト等の「値式」コンテキストカウンタ
    this.strict = !!strict;
  }
  peek(offset = 0) { return this.tokens[this.pos + offset] || null; }
  consume() { return this.tokens[this.pos++] || null; }
  isKeyword(t, kw) { return t && t.type === "KEYWORD" && t.value === kw; }
  isAtTerm() {
    const t = this.peek();
    if (!t) return false;
    if (t.type === "RP" || t.type === "COMMA" || t.type === "OP") return false;
    if (this.isKeyword(t, "AND") || this.isKeyword(t, "OR")) return false;
    if (this.isKeyword(t, "IS") || this.isKeyword(t, "LIKE") || this.isKeyword(t, "IN")) return false;
    return true;
  }

  parseQuery() {
    if (this.tokens.length === 0) return null;
    const expr = this.parseOr();
    if (this.peek()) {
      // 余分なトークン
      this.errors.push("予期しないトークンが残っています: " + JSON.stringify(this.peek()));
    }
    return expr;
  }

  isValueMode() { return this.valueDepth > 0; }

  parseOr() {
    let left = this.parseAnd();
    while (this.isKeyword(this.peek(), "OR")) {
      this.consume();
      const right = this.parseAnd();
      left = { type: "binop", op: "OR", left, right };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseTerm();
    while (true) {
      const t = this.peek();
      if (!t) break;
      const before = this.pos;
      if (this.isKeyword(t, "AND")) {
        this.consume();
        const right = this.parseTerm();
        if (this.pos === before) { // 進まないなら脱出（エラー回避）
          this.errors.push("AND の後に項がありません");
          break;
        }
        left = { type: "binop", op: "AND", left, right };
        continue;
      }
      // 暗黙 AND: 次が項の開始トークンならば
      if (this.isAtTerm() && !this.isKeyword(t, "OR")) {
        const right = this.parseTerm();
        if (this.pos === before) { // 進まないなら脱出（不正トークンを skip）
          this.consume();
          this.errors.push("認識できないトークンをスキップしました: " + JSON.stringify(t));
          continue;
        }
        left = { type: "binop", op: "AND", left, right };
        continue;
      }
      break;
    }
    return left;
  }

  parseTerm() {
    const t = this.peek();
    if (this.isKeyword(t, "NOT")) {
      // strict モード: 列無し `NOT LIKE` / `NOT IN` は parseComparable に渡す
      if (this.strict) {
        const next = this.peek(1);
        if (this.isKeyword(next, "LIKE") || this.isKeyword(next, "IN")) {
          return this.parseComparable();
        }
      }
      this.consume();
      const inner = this.parseTerm();
      return { type: "not", expr: inner };
    }
    if (t && t.type === "LP") {
      this.consume();
      const inner = this.parseOr();
      const close = this.peek();
      if (close && close.type === "RP") this.consume();
      else this.errors.push("'(' に対応する ')' がありません");
      return { type: "group", expr: inner };
    }
    return this.parseComparable();
  }

  parseComparable() {
    // strict モードでは LHS 省略形（列無し述語）を許可: `> 'aaa'` / `LIKE '%x%'` / `IN (...)` / `IS NULL`
    // 後段で全検索対象列への OR 展開に変換される。
    if (this.strict) {
      const head = this.peek();
      if (head && head.type === "OP") {
        this.consume();
        const right = this.parseAtom();
        return { type: "cmp", op: head.value, left: null, right };
      }
      if (this.isKeyword(head, "LIKE")) {
        this.consume();
        const right = this.parseAtom();
        return { type: "like", left: null, right, negate: false };
      }
      if (this.isKeyword(head, "NOT") && this.isKeyword(this.peek(1), "LIKE")) {
        this.consume(); this.consume();
        const right = this.parseAtom();
        return { type: "like", left: null, right, negate: true };
      }
      if (this.isKeyword(head, "IN")) {
        this.consume();
        const list = this.parseInList();
        return { type: "in", left: null, list, negate: false };
      }
      if (this.isKeyword(head, "NOT") && this.isKeyword(this.peek(1), "IN")) {
        this.consume(); this.consume();
        const list = this.parseInList();
        return { type: "in", left: null, list, negate: true };
      }
      if (this.isKeyword(head, "IS")) {
        this.consume();
        let negate = false;
        if (this.isKeyword(this.peek(), "NOT")) { this.consume(); negate = true; }
        if (this.isKeyword(this.peek(), "NULL")) {
          this.consume();
          return { type: "isnull", left: null, negate };
        }
        this.errors.push("IS の後は NULL が必要です");
        return null;
      }
    }
    const left = this.parseAtom();
    if (!left) return null;
    const t = this.peek();
    if (!t) return { type: "bare", atom: left };
    // cmpOp
    if (t.type === "OP") {
      this.consume();
      const right = this.parseAtom();
      return { type: "cmp", op: t.value, left, right };
    }
    // IS [NOT] NULL
    if (this.isKeyword(t, "IS")) {
      this.consume();
      let negate = false;
      if (this.isKeyword(this.peek(), "NOT")) { this.consume(); negate = true; }
      if (this.isKeyword(this.peek(), "NULL")) {
        this.consume();
        return { type: "isnull", left, negate };
      }
      this.errors.push("IS の後は NULL が必要です");
      return { type: "bare", atom: left };
    }
    // [NOT] LIKE / [NOT] IN
    if (this.isKeyword(t, "NOT")) {
      const next = this.peek(1);
      if (this.isKeyword(next, "LIKE")) {
        this.consume(); this.consume();
        const right = this.parseAtom();
        return { type: "like", left, right, negate: true };
      }
      if (this.isKeyword(next, "IN")) {
        this.consume(); this.consume();
        const list = this.parseInList();
        return { type: "in", left, list, negate: true };
      }
    }
    if (this.isKeyword(t, "LIKE")) {
      this.consume();
      const right = this.parseAtom();
      return { type: "like", left, right, negate: false };
    }
    if (this.isKeyword(t, "IN")) {
      this.consume();
      const list = this.parseInList();
      return { type: "in", left, list, negate: false };
    }
    // 値モード（関数引数 / IN リスト内）では bare 包装しない
    if (this.isValueMode()) return left;
    return { type: "bare", atom: left };
  }

  parseInList() {
    const t = this.peek();
    if (!t || t.type !== "LP") {
      this.errors.push("IN の後は ( ... ) が必要です");
      return [];
    }
    this.consume();
    this.valueDepth++;
    const items = [];
    try {
      while (true) {
        const t2 = this.peek();
        if (!t2 || t2.type === "RP") break;
        const a = this.parseAtom();
        if (a) items.push(a);
        const sep = this.peek();
        if (sep && sep.type === "COMMA") { this.consume(); continue; }
        break;
      }
    } finally {
      this.valueDepth--;
    }
    if (this.peek() && this.peek().type === "RP") this.consume();
    return items;
  }

  parseAtom() {
    const t = this.peek();
    if (!t) return null;
    if (t.type === "STRING") { this.consume(); return { type: "string", raw: t.raw, value: t.value }; }
    if (t.type === "NUMBER") { this.consume(); return { type: "number", value: t.value }; }
    if (t.type === "BACKTICK") { this.consume(); return { type: "backtick", value: t.value }; }
    if (this.isKeyword(t, "TRUE")) { this.consume(); return { type: "bool", value: true }; }
    if (this.isKeyword(t, "FALSE")) { this.consume(); return { type: "bool", value: false }; }
    if (this.isKeyword(t, "NULL")) { this.consume(); return { type: "null" }; }
    if (t.type === "IDENT") {
      this.consume();
      // 関数呼び出し?
      if (this.peek() && this.peek().type === "LP") {
        this.consume();
        this.valueDepth++;
        const args = [];
        try {
          while (true) {
            const t2 = this.peek();
            if (!t2 || t2.type === "RP") break;
            const a = this.parseOr();
            if (a) args.push(a);
            const sep = this.peek();
            if (sep && sep.type === "COMMA") { this.consume(); continue; }
            break;
          }
        } finally {
          this.valueDepth--;
        }
        if (this.peek() && this.peek().type === "RP") this.consume();
        return { type: "fncall", name: t.value, args };
      }
      return { type: "ident", value: t.value };
    }
    if (t.type === "LP") {
      this.consume();
      const inner = this.parseOr();
      if (this.peek() && this.peek().type === "RP") this.consume();
      return { type: "paren", expr: inner };
    }
    return null;
  }
}

/**
 * 列無し述語（strict モード）を全検索対象列への OR に展開する。
 * 例: `> 'aaa'` → `(\`col1\` > 'aaa') OR (\`col2\` > 'aaa') OR ...`
 * ctx.safeKeys が空のときは "FALSE"。
 *
 * @param {{safeKeys: string[]}} ctx
 * @param {(colExpr: string) => string} buildPredicate 列式 (`\`safeKey\``) を受け取り 1 列分の述語文字列を返す関数
 */
function emitColumnlessOr(ctx, buildPredicate) {
  const keys = (ctx && ctx.safeKeys) || [];
  if (keys.length === 0) return "FALSE";
  const parts = keys.map((k) => "(" + buildPredicate("`" + k + "`") + ")");
  return "(" + parts.join(" OR ") + ")";
}

// 日付/時刻リテラル判定（tokenize の date/time 検出と同等。日付↔時刻の区切りは `_` / 半角スペース / `T`、
// 任意のミリ秒・TZ 指定子（`Z` / `±HH:MM`）も許容）
const DATE_LITERAL_RE = /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}(?:[T\s_]\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d+)?)?(?:\s*(?:Z|z|[+-]\d{2}:?\d{2}))?)?$/;
const TIME_ONLY_LITERAL_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/;

// 日付/時刻リテラルの「自身の kind」を返す。日付/時刻リテラルでなければ null。
//   時刻のみ → "time" / 日付＋時刻 → "datetime" / 日付のみ → "date"
function dateLiteralKind(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (TIME_ONLY_LITERAL_RE.test(v)) return "time";
  if (!DATE_LITERAL_RE.test(v)) return null;
  return /[T\s_]\d{1,2}:\d{1,2}/.test(v) ? "datetime" : "date";
}

// 日付系列との比較オペランド。日付/時刻リテラルは canonical 文字列へ正規化して
// （区切り/ゼロ埋めのゆらぎを吸収）emit する。列側は丸めない＝生文字列比較のまま。
function emitDateAwareOperand(node, ctx) {
  if (node && node.type === "string") {
    const litKind = dateLiteralKind(node.value);
    if (litKind) {
      const canon = formatCanonical(node.value, litKind);
      if (canon != null) return quoteString(canon);
    }
  }
  return emitAtom(node, ctx);
}

function lookupDateLikeColumn(node, ctx) {
  if (!ctx || !ctx.metaByName) return false;
  if (!node) return false;
  if (node.type !== "ident" && node.type !== "backtick") return false;
  const meta = ctx.metaByName.get(node.value);
  return !!(meta && meta.isDateLike);
}

/**
 * 入力 columns（文字列配列 or オブジェクト配列）から評価コンテキストを構築。
 * - safeKeys: LIKE_ANY 用の alasql 安全名配列
 * - metaByName: 識別子からの日付型判定用マップ（ユーザー入力名 / safeKey 両方で引ける）
 * - strict: 後段の emit で参照される。strict モード時は自動 DATE ラップを抑止する
 */
function buildContext(columns, strict) {
  const safeKeys = [];
  const metaByName = new Map();
  if (!Array.isArray(columns)) return { safeKeys, metaByName, strict: !!strict };
  for (const c of columns) {
    if (typeof c === "string") {
      safeKeys.push(c);
      continue;
    }
    if (!c || typeof c !== "object") continue;
    const name = c.name || c.key || "";
    if (!name) continue;
    const safeKey = c.safeKey || headerKeyToAlaSqlKey(name);
    safeKeys.push(safeKey);
    const meta = { safeKey, isDateLike: !!c.isDateLike };
    metaByName.set(name, meta);
    if (safeKey !== name) metaByName.set(safeKey, meta);
  }
  return { safeKeys, metaByName, strict: !!strict };
}

function emitAtom(node, ctx) {
  if (!node) return "NULL";
  switch (node.type) {
    case "string": return quoteString(node.value);
    case "number": return node.value;
    case "bool":   return node.value ? "TRUE" : "FALSE";
    case "null":   return "NULL";
    case "backtick": return "`" + headerKeyToAlaSqlKey(node.value) + "`";
    case "ident":  return "`" + headerKeyToAlaSqlKey(node.value) + "`";
    case "fncall": return node.name + "(" + node.args.map((a) => emit(a, ctx)).join(", ") + ")";
    case "paren":  return "(" + emit(node.expr, ctx) + ")";
    default: return "";
  }
}

function emit(node, ctx) {
  if (!node) return "";
  switch (node.type) {
    // 値モードで bare 包装されなかった atom 系はそのまま emitAtom に委譲
    case "string":
    case "number":
    case "bool":
    case "null":
    case "backtick":
    case "ident":
    case "fncall":
    case "paren":
      return emitAtom(node, ctx);
    case "binop":
      return "(" + emit(node.left, ctx) + ") " + node.op + " (" + emit(node.right, ctx) + ")";
    case "not":
      return "NOT (" + emit(node.expr, ctx) + ")";
    case "group":
      return "(" + emit(node.expr, ctx) + ")";
    case "bare": {
      const a = node.atom;
      // 裸単語 / 数字 / 文字列 → LIKE_ANY (全列横断 LIKE)
      if (a.type === "string" || a.type === "number" || a.type === "ident" || a.type === "backtick") {
        if (!ctx.safeKeys || ctx.safeKeys.length === 0) return "FALSE";
        const needle = a.type === "string" ? quoteString(a.value)
                     : a.type === "number" ? quoteString(String(a.value))
                     : quoteString(a.value);
        const colArgs = ctx.safeKeys.map((k) => "`" + k + "`").join(", ");
        return "LIKE_ANY(" + needle + ", " + colArgs + ")";
      }
      // それ以外（関数呼び出し / ()など）はそのまま真偽値とみなす
      return emitAtom(a, ctx);
    }
    case "cmp": {
      const left = node.left;
      const right = node.right;
      // 列無し（strict モード）: 全検索対象列への OR 展開。
      // リテラルが日付/時刻なら canonical 正規化して比較（date 列が canonical 文字列なので整合）。
      if (left === null) {
        const rhs = emitDateAwareOperand(right, ctx);
        return emitColumnlessOr(ctx, (colExpr) => colExpr + " " + node.op + " " + rhs);
      }
      // 日付系列 ⇔ 日付/時刻リテラル: リテラル側のみ canonical 文字列へ正規化し、
      // 列はフル精度のまま生文字列比較する（簡易・strict 両モード共通）。
      const leftIsDateCol = lookupDateLikeColumn(left, ctx);
      const rightIsDateCol = lookupDateLikeColumn(right, ctx);
      const leftStr = rightIsDateCol ? emitDateAwareOperand(left, ctx) : emitAtom(left, ctx);
      const rightStr = leftIsDateCol ? emitDateAwareOperand(right, ctx) : emitAtom(right, ctx);
      return leftStr + " " + node.op + " " + rightStr;
    }
    case "isnull":
      if (node.left === null) return emitColumnlessOr(ctx, (colExpr) => colExpr + (node.negate ? " IS NOT NULL" : " IS NULL"));
      return emitAtom(node.left, ctx) + (node.negate ? " IS NOT NULL" : " IS NULL");
    case "like":
      if (node.left === null) return emitColumnlessOr(ctx, (colExpr) => colExpr + (node.negate ? " NOT LIKE " : " LIKE ") + emitAtom(node.right, ctx));
      return emitAtom(node.left, ctx) + (node.negate ? " NOT LIKE " : " LIKE ") + emitAtom(node.right, ctx);
    case "in":
      if (node.left === null) return emitColumnlessOr(ctx, (colExpr) => colExpr + (node.negate ? " NOT IN (" : " IN (") + node.list.map((a) => emitAtom(a, ctx)).join(", ") + ")");
      return emitAtom(node.left, ctx) + (node.negate ? " NOT IN (" : " IN (") + node.list.map((a) => emitAtom(a, ctx)).join(", ") + ")";
    default:
      return "";
  }
}

// strict モードで禁止する SQL 句（プレフィックス直後は WHERE 節相当の式のみ受理）
const STRICT_FORBIDDEN_CLAUSES = /(?:^|\s)(FROM|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|UNION|JOIN)\b/i;

export const STRICT_PREFIX_RE = /^\s*(SEARCH|WHERE)\s+/i;

/**
 * 検索クエリ文字列 → alasql 式文字列 への変換。
 *
 * モード判定:
 * - 入力先頭が `SEARCH ` または `WHERE `（大小無視・両者同義）の場合は **strict モード**
 *   - 列無し述語（`> 'aaa'` 等）を全検索対象列への OR 展開として解釈
 *   - `FROM` / `GROUP BY` / `ORDER BY` / `HAVING` / `LIMIT` / `OFFSET` / `UNION` / `JOIN` を含むと構文エラー
 * - それ以外は従来の **簡易モード**（裸単語 LIKE_ANY / 暗黙 AND など）
 *
 * @param {string} query 入力文字列
 * @param {Array<string|{name?: string, safeKey?: string, isDateLike?: boolean}>} columns
 *   - 文字列配列: alasql 安全名（後方互換）
 *   - オブジェクト配列: 列メタ（識別子解決と日付型比較変換用）
 * @returns {{ expr: string|null, errors: string[] }}
 */
export function preprocessSearchQuery(query, columns) {
  let raw = String(query == null ? "" : query);
  let strict = false;
  const m = raw.match(STRICT_PREFIX_RE);
  if (m) {
    strict = true;
    raw = raw.slice(m[0].length);
  }
  if (strict && STRICT_FORBIDDEN_CLAUSES.test(raw)) {
    return {
      expr: null,
      errors: ["FROM / GROUP BY / ORDER BY / HAVING / LIMIT / OFFSET / UNION / JOIN は使用できません"],
    };
  }
  // 簡易モードのみ全角記号オペレータを半角へ正規化（厳密モードは従来どおり半角必須）。
  if (!strict) raw = normalizeFullWidthSearchOperators(raw);
  const tokens = tokenize(raw);
  if (tokens.length === 0) return { expr: null, errors: [] };
  const ctx = buildContext(columns, strict);
  const parser = new Parser(tokens, ctx.safeKeys, strict);
  const ast = parser.parseQuery();
  if (!ast) return { expr: null, errors: parser.errors };
  const expr = emit(ast, ctx);
  return { expr, errors: parser.errors };
}

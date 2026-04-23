/**
 * pipeEngine.js — パイプ変換・トークンスキャナ共有エンジン
 *
 * GAS (V8) とフロントエンド (Vite/ES) の両方から読み込まれる dual-compat モジュール。
 * - GAS 側: bundle.js の FILE_ORDER で早めに含めてグローバル関数として使用。
 * - フロント側: Vite の CommonJS 互換読み込みで末尾の module.exports から取得。
 *
 * 構文は既存 GAS コーディング規約に準拠: var 宣言 / function name() {} /
 * アロー関数・ES class 不使用。
 *
 * このファイルに含めるもの: プラットフォーム非依存の純粋計算。
 * 含めないもの: Session.getScriptTimeZone / Utilities.formatDate / DriveApp 参照。
 * プラットフォーム固有の挙動は context.resolveRef / context.resolveTemplate
 * コールバック経由で注入する。
 */

// ===========================================================================
// § Value serialization
// ===========================================================================

function nfbTemplateValueToString_(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    var parts = [];
    for (var i = 0; i < value.length; i++) {
      if (value[i] === undefined || value[i] === null) continue;
      if (typeof value[i] === "object" && value[i].name) {
        parts.push(String(value[i].name));
      } else {
        parts.push(String(value[i]));
      }
    }
    return parts.join(", ");
  }
  if (typeof value === "object") {
    if (value.name) return String(value.name);
    return JSON.stringify(value);
  }
  return String(value);
}

function nfbStripFileExtension_(name) {
  if (!name || typeof name !== "string") return name || "";
  var dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.substring(0, dotIndex) : name;
}

function nfbJoinList_(list) {
  if (!list || !list.length) return "";
  var parts = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] === undefined || list[i] === null) continue;
    var s = String(list[i]);
    if (s) parts.push(s);
  }
  return parts.join(", ");
}

// ===========================================================================
// § Balanced brace/bracket scanner & top-level split
// ===========================================================================

var NFB_OPEN_TO_CLOSE_ = { "{": "}", "[": "]" };
var NFB_CLOSE_TO_OPEN_ = { "}": "{", "]": "[" };

/**
 * Given the index of an opening "{" or "[", return the index of its matching
 * close. Scan rules differ by opener kind so that pipe-arg payloads (which
 * commonly contain unmatched `[` as regex fragments, e.g. `match:[0-9]+`)
 * inside `{...}` stay tolerant:
 *
 * - Opening `{`: count only `{}` depth. `[` and `]` are treated as plain
 *   content. This preserves legacy tolerant behavior.
 * - Opening `[`: count `{}` depth AND `[]` depth, but `[` / `]` are ignored
 *   whenever `{}` depth > 0 (so unbalanced brackets inside a nested `{...}`
 *   pipe arg don't disturb bracket matching).
 *
 * Returns -1 if never closed.
 */
function nfbFindBalancedCloseIndex_(text, openIndex) {
  var open = text.charAt(openIndex);
  if (!NFB_OPEN_TO_CLOSE_[open]) return -1;
  var n = text.length;
  var j = openIndex + 1;

  if (open === "{") {
    var braceDepth = 1;
    while (j < n) {
      var c = text.charAt(j);
      if (c === "{") braceDepth++;
      else if (c === "}") { braceDepth--; if (braceDepth === 0) return j; }
      j++;
    }
    return -1;
  }

  // open === "["
  var bd = 0;   // brace depth
  var kd = 1;   // bracket depth (starts at 1 for the opener)
  while (j < n) {
    var ch = text.charAt(j);
    if (ch === "{") { bd++; j++; continue; }
    if (ch === "}") { if (bd > 0) bd--; j++; continue; }
    if (bd === 0) {
      if (ch === "[") { kd++; j++; continue; }
      if (ch === "]") { kd--; if (kd === 0) return j; j++; continue; }
    }
    j++;
  }
  return -1;
}

/**
 * Scan a template string and dispatch each top-level balanced token via
 * replacer({ kind: "brace"|"bracket", body, fullToken }) → string.
 * Unclosed opens are left literal.
 */
function nfbScanBalancedTokens_(text, replacer) {
  var out = "";
  var i = 0;
  var n = text.length;
  while (i < n) {
    var ch = text.charAt(i);
    if (ch !== "{" && ch !== "[") {
      out += ch;
      i++;
      continue;
    }
    var close = nfbFindBalancedCloseIndex_(text, i);
    if (close < 0) {
      out += text.substring(i);
      return out;
    }
    var kind = (ch === "{") ? "brace" : "bracket";
    var body = text.substring(i + 1, close);
    var fullToken = text.substring(i, close + 1);
    out += replacer({ kind: kind, body: body, fullToken: fullToken });
    i = close + 1;
  }
  return out;
}

/**
 * Collect every top-level balanced token from text:
 *   [{ kind, fullToken, body }, ...].
 * Used by Google Doc path (needs original token string for replaceText).
 */
function nfbCollectBalancedTokens_(text) {
  var results = [];
  if (!text) return results;
  var n = text.length;
  var i = 0;
  while (i < n) {
    var ch = text.charAt(i);
    if (ch !== "{" && ch !== "[") { i++; continue; }
    var close = nfbFindBalancedCloseIndex_(text, i);
    if (close < 0) return results;
    var kind = (ch === "{") ? "brace" : "bracket";
    results.push({
      kind: kind,
      fullToken: text.substring(i, close + 1),
      body: text.substring(i + 1, close)
    });
    i = close + 1;
  }
  return results;
}

/**
 * Split str on delimiter at top level (depth 0 of {} AND [] nesting), with
 * \<delim> escape support. If maxParts > 0, splits at most maxParts-1 times
 * — remainder goes into last part.
 */
function nfbSplitTopLevel_(str, delimiter, maxParts) {
  var parts = [];
  var current = "";
  var braceDepth = 0;
  var bracketDepth = 0;
  var n = str.length;
  for (var i = 0; i < n; i++) {
    var ch = str.charAt(i);
    if (ch === "\\" && i + 1 < n && str.charAt(i + 1) === delimiter) {
      current += delimiter;
      i++;
      continue;
    }
    if (ch === "{") { braceDepth++; current += ch; continue; }
    if (ch === "}") { if (braceDepth > 0) braceDepth--; current += ch; continue; }
    if (ch === "[") { bracketDepth++; current += ch; continue; }
    if (ch === "]") { if (bracketDepth > 0) bracketDepth--; current += ch; continue; }
    if (ch === delimiter && braceDepth === 0 && bracketDepth === 0
        && (!maxParts || parts.length < maxParts - 1)) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

// ===========================================================================
// § Value coercion (typed values for + operator and parseINT/parseFLOAT)
// ===========================================================================

/**
 * Coerce a parser-internal value (string | number | boolean | null | undefined)
 * to its string form. Mirrors JS String() semantics enough for template output.
 */
function nfbCoerceToString_(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") {
    if (isNaN(value)) return "NaN";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  return String(value);
}

/**
 * `+` operator inside {...} tokens: always string concatenation.
 * Arithmetic is performed inside [...] bracket expressions instead —
 * see nfbEvaluateBracketExpr_.
 */
function nfbAddValues_(left, right) {
  return nfbCoerceToString_(left) + nfbCoerceToString_(right);
}

// ===========================================================================
// § Expression tokenizer
// ===========================================================================

/**
 * Token kinds produced by nfbLexExpression_:
 *   AT        — "@" (starts fieldRef)
 *   IDENT     — identifier (pipe name / function name / bare word / `_` / `true`/`false`)
 *   STRING    — quoted string literal (value = decoded string)
 *   NUMBER    — numeric literal (value = number)
 *   PLUS      — "+"
 *   PIPE      — "|"
 *   COLON     — ":"
 *   COMMA     — ","
 *   LBRACE    — "{"
 *   RBRACE    — "}"
 *   WS        — whitespace (kept so parser can enforce separator rule)
 *   END       — synthetic end-of-input
 *
 * Note: "bare" strings that look like identifiers (letters / Japanese / digits)
 * get IDENT. Other bare non-operator characters (punctuation etc.) get emitted
 * as single-char IDENTs too — the parser treats any run of non-operator
 * characters as a bareWord at the atom level via nfbLexBareWord_.
 */

var NFB_EXPR_TERMINATORS_ = {
  "+": true, "|": true, "{": true, "}": true, "[": true, "]": true,
  ",": true, ":": true, "\"": true, "'": true, "@": true
};

function nfbIsExprTerminator_(ch) {
  if (!ch) return true;
  if (NFB_EXPR_TERMINATORS_[ch]) return true;
  if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") return true;
  return false;
}

function nfbLexStringLiteral_(src, startIdx, quoteCh) {
  var n = src.length;
  var i = startIdx + 1;
  var out = "";
  while (i < n) {
    var ch = src.charAt(i);
    if (ch === "\\" && i + 1 < n) {
      var next = src.charAt(i + 1);
      if (next === quoteCh || next === "\\") {
        out += next;
        i += 2;
        continue;
      }
      out += ch;
      i++;
      continue;
    }
    if (ch === quoteCh) {
      return { value: out, end: i + 1 };
    }
    out += ch;
    i++;
  }
  return { error: "unterminated string literal", end: n };
}

function nfbLexNumberLiteral_(src, startIdx) {
  var n = src.length;
  var i = startIdx;
  if (src.charAt(i) === "-") i++;
  var hadDigit = false;
  while (i < n && src.charAt(i) >= "0" && src.charAt(i) <= "9") { i++; hadDigit = true; }
  if (i < n && src.charAt(i) === ".") {
    i++;
    while (i < n && src.charAt(i) >= "0" && src.charAt(i) <= "9") { i++; hadDigit = true; }
  }
  if (!hadDigit) return null;
  var text = src.substring(startIdx, i);
  return { value: parseFloat(text), end: i };
}

/**
 * Read a bare identifier/word: a run of non-terminator, non-whitespace chars.
 * Backslash escapes any single char (preserves it literally in the resulting name).
 */
function nfbLexBareRun_(src, startIdx) {
  var n = src.length;
  var i = startIdx;
  var out = "";
  while (i < n) {
    var ch = src.charAt(i);
    if (ch === "\\" && i + 1 < n) {
      out += src.charAt(i + 1);
      i += 2;
      continue;
    }
    if (nfbIsExprTerminator_(ch)) break;
    out += ch;
    i++;
  }
  if (i === startIdx) return null;
  return { value: out, end: i };
}

function nfbLexExpression_(src) {
  var tokens = [];
  var n = src.length;
  var i = 0;
  while (i < n) {
    var ch = src.charAt(i);
    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      var ws = "";
      while (i < n && (src.charAt(i) === " " || src.charAt(i) === "\t" || src.charAt(i) === "\n" || src.charAt(i) === "\r")) {
        ws += src.charAt(i); i++;
      }
      tokens.push({ kind: "WS", value: ws, pos: i - ws.length });
      continue;
    }
    // Single-char operators
    if (ch === "+") { tokens.push({ kind: "PLUS", value: "+", pos: i }); i++; continue; }
    if (ch === "|") { tokens.push({ kind: "PIPE", value: "|", pos: i }); i++; continue; }
    if (ch === ":") { tokens.push({ kind: "COLON", value: ":", pos: i }); i++; continue; }
    if (ch === ",") { tokens.push({ kind: "COMMA", value: ",", pos: i }); i++; continue; }
    if (ch === "{") { tokens.push({ kind: "LBRACE", value: "{", pos: i }); i++; continue; }
    if (ch === "}") { tokens.push({ kind: "RBRACE", value: "}", pos: i }); i++; continue; }
    if (ch === "[") { tokens.push({ kind: "LBRACKET", value: "[", pos: i }); i++; continue; }
    if (ch === "]") { tokens.push({ kind: "RBRACKET", value: "]", pos: i }); i++; continue; }
    if (ch === "@") { tokens.push({ kind: "AT", value: "@", pos: i }); i++; continue; }
    // String literals
    if (ch === "\"" || ch === "'") {
      var strStart = i;
      var strRes = nfbLexStringLiteral_(src, i, ch);
      if (strRes.error) {
        return { ok: false, error: { message: strRes.error, position: strStart } };
      }
      tokens.push({ kind: "STRING", value: strRes.value, pos: strStart });
      i = strRes.end;
      continue;
    }
    // Number literal (leading digit; leading `-digit` handled by parser to avoid
    // swallowing a minus that might be meant as subtraction in future grammar)
    if (ch >= "0" && ch <= "9") {
      var numRes = nfbLexNumberLiteral_(src, i);
      if (numRes) {
        tokens.push({ kind: "NUMBER", value: numRes.value, pos: i });
        i = numRes.end;
        continue;
      }
    }
    // Bare identifier / word
    var bareStart = i;
    var bare = nfbLexBareRun_(src, i);
    if (!bare) {
      return { ok: false, error: { message: "unexpected character '" + ch + "'", position: i } };
    }
    tokens.push({ kind: "IDENT", value: bare.value, pos: bareStart });
    i = bare.end;
  }
  tokens.push({ kind: "END", value: "", pos: n });
  return { ok: true, tokens: tokens };
}

// ===========================================================================
// § Expression parser (recursive descent)
// ===========================================================================
//
// Grammar:
//   expression   = pipeExpr
//   pipeExpr     = addExpr ( "|" pipeCall )*
//   pipeCall     = IDENT ( ":" pipeArgs )?   -- pipeArgs is raw text up to next top-level | or end
//   addExpr      = atom ( "+" atom )*
//   atom         = fieldRef | functionCall | subExpr | STRING | NUMBER | bareWord
//   functionCall = IDENT ":" argList         -- only recognized at atom start
//   subExpr      = "{" expression "}"
//   fieldRef     = "@" ( STRING | bareFieldName )
//
// The lexer has already split `{...}` body into tokens. For pipeCall args, we
// collect the RAW source substring (to preserve existing transformer-arg
// semantics such as `replace:,\,` and `map:A=a;B=b`).

function nfbPeekNonWs_(tokens, idx) {
  var j = idx;
  while (j < tokens.length && tokens[j].kind === "WS") j++;
  return j;
}

function nfbTokenAt_(tokens, idx) {
  return tokens[idx] || { kind: "END", value: "", pos: -1 };
}

function nfbParseFieldRef_(tokens, idx) {
  // caller already consumed "@"
  var t = nfbTokenAt_(tokens, idx);
  if (t.kind === "STRING") {
    return { ok: true, name: t.value, nextIdx: idx + 1 };
  }
  if (t.kind === "IDENT") {
    return { ok: true, name: t.value, nextIdx: idx + 1 };
  }
  return { ok: false, error: { message: "@ must be followed by a field name", position: t.pos } };
}

function nfbParseAtom_(tokens, idx, context, rawSrc) {
  idx = nfbPeekNonWs_(tokens, idx);
  var t = nfbTokenAt_(tokens, idx);

  if (t.kind === "END") {
    return { ok: false, error: { message: "unexpected end of expression", position: t.pos } };
  }
  if (t.kind === "AT") {
    var ref = nfbParseFieldRef_(tokens, idx + 1);
    if (!ref.ok) return ref;
    // {@_} resolves to the current pipe value when available. Preserves the
    // legacy behavior that sub-template `{@_}` inside pipe args gets the value
    // the enclosing pipe was fed.
    if (ref.name === "_" && context && Object.prototype.hasOwnProperty.call(context, "__pipeValue__")) {
      return { ok: true, value: context.__pipeValue__, nextIdx: ref.nextIdx };
    }
    var resolved = nfbResolveRefWithCallback_(ref.name, context);
    return { ok: true, value: resolved, nextIdx: ref.nextIdx };
  }
  if (t.kind === "STRING") {
    return { ok: true, value: t.value, nextIdx: idx + 1 };
  }
  if (t.kind === "NUMBER") {
    return { ok: true, value: t.value, nextIdx: idx + 1 };
  }
  if (t.kind === "LBRACE") {
    // subExpr: find matching RBRACE by counting braces, then evaluate body
    var depth = 1;
    var j = idx + 1;
    while (j < tokens.length && depth > 0) {
      if (tokens[j].kind === "LBRACE") depth++;
      else if (tokens[j].kind === "RBRACE") { depth--; if (depth === 0) break; }
      j++;
    }
    if (depth !== 0) {
      return { ok: false, error: { message: "unclosed '{' in expression", position: t.pos } };
    }
    // Evaluate the nested subExpr by operating on the raw source substring
    // so pipe-arg raw-text semantics are preserved inside.
    var openPos = tokens[idx].pos + 1;
    var closePos = tokens[j].pos;
    var subBody = rawSrc.substring(openPos, closePos);
    var subRes = nfbEvaluateExpressionSource_(subBody, context);
    if (!subRes.ok) {
      return { ok: false, error: subRes.error };
    }
    return { ok: true, value: subRes.value, nextIdx: j + 1 };
  }
  if (t.kind === "LBRACKET") {
    // Find matching RBRACKET by counting both bracket and brace depth so that
    // nested {...} or [...] inside the body do not confuse the scan.
    var bDepth = 1;
    var cDepth = 0;
    var k = idx + 1;
    while (k < tokens.length) {
      var tk = tokens[k].kind;
      if (tk === "LBRACKET") bDepth++;
      else if (tk === "RBRACKET") {
        if (cDepth === 0) { bDepth--; if (bDepth === 0) break; }
      } else if (tk === "LBRACE") cDepth++;
      else if (tk === "RBRACE") { if (cDepth > 0) cDepth--; }
      k++;
    }
    if (k >= tokens.length || tokens[k].kind !== "RBRACKET" || bDepth !== 0) {
      return { ok: false, error: { message: "unclosed '[' in expression", position: t.pos } };
    }
    var openPos2 = tokens[idx].pos + 1;
    var closePos2 = tokens[k].pos;
    var bracketBody = rawSrc.substring(openPos2, closePos2);
    var bRes = nfbEvaluateBracketExpr_(bracketBody, context);
    if (!bRes.ok) return { ok: false, error: bRes.error };
    return { ok: true, value: bRes.value, nextIdx: k + 1 };
  }
  if (t.kind === "IDENT") {
    // Possible function call: IDENT ":" argList, but only at atom start.
    var next = nfbTokenAt_(tokens, idx + 1);
    if (next.kind === "COLON") {
      return nfbParseFunctionCall_(t.value, tokens, idx + 2, context, rawSrc, t.pos);
    }
    // Bare word. Handle special identifier `_` → pipe input value if available.
    if (t.value === "_" && context && Object.prototype.hasOwnProperty.call(context, "__pipeValue__")) {
      return { ok: true, value: context.__pipeValue__, nextIdx: idx + 1 };
    }
    return { ok: true, value: t.value, nextIdx: idx + 1 };
  }
  return { ok: false, error: { message: "unexpected token '" + t.value + "'", position: t.pos } };
}

function nfbParseAddExpr_(tokens, idx, context, rawSrc) {
  var first = nfbParseAtom_(tokens, idx, context, rawSrc);
  if (!first.ok) return first;
  var value = first.value;
  var cur = first.nextIdx;
  while (true) {
    var c = nfbPeekNonWs_(tokens, cur);
    var t = nfbTokenAt_(tokens, c);
    if (t.kind !== "PLUS") break;
    var rhs = nfbParseAtom_(tokens, c + 1, context, rawSrc);
    if (!rhs.ok) {
      if (rhs.error && rhs.error.message === "unexpected end of expression") {
        return { ok: false, error: { message: "unexpected end of expression after '+'", position: t.pos } };
      }
      return rhs;
    }
    value = nfbAddValues_(value, rhs.value);
    cur = rhs.nextIdx;
  }
  return { ok: true, value: value, nextIdx: cur };
}

/**
 * Extract the raw source substring that makes up a single pipe-call args
 * region: everything from `startPos` up to (but not including) the next
 * top-level `|` or the end of the input at `endPos`. Respects `{...}` nesting
 * and `\|` escape (consistent with existing nfbSplitTopLevel_ semantics).
 */
function nfbExtractPipeTail_(rawSrc, startPos, endPos) {
  var i = startPos;
  var out = "";
  var braceDepth = 0;
  var bracketDepth = 0;
  while (i < endPos) {
    var ch = rawSrc.charAt(i);
    if (ch === "\\" && i + 1 < endPos) {
      var next = rawSrc.charAt(i + 1);
      if (next === "|") {
        // Strip the pipe escape: `\|` -> literal `|` inside pipe args
        out += next;
      } else {
        // Preserve other escapes (e.g. `\,` remains intact for downstream split)
        out += ch + next;
      }
      i += 2;
      continue;
    }
    if (ch === "{") { braceDepth++; out += ch; i++; continue; }
    if (ch === "}") { if (braceDepth > 0) braceDepth--; out += ch; i++; continue; }
    if (ch === "[") { bracketDepth++; out += ch; i++; continue; }
    if (ch === "]") { if (bracketDepth > 0) bracketDepth--; out += ch; i++; continue; }
    if (ch === "|" && braceDepth === 0 && bracketDepth === 0) break;
    out += ch;
    i++;
  }
  return { text: out, end: i };
}

function nfbParsePipeExpr_(tokens, idx, context, rawSrc) {
  var head = nfbParseAddExpr_(tokens, idx, context, rawSrc);
  if (!head.ok) return head;
  var value = head.value;
  var cur = nfbPeekNonWs_(tokens, head.nextIdx);

  while (true) {
    var t = nfbTokenAt_(tokens, cur);
    if (t.kind === "END" || t.kind === "RBRACE") break;
    if (t.kind !== "PIPE") {
      return { ok: false, error: { message: "unexpected token '" + t.value + "' after expression", position: t.pos } };
    }
    // Skip optional whitespace after |
    var nextIdx = nfbPeekNonWs_(tokens, cur + 1);
    var nameTok = nfbTokenAt_(tokens, nextIdx);
    if (nameTok.kind !== "IDENT") {
      return { ok: false, error: { message: "expected pipe name after '|'", position: t.pos } };
    }
    var pipeName = nameTok.value;
    var afterName = nfbPeekNonWs_(tokens, nextIdx + 1);
    var colonTok = nfbTokenAt_(tokens, afterName);
    var pipeArgs = "";
    var advanceTo = afterName;
    if (colonTok.kind === "COLON") {
      // raw text from after the colon up to next top-level | or end
      var argStartPos = colonTok.pos + 1;
      // end of input in rawSrc is rawSrc.length
      var tail = nfbExtractPipeTail_(rawSrc, argStartPos, rawSrc.length);
      pipeArgs = tail.text;
      // now advance `cur` past all tokens whose pos < tail.end
      advanceTo = afterName + 1;
      while (advanceTo < tokens.length && tokens[advanceTo].pos < tail.end) advanceTo++;
    }
    // Apply pipe
    var pipeCtx = context;
    var fn = NFB_TRANSFORMERS_[pipeName];
    var inputForPipe;
    if (fn && fn.__typedSafe__) {
      inputForPipe = value;
    } else if (!fn) {
      // unknown pipe — preserve legacy "silent pass-through" but emit a warn
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("[nfb template] unknown pipe: '" + pipeName + "'");
      }
      cur = nfbPeekNonWs_(tokens, advanceTo);
      continue;
    } else {
      inputForPipe = nfbCoerceToString_(value);
    }
    try {
      value = fn(inputForPipe, pipeArgs, pipeCtx);
    } catch (e) {
      return { ok: false, error: { message: "pipe '" + pipeName + "' failed: " + (e && e.message ? e.message : String(e)), position: t.pos } };
    }
    cur = nfbPeekNonWs_(tokens, advanceTo);
  }
  return { ok: true, value: value, nextIdx: cur };
}

/**
 * Registry of top-level functions (invoked as {name:arg1,arg2,...} at atom start).
 * Each entry = function(argsText, context) -> value.
 */
var NFB_FUNCTIONS_ = {};

function nfbParseFunctionCall_(name, tokens, idx, context, rawSrc, startPos) {
  // Collect raw args text from startPos's next-char (":") position +1 up to the
  // next token that would terminate the atom: RBRACE, PIPE, or PLUS at depth 0.
  // (We do NOT stop at COMMA because commas are internal to argList.)
  var colonPosTok = nfbTokenAt_(tokens, idx - 1);
  var argStart = colonPosTok.pos + 1;
  // Walk rawSrc respecting brace/bracket/escape depth until we hit a
  // top-level terminator.
  var i = argStart;
  var n = rawSrc.length;
  var braceDepth = 0;
  var bracketDepth = 0;
  while (i < n) {
    var ch = rawSrc.charAt(i);
    if (ch === "\\" && i + 1 < n) { i += 2; continue; }
    if (ch === "{") { braceDepth++; i++; continue; }
    if (ch === "}") { if (braceDepth === 0) break; braceDepth--; i++; continue; }
    if (ch === "[") { bracketDepth++; i++; continue; }
    if (ch === "]") { if (bracketDepth > 0) bracketDepth--; i++; continue; }
    if (braceDepth === 0 && bracketDepth === 0 && (ch === "|" || ch === "+")) break;
    i++;
  }
  var argsText = rawSrc.substring(argStart, i);
  // Advance tokens to match
  var advanceTo = idx;
  while (advanceTo < tokens.length && tokens[advanceTo].pos < i) advanceTo++;

  var fn = NFB_FUNCTIONS_[name];
  if (!fn) {
    return { ok: false, error: { message: "unknown function: '" + name + "'", position: startPos } };
  }
  try {
    var result = fn(argsText, context);
    if (result && result.ok === false) {
      return { ok: false, error: result.error };
    }
    return { ok: true, value: (result && Object.prototype.hasOwnProperty.call(result, "value")) ? result.value : result, nextIdx: advanceTo };
  } catch (e) {
    return { ok: false, error: { message: "function '" + name + "' failed: " + (e && e.message ? e.message : String(e)), position: startPos } };
  }
}

// ---------------------------------------------------------------------------
// Built-in function: if (unified 3-arg; same semantics as former ifv).
// ---------------------------------------------------------------------------

NFB_FUNCTIONS_["if"] = function(argsText, context) {
  var parts = nfbSplitTopLevel_(argsText, ",", 3);
  if (parts.length < 3) {
    return { ok: false, error: { message: "if expects 3 arguments (condition, trueValue, falseValue), got " + parts.length } };
  }
  var pipeValue = (context && Object.prototype.hasOwnProperty.call(context, "__pipeValue__"))
    ? context.__pipeValue__ : undefined;
  var matched = nfbEvaluateIfCondition_(parts[0], context, pipeValue);
  var chosen = matched ? parts[1] : parts[2];
  return nfbResolveIfValue_(chosen, context, pipeValue);
};

// ===========================================================================
// § Top-level evaluator (entry point called by scanner)
// ===========================================================================

/**
 * Evaluate a single `{...}` token body. Returns:
 *   { ok: true, value: <final string> }
 *   { ok: false, error: { message, position }, fallback: <original token text> }
 */
function nfbEvaluateToken_(body, context) {
  var res = nfbEvaluateExpressionSource_(body, context);
  if (!res.ok) {
    return { ok: false, error: res.error, fallback: "{" + body + "}" };
  }
  return { ok: true, value: nfbCoerceToString_(res.value) };
}

function nfbEvaluateExpressionSource_(src, context) {
  var lexed = nfbLexExpression_(src);
  if (!lexed.ok) return lexed;
  var parsed = nfbParsePipeExpr_(lexed.tokens, 0, context, src);
  if (!parsed.ok) return parsed;
  // Ensure all tokens consumed
  var trailing = nfbPeekNonWs_(lexed.tokens, parsed.nextIdx);
  var tail = nfbTokenAt_(lexed.tokens, trailing);
  if (tail.kind !== "END") {
    return { ok: false, error: { message: "unexpected token '" + tail.value + "' after expression", position: tail.pos } };
  }
  return { ok: true, value: parsed.value };
}

// ===========================================================================
// § Bracket expression evaluator ([ ... ] — JavaScript semantics)
// ===========================================================================

var NFB_STRICT_NUMBER_RE_ = /^-?\d+(\.\d+)?$/;

/**
 * Evaluate the body of a [...] expression as a JavaScript expression.
 *
 * - Any nested `{...}` is evaluated via the pipe engine; its string result must
 *   match a strict numeric pattern, then is converted to Number(). Non-numeric
 *   or empty values produce an error (which bubbles up → outer [...] stays
 *   literal).
 * - Any nested `[...]` is recursively evaluated; its JS value (number/bool/…)
 *   is substituted as-is.
 * - The rewritten body (with placeholders `__nfb_vN__`) is compiled via
 *   `new Function(argNames, "return (" + body + ");")` and invoked with the
 *   captured values. Values are bound as function ARGUMENTS, never interpolated
 *   into source — so field data cannot inject JS code.
 * - A NaN result is treated as an error so the author sees it instead of a
 *   silent "NaN" string in the output.
 *
 * Returns { ok: true, value } or { ok: false, error: { message, position } }.
 */
function nfbEvaluateBracketExpr_(body, context) {
  if (body === undefined || body === null) {
    return { ok: false, error: { message: "empty [] expression", position: 0 } };
  }
  var trimmed = body.replace(/^\s+|\s+$/g, "");
  if (trimmed === "") {
    return { ok: false, error: { message: "empty [] expression", position: 0 } };
  }

  var argNames = [];
  var argValues = [];
  var rewritten = "";
  var n = body.length;
  var i = 0;
  while (i < n) {
    var ch = body.charAt(i);
    // Preserve JS string literals verbatim — {, [ inside them are not tokens.
    if (ch === "\"" || ch === "'") {
      var q = ch;
      rewritten += ch;
      i++;
      while (i < n) {
        var c2 = body.charAt(i);
        rewritten += c2;
        if (c2 === "\\" && i + 1 < n) {
          rewritten += body.charAt(i + 1);
          i += 2;
          continue;
        }
        i++;
        if (c2 === q) break;
      }
      continue;
    }
    if (ch === "{") {
      var closeB = nfbFindBalancedCloseIndex_(body, i);
      if (closeB < 0) {
        return { ok: false, error: { message: "unclosed '{' inside [...]", position: i } };
      }
      var innerBody = body.substring(i + 1, closeB);
      var innerRes = nfbEvaluateToken_(innerBody, context);
      if (!innerRes.ok) return { ok: false, error: innerRes.error };
      var s = nfbCoerceToString_(innerRes.value).replace(/^\s+|\s+$/g, "");
      if (s === "" || !NFB_STRICT_NUMBER_RE_.test(s)) {
        return { ok: false, error: { message: "non-numeric value in [...]: '" + s + "'", position: i } };
      }
      var num = parseFloat(s);
      if (isNaN(num)) {
        return { ok: false, error: { message: "non-numeric value in [...]: '" + s + "'", position: i } };
      }
      var name = "__nfb_v" + argNames.length + "__";
      argNames.push(name);
      argValues.push(num);
      rewritten += name;
      i = closeB + 1;
      continue;
    }
    if (ch === "[") {
      var closeK = nfbFindBalancedCloseIndex_(body, i);
      if (closeK < 0) {
        return { ok: false, error: { message: "unclosed '[' inside [...]", position: i } };
      }
      var inner2 = body.substring(i + 1, closeK);
      var inner2Res = nfbEvaluateBracketExpr_(inner2, context);
      if (!inner2Res.ok) return { ok: false, error: inner2Res.error };
      var name2 = "__nfb_v" + argNames.length + "__";
      argNames.push(name2);
      argValues.push(inner2Res.value);
      rewritten += name2;
      i = closeK + 1;
      continue;
    }
    rewritten += ch;
    i++;
  }

  var source = "return (" + rewritten + ");";
  var fn;
  try {
    fn = nfbBuildFunction_(argNames, source);
  } catch (e) {
    return { ok: false, error: { message: "syntax error in [...]: " + (e && e.message ? e.message : String(e)), position: 0 } };
  }
  var result;
  try {
    result = fn.apply(null, argValues);
  } catch (e2) {
    return { ok: false, error: { message: "runtime error in [...]: " + (e2 && e2.message ? e2.message : String(e2)), position: 0 } };
  }
  if (typeof result === "number" && isNaN(result)) {
    return { ok: false, error: { message: "NaN result in [...]", position: 0 } };
  }
  return { ok: true, value: result };
}

function nfbBuildFunction_(argNames, source) {
  // Ordered argNames + body. Works under both GAS V8 and modern browsers
  // (subject to CSP: if `new Function` is disabled, this throws and the
  // caller's try/catch causes the outer [...] to render literally).
  return Function.apply(null, argNames.concat([source]));
}

/**
 * Extract the set of field-label references (`@name`) used anywhere inside a
 * template string. Used by the substitution-field dependency graph.
 * Returns an array of unique names (order of first appearance). Reserved names
 * (leading underscore) are excluded.
 */
function nfbExtractFieldRefs_(template) {
  var out = [];
  var seen = {};
  if (!template || typeof template !== "string") return out;
  var tokens = nfbCollectBalancedTokens_(template);
  for (var i = 0; i < tokens.length; i++) {
    nfbCollectFieldRefsFromToken_(tokens[i], out, seen);
  }
  return out;
}

function nfbCollectFieldRefsFromToken_(tok, out, seen) {
  var body = tok.body;
  if (tok.kind === "brace") {
    var lex = nfbLexExpression_(body);
    if (lex.ok) {
      var ts = lex.tokens;
      for (var j = 0; j < ts.length; j++) {
        if (ts[j].kind !== "AT") continue;
        var next = j + 1;
        while (next < ts.length && ts[next].kind === "WS") next++;
        var nt = ts[next];
        if (!nt) continue;
        if (nt.kind === "STRING" || nt.kind === "IDENT") {
          var name = nt.value;
          if (!name || name.charAt(0) === "_") continue;
          if (!seen[name]) {
            seen[name] = true;
            out.push(name);
          }
        }
      }
    }
  }
  // Recurse into nested {...} / [...] inside this body (for bracket bodies
  // and for brace bodies that embed [...] as atoms).
  var sub = nfbCollectBalancedTokens_(body);
  for (var k = 0; k < sub.length; k++) {
    nfbCollectFieldRefsFromToken_(sub[k], out, seen);
  }
}

// ===========================================================================
// § Japanese era resolver
// ===========================================================================

var NFB_ERAS_ = [
  { name: "令和", year: 2019, month: 5, day: 1 },
  { name: "平成", year: 1989, month: 1, day: 8 },
  { name: "昭和", year: 1926, month: 12, day: 25 },
  { name: "大正", year: 1912, month: 7, day: 30 },
  { name: "明治", year: 1868, month: 1, day: 25 }
];

function nfbDatePartsIsSameOrAfter_(dateParts, comparison) {
  if (dateParts.year !== comparison.year) return dateParts.year > comparison.year;
  if (dateParts.month !== comparison.month) return dateParts.month > comparison.month;
  return dateParts.day >= comparison.day;
}

function nfbResolveJapaneseEra_(dateParts) {
  for (var i = 0; i < NFB_ERAS_.length; i++) {
    if (nfbDatePartsIsSameOrAfter_(dateParts, NFB_ERAS_[i])) {
      return { name: NFB_ERAS_[i].name, year: dateParts.year - NFB_ERAS_[i].year + 1 };
    }
  }
  return { name: "", year: dateParts.year };
}

// ===========================================================================
// § Date/time parsers
// ===========================================================================

function nfbParseDateString_(value) {
  var str = String(value).replace(/^\s+|\s+$/g, "");
  var m = str.match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  var m2 = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return { year: Number(m2[1]), month: Number(m2[2]), day: Number(m2[3]) };
  return null;
}

function nfbParseTimeString_(value) {
  var str = String(value).replace(/^\s+|\s+$/g, "");
  var dtMatch = str.match(/[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dtMatch) return { hour: Number(dtMatch[1]), minute: Number(dtMatch[2]), second: dtMatch[3] ? Number(dtMatch[3]) : 0 };
  var tMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (tMatch) return { hour: Number(tMatch[1]), minute: Number(tMatch[2]), second: tMatch[3] ? Number(tMatch[3]) : 0 };
  return null;
}

var NFB_DAY_OF_WEEK_SHORT_ = ["日", "月", "火", "水", "木", "金", "土"];
var NFB_DAY_OF_WEEK_LONG_ = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

function nfbReplaceFormatTokens_(formatStr, replacements) {
  var result = formatStr;
  for (var i = 0; i < replacements.length; i++) {
    result = result.split(replacements[i][0]).join(replacements[i][1]);
  }
  return result;
}

/**
 * Format a Date to "yyyy-MM-dd HH:mm:ss" in local time. Platform-neutral fallback
 * used when no GAS Utilities.formatDate is available (frontend).
 */
function nfbFormatNowLocal_(date) {
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate())
    + " " + pad2(date.getHours()) + ":" + pad2(date.getMinutes()) + ":" + pad2(date.getSeconds());
}

// ===========================================================================
// § Time transformer
// ===========================================================================

function nfbTransformTime_(value, formatStr) {
  var dateParts = nfbParseDateString_(value);
  var timeParts = nfbParseTimeString_(value);
  if (!dateParts && !timeParts) return value;

  var result = formatStr;
  if (dateParts) {
    var era = nfbResolveJapaneseEra_(dateParts);
    var dow = new Date(dateParts.year, dateParts.month - 1, dateParts.day).getDay();
    // Longer tokens first to avoid partial replacement (e.g. "MM" before "M")
    result = nfbReplaceFormatTokens_(result, [
      ["dddd", NFB_DAY_OF_WEEK_LONG_[dow]],
      ["ddd",  NFB_DAY_OF_WEEK_SHORT_[dow]],
      ["gg",   era.name],
      ["YYYY", String(dateParts.year)],
      ["YY",   ("0" + dateParts.year).slice(-2)],
      ["MM",   ("0" + dateParts.month).slice(-2)],
      ["DD",   ("0" + dateParts.day).slice(-2)],
      ["ee",   ("0" + era.year).slice(-2)],
      ["M",    String(dateParts.month)],
      ["D",    String(dateParts.day)],
      ["e",    String(era.year)]
    ]);
  }
  if (timeParts) {
    result = nfbReplaceFormatTokens_(result, [
      ["HH", ("0" + timeParts.hour).slice(-2)],
      ["mm", ("0" + timeParts.minute).slice(-2)],
      ["ss", ("0" + timeParts.second).slice(-2)],
      ["H",  String(timeParts.hour)],
      ["m",  String(timeParts.minute)],
      ["s",  String(timeParts.second)]
    ]);
  }
  return result;
}

// ===========================================================================
// § String transformers
// ===========================================================================

function nfbTransformLeft_(value, args) {
  var n = parseInt(args, 10);
  if (isNaN(n) || n < 0) return value;
  return value.substring(0, n);
}

function nfbTransformRight_(value, args) {
  var n = parseInt(args, 10);
  if (isNaN(n) || n < 0) return value;
  return n >= value.length ? value : value.substring(value.length - n);
}

function nfbTransformMid_(value, args) {
  var parts = args.split(",");
  var start = parseInt(parts[0], 10);
  var length = parts.length > 1 ? parseInt(parts[1], 10) : undefined;
  if (isNaN(start) || start < 0) return value;
  if (length !== undefined && (isNaN(length) || length < 0)) return value;
  return length !== undefined ? value.substr(start, length) : value.substring(start);
}

function nfbTransformPad_(value, args) {
  var parts = args.split(",");
  var length = parseInt(parts[0], 10);
  var padChar = parts.length > 1 ? parts[1] : "0";
  if (isNaN(length) || length <= 0) return value;
  return value.padStart(length, padChar);
}

function nfbTransformPadRight_(value, args) {
  var parts = args.split(",");
  var length = parseInt(parts[0], 10);
  var padChar = parts.length > 1 ? parts[1] : " ";
  if (isNaN(length) || length <= 0) return value;
  return value.padEnd(length, padChar);
}

function nfbTransformUpper_(value) { return value.toUpperCase(); }
function nfbTransformLower_(value) { return value.toLowerCase(); }
function nfbTransformTrim_(value) { return value.replace(/^\s+|\s+$/g, ""); }

function nfbTransformReplace_(value, args) {
  var parts = nfbSplitTopLevel_(args, ",", 2);
  if (parts.length < 2) return value;
  return value.split(parts[0]).join(parts[1]);
}

function nfbTransformMatch_(value, args) {
  var lastComma = args.lastIndexOf(",");
  var pattern, groupIndex;
  if (lastComma >= 0) {
    var possibleGroup = args.substring(lastComma + 1).replace(/^\s+|\s+$/g, "");
    if (/^\d+$/.test(possibleGroup)) {
      pattern = args.substring(0, lastComma);
      groupIndex = parseInt(possibleGroup, 10);
    } else {
      pattern = args;
      groupIndex = 0;
    }
  } else {
    pattern = args;
    groupIndex = 0;
  }
  try {
    var re = new RegExp(pattern);
    var m = value.match(re);
    return m && m[groupIndex] !== undefined ? m[groupIndex] : "";
  } catch (e) {
    return value;
  }
}

function nfbTransformNumber_(value, formatStr) {
  var num = parseFloat(String(value).replace(/^\s+|\s+$/g, ""));
  if (isNaN(num)) return value;

  var isNeg = num < 0;
  num = Math.abs(num);

  var fmtMatch = formatStr.match(/^([^#0,.]*)([#0,.]+)(.*)$/);
  if (!fmtMatch) return value;
  var prefix = fmtMatch[1];
  var numFmt = fmtMatch[2];
  var suffix = fmtMatch[3];

  var dotIndex = numFmt.indexOf(".");
  var decimalPlaces = 0;
  var useThousands = numFmt.indexOf(",") >= 0;
  if (dotIndex >= 0) decimalPlaces = numFmt.length - dotIndex - 1;

  var fixed = num.toFixed(decimalPlaces);
  var intPart, decPart;
  if (decimalPlaces > 0) {
    var parts = fixed.split(".");
    intPart = parts[0];
    decPart = parts[1];
  } else {
    intPart = fixed.split(".")[0];
    decPart = "";
  }

  if (useThousands) {
    var formatted = "";
    for (var i = intPart.length - 1, count = 0; i >= 0; i--, count++) {
      if (count > 0 && count % 3 === 0) formatted = "," + formatted;
      formatted = intPart.charAt(i) + formatted;
    }
    intPart = formatted;
  }

  var result = (isNeg ? "-" : "") + prefix + intPart;
  if (decimalPlaces > 0) result += "." + decPart;
  result += suffix;

  return result;
}

// ===========================================================================
// § Condition evaluator (used by if / ifv)
// ===========================================================================

/**
 * Resolve @name reference for condition operands / value positions.
 * Uses context.resolveRef callback for platform-specific behavior (GAS =
 * reserved + field lookup with Session.getScriptTimeZone; frontend = reserved
 * + labelValueMap). Falls back to labelValueMap if callback absent.
 */
function nfbResolveRefWithCallback_(name, context) {
  if (context && typeof context.resolveRef === "function") {
    return context.resolveRef(name);
  }
  var map = (context && context.labelValueMap) || {};
  return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : "";
}

function nfbResolveConditionOperand_(operand, context, pipeValue) {
  var s = operand.replace(/^\s+|\s+$/g, "");
  if (s === "_" && pipeValue !== undefined) return pipeValue;
  if (s.charAt(0) === "@" && s.length > 1) {
    return nfbResolveRefWithCallback_(s.substring(1), context);
  }
  if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
    return s.substring(1, s.length - 1);
  }
  return s;
}

function nfbCompare_(left, right, operator) {
  if (operator === "==") return left === right;
  if (operator === "!=") return left !== right;
  if (operator === "in") return right.indexOf(left) >= 0;

  var numLeft = parseFloat(left);
  var numRight = parseFloat(right);
  var useNumeric = !isNaN(numLeft) && !isNaN(numRight)
    && String(left).replace(/^\s+|\s+$/g, "") !== ""
    && String(right).replace(/^\s+|\s+$/g, "") !== "";

  if (useNumeric) {
    if (operator === ">")  return numLeft > numRight;
    if (operator === ">=") return numLeft >= numRight;
    if (operator === "<")  return numLeft < numRight;
    if (operator === "<=") return numLeft <= numRight;
  } else {
    if (operator === ">")  return left > right;
    if (operator === ">=") return left >= right;
    if (operator === "<")  return left < right;
    if (operator === "<=") return left <= right;
  }
  return false;
}

function nfbEvaluateIfCondition_(conditionStr, context, pipeValue) {
  var str = conditionStr.replace(/^\s+|\s+$/g, "");

  var negate = false;
  if (str.length >= 4 && str.substring(0, 4) === "not ") {
    negate = true;
    str = str.substring(4).replace(/^\s+/, "");
  }

  var inIdx = str.indexOf(" in ");
  if (inIdx >= 0) {
    var inLeft = nfbResolveConditionOperand_(str.substring(0, inIdx), context, pipeValue);
    var inRight = nfbResolveConditionOperand_(str.substring(inIdx + 4), context, pipeValue);
    var inResult = nfbCompare_(inLeft, inRight, "in");
    return negate ? !inResult : inResult;
  }

  var opMatch = str.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  var result;
  if (opMatch) {
    var leftVal = nfbResolveConditionOperand_(opMatch[1], context, pipeValue);
    var rightVal = nfbResolveConditionOperand_(opMatch[3], context, pipeValue);
    result = nfbCompare_(leftVal, rightVal, opMatch[2]);
  } else {
    var val = nfbResolveConditionOperand_(str, context, pipeValue);
    result = !!val;
  }

  return negate ? !result : result;
}

/**
 * Resolve a value position for if elseValue / ifv true/false / default fallback.
 * Supports:
 *   ""         -> ""
 *   "_"        -> pipeValue
 *   "\_"       -> literal "_"
 *   "@name"    -> resolveRef
 *   "{...}"    -> sub-template via context.resolveTemplate callback
 *   literal    -> as-is
 */
function nfbResolveIfValue_(valueStr, context, pipeValue) {
  if (valueStr === "") return "";
  if (valueStr === "_") return pipeValue;
  if (valueStr === "\\_") return "_";
  if (valueStr.indexOf("{") >= 0 && context && typeof context.resolveTemplate === "function") {
    return context.resolveTemplate(valueStr, pipeValue);
  }
  if (valueStr.charAt(0) === "@" && valueStr.length > 1) {
    return nfbResolveRefWithCallback_(valueStr.substring(1), context);
  }
  return valueStr;
}

// ===========================================================================
// § Conditional transformers
// ===========================================================================

/**
 * Unified 3-arg conditional: {@value|if:condition,trueValue,falseValue}.
 * Merges the former pipe-form `if` (2-arg) and `ifv` (3-arg) into a single
 * 3-arg form. If argument count != 3, passes the input value through
 * (preserving the lenient "silent pass-through" behavior of unknown transforms).
 */
function nfbTransformIf_(value, args, context) {
  var parts = nfbSplitTopLevel_(args, ",", 3);
  if (parts.length < 3) {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("[nfb template] |if: expects 3 arguments (condition, trueValue, falseValue), got " + parts.length);
    }
    return value;
  }
  var matched = nfbEvaluateIfCondition_(parts[0], context, value);
  if (matched) return nfbResolveIfValue_(parts[1], context, value);
  return nfbResolveIfValue_(parts[2], context, value);
}

function nfbTransformMap_(value, args) {
  var entries = args.split(";");
  var fallback = value;
  for (var i = 0; i < entries.length; i++) {
    var eqIndex = entries[i].indexOf("=");
    if (eqIndex < 0) continue;
    var key = entries[i].substring(0, eqIndex);
    var val = entries[i].substring(eqIndex + 1);
    if (key === "*") { fallback = val; continue; }
    if (value === key) return val;
  }
  return fallback;
}

function nfbTransformDefault_(value, args, context) {
  if (value) return value;
  return nfbResolveIfValue_(String(args), context, value);
}

// ===========================================================================
// § Kana / fullwidth / halfwidth transformers
// ===========================================================================

function nfbTransformKana_(value) {
  var result = "";
  for (var i = 0; i < value.length; i++) {
    var code = value.charCodeAt(i);
    if (code >= 0x3041 && code <= 0x3096) {
      result += String.fromCharCode(code + 0x60);
    } else {
      result += value.charAt(i);
    }
  }
  return result;
}

var NFB_HALFWIDTH_KANA_MAP_ = {
  "ｦ": "ヲ", "ｧ": "ァ", "ｨ": "ィ", "ｩ": "ゥ",
  "ｪ": "ェ", "ｫ": "ォ", "ｬ": "ャ", "ｭ": "ュ",
  "ｮ": "ョ", "ｯ": "ッ", "ｰ": "ー",
  "ｱ": "ア", "ｲ": "イ", "ｳ": "ウ", "ｴ": "エ",
  "ｵ": "オ", "ｶ": "カ", "ｷ": "キ", "ｸ": "ク",
  "ｹ": "ケ", "ｺ": "コ", "ｻ": "サ", "ｼ": "シ",
  "ｽ": "ス", "ｾ": "セ", "ｿ": "ソ", "ﾀ": "タ",
  "ﾁ": "チ", "ﾂ": "ツ", "ﾃ": "テ", "ﾄ": "ト",
  "ﾅ": "ナ", "ﾆ": "ニ", "ﾇ": "ヌ", "ﾈ": "ネ",
  "ﾉ": "ノ", "ﾊ": "ハ", "ﾋ": "ヒ", "ﾌ": "フ",
  "ﾍ": "ヘ", "ﾎ": "ホ", "ﾏ": "マ", "ﾐ": "ミ",
  "ﾑ": "ム", "ﾒ": "メ", "ﾓ": "モ", "ﾔ": "ヤ",
  "ﾕ": "ユ", "ﾖ": "ヨ", "ﾗ": "ラ", "ﾘ": "リ",
  "ﾙ": "ル", "ﾚ": "レ", "ﾛ": "ロ", "ﾜ": "ワ",
  "ﾝ": "ン"
};

var NFB_DAKUTEN_MAP_ = {
  "カ": "ガ", "キ": "ギ", "ク": "グ", "ケ": "ゲ", "コ": "ゴ",
  "サ": "ザ", "シ": "ジ", "ス": "ズ", "セ": "ゼ", "ソ": "ゾ",
  "タ": "ダ", "チ": "ヂ", "ツ": "ヅ", "テ": "デ", "ト": "ド",
  "ハ": "バ", "ヒ": "ビ", "フ": "ブ", "ヘ": "ベ", "ホ": "ボ",
  "ウ": "ヴ"
};

var NFB_HANDAKUTEN_MAP_ = {
  "ハ": "パ", "ヒ": "ピ", "フ": "プ", "ヘ": "ペ", "ホ": "ポ"
};

function nfbTransformZen_(value) {
  var result = "";
  for (var i = 0; i < value.length; i++) {
    var ch = value.charAt(i);
    var code = value.charCodeAt(i);

    if (code >= 0x21 && code <= 0x7E) { result += String.fromCharCode(code + 0xFEE0); continue; }
    if (code === 0x20) { result += "　"; continue; }

    var mapped = NFB_HALFWIDTH_KANA_MAP_[ch];
    if (mapped) {
      var next = i + 1 < value.length ? value.charAt(i + 1) : "";
      if (next === "ﾞ" && NFB_DAKUTEN_MAP_[mapped]) {
        result += NFB_DAKUTEN_MAP_[mapped]; i++;
      } else if (next === "ﾟ" && NFB_HANDAKUTEN_MAP_[mapped]) {
        result += NFB_HANDAKUTEN_MAP_[mapped]; i++;
      } else {
        result += mapped;
      }
      continue;
    }

    result += ch;
  }
  return result;
}

var NFB_FULLWIDTH_KANA_TO_HALF_ = {};
var NFB_DAKUTEN_TO_HALF_ = {};
var NFB_HANDAKUTEN_TO_HALF_ = {};

(function() {
  var k;
  for (k in NFB_HALFWIDTH_KANA_MAP_) {
    if (Object.prototype.hasOwnProperty.call(NFB_HALFWIDTH_KANA_MAP_, k)) {
      NFB_FULLWIDTH_KANA_TO_HALF_[NFB_HALFWIDTH_KANA_MAP_[k]] = k;
    }
  }
  for (k in NFB_DAKUTEN_MAP_) {
    if (Object.prototype.hasOwnProperty.call(NFB_DAKUTEN_MAP_, k)) {
      var halfBase = NFB_FULLWIDTH_KANA_TO_HALF_[k];
      if (halfBase) NFB_DAKUTEN_TO_HALF_[NFB_DAKUTEN_MAP_[k]] = halfBase + "ﾞ";
    }
  }
  for (k in NFB_HANDAKUTEN_MAP_) {
    if (Object.prototype.hasOwnProperty.call(NFB_HANDAKUTEN_MAP_, k)) {
      var halfBase2 = NFB_FULLWIDTH_KANA_TO_HALF_[k];
      if (halfBase2) NFB_HANDAKUTEN_TO_HALF_[NFB_HANDAKUTEN_MAP_[k]] = halfBase2 + "ﾟ";
    }
  }
})();

function nfbTransformHan_(value) {
  var result = "";
  for (var i = 0; i < value.length; i++) {
    var ch = value.charAt(i);
    var code = value.charCodeAt(i);

    if (code >= 0xFF01 && code <= 0xFF5E) { result += String.fromCharCode(code - 0xFEE0); continue; }
    if (code === 0x3000) { result += " "; continue; }

    if (NFB_DAKUTEN_TO_HALF_[ch]) { result += NFB_DAKUTEN_TO_HALF_[ch]; continue; }
    if (NFB_HANDAKUTEN_TO_HALF_[ch]) { result += NFB_HANDAKUTEN_TO_HALF_[ch]; continue; }
    if (NFB_FULLWIDTH_KANA_TO_HALF_[ch]) { result += NFB_FULLWIDTH_KANA_TO_HALF_[ch]; continue; }

    result += ch;
  }
  return result;
}

// ===========================================================================
// § File upload transformers
// ===========================================================================

function nfbTransformFileNames_(_value, _args, context) {
  return nfbJoinList_(context && context.currentFieldMeta && context.currentFieldMeta.fileNames);
}

function nfbTransformFileUrls_(_value, _args, context) {
  return nfbJoinList_(context && context.currentFieldMeta && context.currentFieldMeta.fileUrls);
}

function nfbTransformFolderName_(_value, _args, context) {
  return String((context && context.currentFieldMeta && context.currentFieldMeta.folderName) || "");
}

function nfbTransformFolderUrl_(_value, _args, context) {
  return String((context && context.currentFieldMeta && context.currentFieldMeta.folderUrl) || "");
}

// ===========================================================================
// § Numeric parse transformers (typed-safe: produce numbers for + arithmetic)
// ===========================================================================

function nfbTransformParseInt_(value) {
  var n = parseInt(nfbCoerceToString_(value), 10);
  return isNaN(n) ? value : n;
}
nfbTransformParseInt_.__typedSafe__ = true;

function nfbTransformParseFloat_(value) {
  var n = parseFloat(nfbCoerceToString_(value));
  return isNaN(n) ? value : n;
}
nfbTransformParseFloat_.__typedSafe__ = true;

function nfbTransformNoext_(value) {
  if (!value) return "";
  var parts = value.split(", ");
  for (var i = 0; i < parts.length; i++) {
    var trimmed = parts[i].replace(/^\s+|\s+$/g, "");
    var dotIndex = trimmed.lastIndexOf(".");
    parts[i] = dotIndex > 0 ? trimmed.substring(0, dotIndex) : trimmed;
  }
  return parts.join(", ");
}

// ===========================================================================
// § Registry & applicator
// ===========================================================================

var NFB_TRANSFORMERS_ = {
  "noext":       nfbTransformNoext_,
  "time":        nfbTransformTime_,
  "left":        nfbTransformLeft_,
  "right":       nfbTransformRight_,
  "mid":         nfbTransformMid_,
  "pad":         nfbTransformPad_,
  "padRight":    nfbTransformPadRight_,
  "upper":       nfbTransformUpper_,
  "lower":       nfbTransformLower_,
  "trim":        nfbTransformTrim_,
  "default":     nfbTransformDefault_,
  "replace":     nfbTransformReplace_,
  "match":       nfbTransformMatch_,
  "number":      nfbTransformNumber_,
  "if":          nfbTransformIf_,
  "map":         nfbTransformMap_,
  "kana":        nfbTransformKana_,
  "zen":         nfbTransformZen_,
  "han":         nfbTransformHan_,
  "parseINT":    nfbTransformParseInt_,
  "parseFLOAT":  nfbTransformParseFloat_,
  "file_names":  nfbTransformFileNames_,
  "file_urls":   nfbTransformFileUrls_,
  "folder_name": nfbTransformFolderName_,
  "folder_url":  nfbTransformFolderUrl_
};

function nfbApplyOneTransformer_(value, name, args, context) {
  var fn = NFB_TRANSFORMERS_[name];
  if (!fn) return value;
  var input = fn.__typedSafe__ ? value : nfbCoerceToString_(value);
  return fn(input, args, context);
}

function nfbParsePipeTransformers_(transformerString) {
  var parts = nfbSplitTopLevel_(transformerString, "|");
  var result = [];
  for (var i = 0; i < parts.length; i++) {
    var segment = parts[i];
    var colonIndex = segment.indexOf(":");
    if (colonIndex >= 0) {
      result.push({ name: segment.substring(0, colonIndex), args: segment.substring(colonIndex + 1) });
    } else {
      result.push({ name: segment, args: "" });
    }
  }
  return result;
}

/**
 * Apply a chained pipe-transformer string to a value. Preserves numeric type
 * across typed-safe transformers (parseINT, parseFLOAT); coerces to string for
 * all others. Final result is coerced to string for caller compatibility.
 */
function nfbApplyPipeTransformers_(value, transformerString, context) {
  var transformers = nfbParsePipeTransformers_(transformerString);
  var current = (value === undefined || value === null) ? "" : value;
  for (var i = 0; i < transformers.length; i++) {
    current = nfbApplyOneTransformer_(current, transformers[i].name, transformers[i].args, context);
  }
  return nfbCoerceToString_(current);
}

// ===========================================================================
// § Plain value guards (small helpers for `(x && x.field) || {}` duplication)
// ===========================================================================

function nfbPlainObject_(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

function nfbPlainArray_(value) {
  return Array.isArray(value) ? value : [];
}

// ===========================================================================
// § Template adapter helpers (shared by GAS driveTemplate.gs and frontend
//   tokenReplacer.js — pure, platform-agnostic)
// ===========================================================================

var NFB_TEMPLATE_ESC_OPEN_BRACE_ = "__NFB_TPL_ESC_OB__";
var NFB_TEMPLATE_ESC_CLOSE_BRACE_ = "__NFB_TPL_ESC_CB__";
var NFB_TEMPLATE_ESC_OPEN_BRACKET_ = "__NFB_TPL_ESC_OK__";
var NFB_TEMPLATE_ESC_CLOSE_BRACKET_ = "__NFB_TPL_ESC_CK__";

/** Replace `\{` `\}` `\[` `\]` with internal sentinels so the scanner ignores them. */
function nfbTemplateEscape_(text) {
  if (text === undefined || text === null) return "";
  return String(text)
    .split("\\{").join(NFB_TEMPLATE_ESC_OPEN_BRACE_)
    .split("\\}").join(NFB_TEMPLATE_ESC_CLOSE_BRACE_)
    .split("\\[").join(NFB_TEMPLATE_ESC_OPEN_BRACKET_)
    .split("\\]").join(NFB_TEMPLATE_ESC_CLOSE_BRACKET_);
}

/** Inverse of nfbTemplateEscape_: restore literal braces/brackets. */
function nfbTemplateUnescape_(text) {
  if (text === undefined || text === null) return "";
  return String(text)
    .split(NFB_TEMPLATE_ESC_OPEN_BRACE_).join("{")
    .split(NFB_TEMPLATE_ESC_CLOSE_BRACE_).join("}")
    .split(NFB_TEMPLATE_ESC_OPEN_BRACKET_).join("[")
    .split(NFB_TEMPLATE_ESC_CLOSE_BRACKET_).join("]");
}

/**
 * Build { label: meta } from { fid: label } + { fid: meta }. Used by adapters
 * so fileUpload-only pipes (|file_urls etc.) can resolve via @label.
 */
function nfbBuildFileUploadMetaByLabel_(fieldLabels, fileUploadMeta) {
  var labels = nfbPlainObject_(fieldLabels);
  var metaByFid = nfbPlainObject_(fileUploadMeta);
  var out = {};
  for (var fid in labels) {
    if (!Object.prototype.hasOwnProperty.call(labels, fid)) continue;
    var label = labels[fid];
    if (!label || Object.prototype.hasOwnProperty.call(out, label)) continue;
    if (Object.prototype.hasOwnProperty.call(metaByFid, fid) && metaByFid[fid]) {
      out[label] = metaByFid[fid];
    }
  }
  return out;
}

/**
 * Build { label: displayString } from { fid: label }, { fid: formattedValue },
 * { fid: rawValue }. fieldValues takes precedence over responses.
 *
 * opts (all optional):
 *   - fileUploadMeta       { fid: meta } used for hideFileExtension
 *   - applyHideFileExtension  true  → when value came from responses (no
 *                            fieldValues entry) and meta.hideFileExtension is
 *                            set, strip extensions from each comma-separated
 *                            file name (GAS-side behavior; frontend leaves as-is).
 */
function nfbBuildLabelValueMap_(fieldLabels, fieldValues, responses, opts) {
  var labels = nfbPlainObject_(fieldLabels);
  var values = nfbPlainObject_(fieldValues);
  var resp = nfbPlainObject_(responses);
  var fileUploadMeta = nfbPlainObject_(opts && opts.fileUploadMeta);
  var applyHideExt = opts && opts.applyHideFileExtension === true;

  var map = {};
  for (var fid in labels) {
    if (!Object.prototype.hasOwnProperty.call(labels, fid)) continue;
    var label = labels[fid];
    if (!label || Object.prototype.hasOwnProperty.call(map, label)) continue;
    var fromFieldValues = Object.prototype.hasOwnProperty.call(values, fid);
    var raw = fromFieldValues ? values[fid] : resp[fid];
    var str = nfbTemplateValueToString_(raw);
    if (applyHideExt && !fromFieldValues
        && fileUploadMeta[fid] && fileUploadMeta[fid].hideFileExtension) {
      var parts = str.split(", ");
      for (var i = 0; i < parts.length; i++) {
        parts[i] = nfbStripFileExtension_(parts[i].replace(/^\s+|\s+$/g, ""));
      }
      str = parts.join(", ");
    }
    map[label] = str;
  }
  return map;
}

var NFB_TEMPLATE_LABEL_TERMINATORS_ = {
  "+": true, "|": true, "{": true, "}": true, ",": true, ":": true,
  " ": true, "\t": true, "\n": true, "\r": true
};

/**
 * Extract the leading `@<label>` (unquoted) from a token body so an adapter
 * can bind fileUpload meta for `|file_urls` / `|folder_url` pipes. Returns
 * null when the body doesn't start with a simple `@label`. Handles quoted
 * labels (`@"foo bar"` / `@'foo'`) and backslash escapes.
 */
function nfbDetectFieldLabel_(body) {
  if (!body || body.charAt(0) !== "@") return null;
  var i = 1;
  var n = body.length;
  var q = body.charAt(i);
  if (q === "\"" || q === "'") {
    i++;
    var quoted = "";
    while (i < n && body.charAt(i) !== q) {
      if (body.charAt(i) === "\\" && i + 1 < n) { quoted += body.charAt(i + 1); i += 2; continue; }
      quoted += body.charAt(i);
      i++;
    }
    return quoted || null;
  }
  var bare = "";
  while (i < n && !NFB_TEMPLATE_LABEL_TERMINATORS_[body.charAt(i)]) {
    if (body.charAt(i) === "\\" && i + 1 < n) { bare += body.charAt(i + 1); i += 2; continue; }
    bare += body.charAt(i);
    i++;
  }
  return bare || null;
}

/**
 * Evaluate a single {kind, body, fullToken} collected by nfbScanBalancedTokens_
 * or nfbCollectBalancedTokens_. Returns the string replacement value. Shared
 * between the full-string resolver (nfbResolveTemplate_) and the Google Docs
 * per-token path (driveOutput.gs) which uses DocumentApp.replaceText.
 *
 * opts (all optional):
 *   - fileUploadMetaByLabel   { label: meta } — when present, a brace token
 *                             whose leading `@label` maps to a fileUpload
 *                             field gets `currentFieldMeta` injected into a
 *                             shallow-cloned evalContext.
 *   - bracketFallbackLiteral  true (default) — emit fullToken on bracket
 *                             eval error; false → emit empty string.
 *   - logError                function(errObj, fullToken)
 */
function nfbEvaluateTemplateToken_(tok, context, opts) {
  var options = opts || {};
  var baseCtx = context || {};
  var metaByLabel = options.fileUploadMetaByLabel || null;
  var logError = typeof options.logError === "function" ? options.logError : null;
  var bracketFallbackLiteral = options.bracketFallbackLiteral !== false;

  if (tok.kind === "brace") {
    var evalCtx = baseCtx;
    if (metaByLabel) {
      var label = nfbDetectFieldLabel_(tok.body);
      var meta = label ? metaByLabel[label] : null;
      if (meta) {
        evalCtx = {};
        for (var k in baseCtx) {
          if (Object.prototype.hasOwnProperty.call(baseCtx, k)) evalCtx[k] = baseCtx[k];
        }
        evalCtx.currentFieldMeta = meta;
      }
    }
    var res = nfbEvaluateToken_(tok.body, evalCtx);
    if (res.ok) return res.value;
    if (logError) logError(res.error, tok.fullToken);
    return res.fallback;
  }
  var bres = nfbEvaluateBracketExpr_(tok.body, baseCtx);
  if (bres.ok) return nfbCoerceToString_(bres.value);
  if (logError) logError(bres.error, tok.fullToken);
  return bracketFallbackLiteral ? tok.fullToken : "";
}

/**
 * Full template-replacement orchestrator shared by GAS (driveTemplate.gs) and
 * frontend (tokenReplacer.js). Escapes `\{}` / `\[]`, scans top-level braces
 * and brackets, dispatches each through nfbEvaluateTemplateToken_, then
 * restores escapes.
 *
 * Accepts the same `opts` as nfbEvaluateTemplateToken_.
 */
function nfbResolveTemplate_(template, context, opts) {
  if (template === undefined || template === null) return "";
  var text = String(template);
  if (!text) return "";
  if (text.indexOf("{") < 0 && text.indexOf("[") < 0) return text;

  var src = nfbTemplateEscape_(text);
  var result = nfbScanBalancedTokens_(src, function(tok) {
    return nfbEvaluateTemplateToken_(tok, context, opts);
  });
  return nfbTemplateUnescape_(result);
}

// ===========================================================================
// § Module export (dual-compat: CommonJS for Vite, no-op on GAS)
// ===========================================================================

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    // value serialization
    templateValueToString: nfbTemplateValueToString_,
    stripFileExtension: nfbStripFileExtension_,
    joinList: nfbJoinList_,
    coerceToString: nfbCoerceToString_,
    addValues: nfbAddValues_,
    // scanners
    findBalancedCloseIndex: nfbFindBalancedCloseIndex_,
    scanBalancedTokens: nfbScanBalancedTokens_,
    collectBalancedTokens: nfbCollectBalancedTokens_,
    splitTopLevel: nfbSplitTopLevel_,
    // date/time helpers
    parseDateString: nfbParseDateString_,
    parseTimeString: nfbParseTimeString_,
    resolveJapaneseEra: nfbResolveJapaneseEra_,
    formatNowLocal: nfbFormatNowLocal_,
    // pipe engine
    parsePipeTransformers: nfbParsePipeTransformers_,
    applyPipeTransformers: nfbApplyPipeTransformers_,
    // expression engine (new)
    evaluateToken: nfbEvaluateToken_,
    evaluateBracketExpr: nfbEvaluateBracketExpr_,
    extractFieldRefs: nfbExtractFieldRefs_,
    // condition helpers (exposed for advanced frontend integration)
    evaluateIfCondition: nfbEvaluateIfCondition_,
    resolveIfValue: nfbResolveIfValue_,
    // plain value guards
    plainObject: nfbPlainObject_,
    plainArray: nfbPlainArray_,
    // template adapter helpers
    templateEscape: nfbTemplateEscape_,
    templateUnescape: nfbTemplateUnescape_,
    buildFileUploadMetaByLabel: nfbBuildFileUploadMetaByLabel_,
    buildLabelValueMap: nfbBuildLabelValueMap_,
    detectFieldLabel: nfbDetectFieldLabel_,
    evaluateTemplateToken: nfbEvaluateTemplateToken_,
    resolveTemplate: nfbResolveTemplate_
  };
}

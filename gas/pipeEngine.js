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
// § Balanced brace scanner & top-level split
// ===========================================================================

/**
 * Given the index of a "{" in text, return the index of its matching "}",
 * tracking nested braces. Returns -1 if never closed.
 */
function nfbFindBalancedCloseIndex_(text, openIndex) {
  var n = text.length;
  var depth = 1;
  var j = openIndex + 1;
  while (j < n && depth > 0) {
    var c = text.charAt(j);
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return -1;
}

/**
 * Scan a template string and replace each balanced {...} token via replacer(body).
 * Unclosed braces are left literal.
 */
function nfbScanBalancedTokens_(text, replacer) {
  var out = "";
  var i = 0;
  var n = text.length;
  while (i < n) {
    var ch = text.charAt(i);
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }
    var close = nfbFindBalancedCloseIndex_(text, i);
    if (close < 0) {
      out += text.substring(i);
      return out;
    }
    out += replacer(text.substring(i + 1, close));
    i = close + 1;
  }
  return out;
}

/**
 * Collect every top-level balanced {...} from text: [{fullToken, body}, ...].
 * Used by Google Doc path (needs original token string for replaceText).
 */
function nfbCollectBalancedTokens_(text) {
  var results = [];
  if (!text) return results;
  var n = text.length;
  var i = 0;
  while (i < n) {
    if (text.charAt(i) !== "{") { i++; continue; }
    var close = nfbFindBalancedCloseIndex_(text, i);
    if (close < 0) return results;
    results.push({ fullToken: text.substring(i, close + 1), body: text.substring(i + 1, close) });
    i = close + 1;
  }
  return results;
}

/**
 * Split str on delimiter at top level (depth 0 of {} nesting), with \<delim> escape support.
 * If maxParts > 0, splits at most maxParts-1 times — remainder goes into last part.
 */
function nfbSplitTopLevel_(str, delimiter, maxParts) {
  var parts = [];
  var current = "";
  var depth = 0;
  var n = str.length;
  for (var i = 0; i < n; i++) {
    var ch = str.charAt(i);
    if (ch === "\\" && i + 1 < n && str.charAt(i + 1) === delimiter) {
      current += delimiter;
      i++;
      continue;
    }
    if (ch === "{") {
      depth++;
      current += ch;
      continue;
    }
    if (ch === "}") {
      if (depth > 0) depth--;
      current += ch;
      continue;
    }
    if (ch === delimiter && depth === 0 && (!maxParts || parts.length < maxParts - 1)) {
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

function nfbTransformIf_(value, args, context) {
  var parts = nfbSplitTopLevel_(args, ",", 2);
  if (parts.length < 2) return value;
  var matched = nfbEvaluateIfCondition_(parts[0], context, value);
  if (matched) return value;
  return nfbResolveIfValue_(parts[1], context, value);
}

function nfbTransformIfv_(value, args, context) {
  var parts = nfbSplitTopLevel_(args, ",", 3);
  if (parts.length < 3) return value;
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
  "ifv":         nfbTransformIfv_,
  "map":         nfbTransformMap_,
  "kana":        nfbTransformKana_,
  "zen":         nfbTransformZen_,
  "han":         nfbTransformHan_,
  "file_names":  nfbTransformFileNames_,
  "file_urls":   nfbTransformFileUrls_,
  "folder_name": nfbTransformFolderName_,
  "folder_url":  nfbTransformFolderUrl_
};

function nfbApplyOneTransformer_(value, name, args, context) {
  var fn = NFB_TRANSFORMERS_[name];
  return fn ? fn(value, args, context) : value;
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

function nfbApplyPipeTransformers_(value, transformerString, context) {
  var transformers = nfbParsePipeTransformers_(transformerString);
  var current = value === undefined || value === null ? "" : String(value);
  for (var i = 0; i < transformers.length; i++) {
    current = nfbApplyOneTransformer_(current, transformers[i].name, transformers[i].args, context);
  }
  return current;
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
    // condition helpers (exposed for advanced frontend integration)
    evaluateIfCondition: nfbEvaluateIfCondition_,
    resolveIfValue: nfbResolveIfValue_
  };
}

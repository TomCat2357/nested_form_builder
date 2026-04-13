/**
 * パイプ変換エンジン
 *
 * テンプレートトークンの "|" 以降で使えるパイプ変換を定義する。
 * gas/driveTemplate.gs の変換ロジックと同等。
 */

// ---------------------------------------------------------------------------
// Japanese Era
// ---------------------------------------------------------------------------

const ERAS = [
  { name: "令和", year: 2019, month: 5, day: 1 },
  { name: "平成", year: 1989, month: 1, day: 8 },
  { name: "昭和", year: 1926, month: 12, day: 25 },
  { name: "大正", year: 1912, month: 7, day: 30 },
  { name: "明治", year: 1868, month: 1, day: 25 },
];

const isSameOrAfter = (dp, era) => {
  if (dp.year !== era.year) return dp.year > era.year;
  if (dp.month !== era.month) return dp.month > era.month;
  return dp.day >= era.day;
};

const resolveJapaneseEra = (dateParts) => {
  for (const era of ERAS) {
    if (isSameOrAfter(dateParts, era)) {
      return { name: era.name, year: dateParts.year - era.year + 1 };
    }
  }
  return { name: "", year: dateParts.year };
};

// ---------------------------------------------------------------------------
// Date / time helpers
// ---------------------------------------------------------------------------

const getDateParts = (date) => ({
  year: date.getFullYear(),
  month: date.getMonth() + 1,
  day: date.getDate(),
  hour: date.getHours(),
  minute: date.getMinutes(),
  second: date.getSeconds(),
});

const pad2 = (n) => String(n).padStart(2, "0");

export const formatNow = (date) => {
  const dp = getDateParts(date);
  return `${dp.year}-${pad2(dp.month)}-${pad2(dp.day)} ${pad2(dp.hour)}:${pad2(dp.minute)}:${pad2(dp.second)}`;
};

// ---------------------------------------------------------------------------
// Date / time transformers
// ---------------------------------------------------------------------------

const parseDateString = (value) => {
  const str = String(value).trim();
  const m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const m2 = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return { year: Number(m2[1]), month: Number(m2[2]), day: Number(m2[3]) };
  return null;
};

const DAY_OF_WEEK_SHORT = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_OF_WEEK_LONG = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

const replaceFormatTokens = (formatStr, replacements) => {
  let result = formatStr;
  for (const [token, value] of replacements) {
    result = result.split(token).join(value);
  }
  return result;
};

const parseTimeString = (value) => {
  const str = String(value).trim();
  const dtMatch = str.match(/[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dtMatch) return { hour: Number(dtMatch[1]), minute: Number(dtMatch[2]), second: dtMatch[3] ? Number(dtMatch[3]) : 0 };
  const tMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (tMatch) return { hour: Number(tMatch[1]), minute: Number(tMatch[2]), second: tMatch[3] ? Number(tMatch[3]) : 0 };
  return null;
};

/**
 * 統合 time パイプ: 日付トークンと時刻トークンの両方に対応
 * 旧 date パイプの機能を統合（後方互換不要）
 */
const transformTime = (value, formatStr) => {
  const dp = parseDateString(value);
  const tp = parseTimeString(value);
  if (!dp && !tp) return value;
  let result = formatStr;
  if (dp) {
    const era = resolveJapaneseEra(dp);
    const dow = new Date(dp.year, dp.month - 1, dp.day).getDay();
    // Longer tokens first to avoid partial replacement (e.g. "MM" before "M")
    result = replaceFormatTokens(result, [
      ["dddd", DAY_OF_WEEK_LONG[dow]],
      ["ddd",  DAY_OF_WEEK_SHORT[dow]],
      ["gg",   era.name],
      ["YYYY", String(dp.year)],
      ["YY",   ("0" + dp.year).slice(-2)],
      ["MM",   ("0" + dp.month).slice(-2)],
      ["DD",   ("0" + dp.day).slice(-2)],
      ["ee",   ("0" + era.year).slice(-2)],
      ["M",    String(dp.month)],
      ["D",    String(dp.day)],
      ["e",    String(era.year)],
    ]);
  }
  if (tp) {
    result = replaceFormatTokens(result, [
      ["HH", ("0" + tp.hour).slice(-2)],
      ["mm", ("0" + tp.minute).slice(-2)],
      ["ss", ("0" + tp.second).slice(-2)],
      ["H",  String(tp.hour)],
      ["m",  String(tp.minute)],
      ["s",  String(tp.second)],
    ]);
  }
  return result;
};

// ---------------------------------------------------------------------------
// String transformers
// ---------------------------------------------------------------------------

const transformLeft = (v, args) => { const n = parseInt(args, 10); return isNaN(n) || n < 0 ? v : v.substring(0, n); };
const transformRight = (v, args) => { const n = parseInt(args, 10); return isNaN(n) || n < 0 ? v : n >= v.length ? v : v.substring(v.length - n); };

const transformMid = (v, args) => {
  const parts = args.split(",");
  const start = parseInt(parts[0], 10);
  const length = parts.length > 1 ? parseInt(parts[1], 10) : undefined;
  if (isNaN(start) || start < 0) return v;
  if (length !== undefined && (isNaN(length) || length < 0)) return v;
  return length !== undefined ? v.substr(start, length) : v.substring(start);
};

const transformPad = (v, args) => {
  const parts = args.split(",");
  const len = parseInt(parts[0], 10);
  const ch = parts.length > 1 ? parts[1] : "0";
  if (isNaN(len) || len <= 0) return v;
  return v.padStart(len, ch);
};

const transformPadRight = (v, args) => {
  const parts = args.split(",");
  const len = parseInt(parts[0], 10);
  const ch = parts.length > 1 ? parts[1] : " ";
  if (isNaN(len) || len <= 0) return v;
  return v.padEnd(len, ch);
};

const transformUpper = (v) => v.toUpperCase();
const transformLower = (v) => v.toLowerCase();
const transformTrim = (v) => v.trim();
const transformDefault = (v, a) => v ? v : String(a);

const transformReplace = (v, args) => {
  const commaIndex = args.indexOf(",");
  if (commaIndex < 0) return v;
  return v.split(args.substring(0, commaIndex)).join(args.substring(commaIndex + 1));
};

const transformMatch = (v, args) => {
  const lastComma = args.lastIndexOf(",");
  let pattern, groupIndex;
  if (lastComma >= 0) {
    const possibleGroup = args.substring(lastComma + 1).trim();
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
    const m = v.match(new RegExp(pattern));
    return m && m[groupIndex] !== undefined ? m[groupIndex] : "";
  } catch (_e) {
    return v;
  }
};

const transformNumber = (v, formatStr) => {
  const num = parseFloat(v.trim());
  if (isNaN(num)) return v;
  const isNeg = num < 0;
  const absNum = Math.abs(num);
  const fmtMatch = formatStr.match(/^([^#0,.]*)([#0,.]+)(.*)$/);
  if (!fmtMatch) return v;
  const prefix = fmtMatch[1];
  const numFmt = fmtMatch[2];
  const suffix = fmtMatch[3];
  const dotIndex = numFmt.indexOf(".");
  const useThousands = numFmt.includes(",");
  const decimalPlaces = dotIndex >= 0 ? numFmt.length - dotIndex - 1 : 0;
  const fixed = absNum.toFixed(decimalPlaces);
  let [intPart, decPart] = decimalPlaces > 0 ? fixed.split(".") : [fixed.split(".")[0], ""];
  if (useThousands) {
    intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  let result = (isNeg ? "-" : "") + prefix + intPart;
  if (decimalPlaces > 0) result += "." + decPart;
  return result + suffix;
};

// ---------------------------------------------------------------------------
// if transformer helpers (GAS nfbTransformIf_ equivalent)
// ---------------------------------------------------------------------------

const resolveFieldRef = (name, context) => {
  const map = (context && context.labelValueMap) || {};
  return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : "";
};

const resolveConditionOperand = (operand, context) => {
  const s = operand.trim();
  if (s.charAt(0) === "@" && s.length > 1) {
    return resolveFieldRef(s.substring(1), context);
  }
  if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
    return s.substring(1, s.length - 1);
  }
  return s;
};

const compare = (left, right, operator) => {
  if (operator === "==") return left === right;
  if (operator === "!=") return left !== right;
  if (operator === "in") return right.indexOf(left) >= 0;

  const numLeft = parseFloat(left);
  const numRight = parseFloat(right);
  const useNumeric = !isNaN(numLeft) && !isNaN(numRight)
    && String(left).trim() !== "" && String(right).trim() !== "";

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
};

const evaluateIfCondition = (conditionStr, context) => {
  let str = conditionStr.trim();

  let negate = false;
  if (str.length >= 4 && str.substring(0, 4) === "not ") {
    negate = true;
    str = str.substring(4).trimStart();
  }

  // " in " operator
  const inIdx = str.indexOf(" in ");
  if (inIdx >= 0) {
    const inLeft = resolveConditionOperand(str.substring(0, inIdx), context);
    const inRight = resolveConditionOperand(str.substring(inIdx + 4), context);
    const inResult = compare(inLeft, inRight, "in");
    return negate ? !inResult : inResult;
  }

  // Comparison operators
  const opMatch = str.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  let result;
  if (opMatch) {
    const leftVal = resolveConditionOperand(opMatch[1], context);
    const rightVal = resolveConditionOperand(opMatch[3], context);
    result = compare(leftVal, rightVal, opMatch[2]);
  } else {
    const val = resolveConditionOperand(str, context);
    result = !!val;
  }

  return negate ? !result : result;
};

const resolveIfValue = (valueStr, context, pipeValue) => {
  if (valueStr === "") return "";
  if (valueStr === "_") return pipeValue;
  if (valueStr === "\\_") return "_";
  if (valueStr.charAt(0) === "@" && valueStr.length > 1) {
    return resolveFieldRef(valueStr.substring(1), context);
  }
  return valueStr;
};

const transformIf = (v, args, context) => {
  const firstComma = args.indexOf(",");
  if (firstComma < 0) return v;
  const conditionStr = args.substring(0, firstComma);
  const elseValueStr = args.substring(firstComma + 1);

  const matched = evaluateIfCondition(conditionStr, context);
  if (matched) return v;
  return resolveIfValue(elseValueStr, context, v);
};

const transformMap = (v, args) => {
  const entries = args.split(";");
  let fallback = v;
  for (const entry of entries) {
    const eqIndex = entry.indexOf("=");
    if (eqIndex < 0) continue;
    const key = entry.substring(0, eqIndex);
    const val = entry.substring(eqIndex + 1);
    if (key === "*") { fallback = val; continue; }
    if (v === key) return val;
  }
  return fallback;
};

// ---------------------------------------------------------------------------
// Kana / fullwidth / halfwidth transformers
// ---------------------------------------------------------------------------

const transformKana = (v) => {
  let result = "";
  for (let i = 0; i < v.length; i++) {
    const code = v.charCodeAt(i);
    result += code >= 0x3041 && code <= 0x3096 ? String.fromCharCode(code + 0x60) : v.charAt(i);
  }
  return result;
};

const HALFWIDTH_KANA_MAP = {
  "\uFF66": "\u30F2", "\uFF67": "\u30A1", "\uFF68": "\u30A3", "\uFF69": "\u30A5",
  "\uFF6A": "\u30A7", "\uFF6B": "\u30A9", "\uFF6C": "\u30E3", "\uFF6D": "\u30E5",
  "\uFF6E": "\u30E7", "\uFF6F": "\u30C3", "\uFF70": "\u30FC",
  "\uFF71": "\u30A2", "\uFF72": "\u30A4", "\uFF73": "\u30A6", "\uFF74": "\u30A8",
  "\uFF75": "\u30AA", "\uFF76": "\u30AB", "\uFF77": "\u30AD", "\uFF78": "\u30AF",
  "\uFF79": "\u30B1", "\uFF7A": "\u30B3", "\uFF7B": "\u30B5", "\uFF7C": "\u30B7",
  "\uFF7D": "\u30B9", "\uFF7E": "\u30BB", "\uFF7F": "\u30BD", "\uFF80": "\u30BF",
  "\uFF81": "\u30C1", "\uFF82": "\u30C4", "\uFF83": "\u30C6", "\uFF84": "\u30C8",
  "\uFF85": "\u30CA", "\uFF86": "\u30CB", "\uFF87": "\u30CC", "\uFF88": "\u30CD",
  "\uFF89": "\u30CE", "\uFF8A": "\u30CF", "\uFF8B": "\u30D2", "\uFF8C": "\u30D5",
  "\uFF8D": "\u30D8", "\uFF8E": "\u30DB", "\uFF8F": "\u30DE", "\uFF90": "\u30DF",
  "\uFF91": "\u30E0", "\uFF92": "\u30E1", "\uFF93": "\u30E2", "\uFF94": "\u30E4",
  "\uFF95": "\u30E6", "\uFF96": "\u30E8", "\uFF97": "\u30E9", "\uFF98": "\u30EA",
  "\uFF99": "\u30EB", "\uFF9A": "\u30EC", "\uFF9B": "\u30ED", "\uFF9C": "\u30EF",
  "\uFF9D": "\u30F3",
};

const DAKUTEN_MAP = {
  "\u30AB": "\u30AC", "\u30AD": "\u30AE", "\u30AF": "\u30B0", "\u30B1": "\u30B2", "\u30B3": "\u30B4",
  "\u30B5": "\u30B6", "\u30B7": "\u30B8", "\u30B9": "\u30BA", "\u30BB": "\u30BC", "\u30BD": "\u30BE",
  "\u30BF": "\u30C0", "\u30C1": "\u30C2", "\u30C4": "\u30C5", "\u30C6": "\u30C7", "\u30C8": "\u30C9",
  "\u30CF": "\u30D0", "\u30D2": "\u30D3", "\u30D5": "\u30D6", "\u30D8": "\u30D9", "\u30DB": "\u30DC",
  "\u30A6": "\u30F4",
};

const HANDAKUTEN_MAP = {
  "\u30CF": "\u30D1", "\u30D2": "\u30D4", "\u30D5": "\u30D7", "\u30D8": "\u30DA", "\u30DB": "\u30DD",
};

const transformZen = (v) => {
  let result = "";
  for (let i = 0; i < v.length; i++) {
    const ch = v.charAt(i);
    const code = v.charCodeAt(i);
    if (code >= 0x21 && code <= 0x7E) { result += String.fromCharCode(code + 0xFEE0); continue; }
    if (code === 0x20) { result += "\u3000"; continue; }
    const mapped = HALFWIDTH_KANA_MAP[ch];
    if (mapped) {
      const next = i + 1 < v.length ? v.charAt(i + 1) : "";
      if (next === "\uFF9E" && DAKUTEN_MAP[mapped]) { result += DAKUTEN_MAP[mapped]; i++; }
      else if (next === "\uFF9F" && HANDAKUTEN_MAP[mapped]) { result += HANDAKUTEN_MAP[mapped]; i++; }
      else { result += mapped; }
      continue;
    }
    result += ch;
  }
  return result;
};

const FULLWIDTH_KANA_TO_HALF = {};
const DAKUTEN_TO_HALF = {};
const HANDAKUTEN_TO_HALF = {};
(() => {
  for (const k of Object.keys(HALFWIDTH_KANA_MAP)) {
    FULLWIDTH_KANA_TO_HALF[HALFWIDTH_KANA_MAP[k]] = k;
  }
  for (const k of Object.keys(DAKUTEN_MAP)) {
    const halfBase = FULLWIDTH_KANA_TO_HALF[k];
    if (halfBase) DAKUTEN_TO_HALF[DAKUTEN_MAP[k]] = halfBase + "\uFF9E";
  }
  for (const k of Object.keys(HANDAKUTEN_MAP)) {
    const halfBase = FULLWIDTH_KANA_TO_HALF[k];
    if (halfBase) HANDAKUTEN_TO_HALF[HANDAKUTEN_MAP[k]] = halfBase + "\uFF9F";
  }
})();

const transformHan = (v) => {
  let result = "";
  for (let i = 0; i < v.length; i++) {
    const ch = v.charAt(i);
    const code = v.charCodeAt(i);
    if (code >= 0xFF01 && code <= 0xFF5E) { result += String.fromCharCode(code - 0xFEE0); continue; }
    if (code === 0x3000) { result += " "; continue; }
    if (DAKUTEN_TO_HALF[ch]) { result += DAKUTEN_TO_HALF[ch]; continue; }
    if (HANDAKUTEN_TO_HALF[ch]) { result += HANDAKUTEN_TO_HALF[ch]; continue; }
    if (FULLWIDTH_KANA_TO_HALF[ch]) { result += FULLWIDTH_KANA_TO_HALF[ch]; continue; }
    result += ch;
  }
  return result;
};

const transformNoext = (value) => {
  if (!value) return "";
  return value.split(", ").map((part) => {
    const trimmed = part.trim();
    const dotIndex = trimmed.lastIndexOf(".");
    return dotIndex > 0 ? trimmed.substring(0, dotIndex) : trimmed;
  }).join(", ");
};

// ---------------------------------------------------------------------------
// Transformer registry
// ---------------------------------------------------------------------------

const TRANSFORMERS = {
  noext: transformNoext,
  time: transformTime,
  left: transformLeft,
  right: transformRight,
  mid: transformMid,
  pad: transformPad,
  padRight: transformPadRight,
  upper: transformUpper,
  lower: transformLower,
  trim: transformTrim,
  default: transformDefault,
  replace: transformReplace,
  match: transformMatch,
  number: transformNumber,
  if: transformIf,
  map: transformMap,
  kana: transformKana,
  zen: transformZen,
  han: transformHan,
};

// ---------------------------------------------------------------------------
// Pipe parser & applicator
// ---------------------------------------------------------------------------

const splitEscaped = (str, delimiter) => {
  const sentinel = `__NFB_ESC_${delimiter.charCodeAt(0)}__`;
  return str.split("\\" + delimiter).join(sentinel).split(delimiter).map((p) => p.split(sentinel).join(delimiter));
};

const parsePipeTransformers = (transformerString) => {
  return splitEscaped(transformerString, "|").map((segment) => {
    const colonIndex = segment.indexOf(":");
    return colonIndex >= 0
      ? { name: segment.substring(0, colonIndex), args: segment.substring(colonIndex + 1) }
      : { name: segment, args: "" };
  });
};

export const applyPipeTransformers = (value, transformerString, context) => {
  const transformers = parsePipeTransformers(transformerString);
  let current = value == null ? "" : String(value);
  for (const { name, args } of transformers) {
    const fn = TRANSFORMERS[name];
    if (fn) current = fn(current, args, context);
  }
  return current;
};

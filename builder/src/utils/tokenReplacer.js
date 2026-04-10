/**
 * フロントエンド向けテンプレートトークン置換エンジン
 *
 * バックエンド gas/drive.gs の nfbResolveTemplateTokens_ と同等のロジックを
 * フロントエンドで再現する。質問カードの項目名・選択肢・プレースホルダー等に
 * {ID}, {_NOW|date:YYYY年MM月DD日}, {フィールド名} などのトークンを埋め込み、
 * フォーム表示時に実際の値へ置換する。
 *
 * 予約トークン:
 *   {_ID}          - レコードID
 *   {_NOW}         - 現在日時 ("yyyy-MM-dd HH:mm:ss")。パイプで整形可:
 *                    {_NOW|date:YYYY年MM月DD日}  {_NOW|time:HH時mm分}
 *   {_folder_url}  - Driveフォルダ URL
 *   {_record_url}  - レコード URL
 *   {_form_url}    - フォーム URL
 *   {_file_urls}   - アップロードファイル URL（カンマ区切り）
 *
 * フィールド参照:
 *   {フィールドラベル}           - 該当フィールドの現在の値
 *   {\フィールドラベル}          - バックスラッシュで強制フィールド参照
 *   {フィールドラベル|upper}     - パイプ変換付き
 *
 * エスケープ:
 *   \{ → {  \} → }
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

const formatNow = (date) => {
  const dp = getDateParts(date);
  return `${dp.year}-${pad2(dp.month)}-${pad2(dp.day)} ${pad2(dp.hour)}:${pad2(dp.minute)}:${pad2(dp.second)}`;
};

// ---------------------------------------------------------------------------
// Reserved tokens
// ---------------------------------------------------------------------------

const RESERVED_TOKENS = new Set(["_ID", "_NOW", "_folder_url", "_record_url", "_form_url", "_file_urls"]);

const isReservedToken = (tokenName) => RESERVED_TOKENS.has(tokenName);

const resolveReservedToken = (tokenName, context) => {
  if (tokenName === "_ID") return context.recordId || "";
  if (tokenName === "_NOW") return formatNow(context.now || new Date());
  if (tokenName === "_folder_url") return context.folderUrl || "";
  if (tokenName === "_record_url") return context.recordUrl || "";
  if (tokenName === "_form_url") return context.formUrl || "";
  if (tokenName === "_file_urls") return context.fileUrls || "";
  return null;
};

// ---------------------------------------------------------------------------
// Field label → value map
// ---------------------------------------------------------------------------

const valueToString = (value) => {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
};

const collectFileUploadFieldIds = (fields, ids) => {
  (fields || []).forEach((f) => {
    if (f?.type === "fileUpload" && f?.id) ids.add(f.id);
    if (f?.childrenByValue) Object.values(f.childrenByValue).forEach((ch) => collectFileUploadFieldIds(ch, ids));
  });
};

const extractFileUrls = (raw) => {
  const files = Array.isArray(raw) ? raw : [];
  return files.map((f) => f?.driveFileUrl || "").filter(Boolean).join(", ");
};

/**
 * @param {Object} fieldLabels  - { fieldId: label }
 * @param {Object} fieldValues  - { fieldId: formattedValue }
 * @param {Object} responses    - { fieldId: rawValue }
 * @param {Array}  [schema]     - フォームスキーマ（fileUpload URL 解決用）
 */
export const buildLabelValueMap = (fieldLabels, fieldValues, responses, schema) => {
  const fileUploadIds = new Set();
  if (schema) collectFileUploadFieldIds(schema, fileUploadIds);

  const map = {};
  for (const fid of Object.keys(fieldLabels || {})) {
    const label = fieldLabels[fid];
    if (!label || Object.prototype.hasOwnProperty.call(map, label)) continue;
    if (fileUploadIds.has(fid)) {
      map[label] = extractFileUrls((responses || {})[fid]);
    } else {
      const value = Object.prototype.hasOwnProperty.call(fieldValues || {}, fid)
        ? fieldValues[fid]
        : (responses || {})[fid];
      map[label] = valueToString(value);
    }
  }
  return map;
};

// ---------------------------------------------------------------------------
// Pipe transformers (ported from gas/drive.gs)
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

const transformDate = (value, formatStr) => {
  const dp = parseDateString(value);
  if (!dp) return value;
  const era = resolveJapaneseEra(dp);
  const dow = new Date(dp.year, dp.month - 1, dp.day).getDay();
  let result = formatStr;
  result = result.split("dddd").join(DAY_OF_WEEK_LONG[dow]);
  result = result.split("ddd").join(DAY_OF_WEEK_SHORT[dow]);
  result = result.split("gge").join(era.name + String(era.year));
  result = result.split("gg").join(era.name);
  result = result.split("YYYY").join(String(dp.year));
  result = result.split("YY").join(("0" + dp.year).slice(-2));
  result = result.split("MM").join(("0" + dp.month).slice(-2));
  result = result.split("DD").join(("0" + dp.day).slice(-2));
  result = result.split("ee").join(("0" + era.year).slice(-2));
  result = result.split("M").join(String(dp.month));
  result = result.split("D").join(String(dp.day));
  result = result.split("e").join(String(era.year));
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

const transformTime = (value, formatStr) => {
  const tp = parseTimeString(value);
  if (!tp) return value;
  let result = formatStr;
  result = result.split("HH").join(("0" + tp.hour).slice(-2));
  result = result.split("mm").join(("0" + tp.minute).slice(-2));
  result = result.split("ss").join(("0" + tp.second).slice(-2));
  result = result.split("H").join(String(tp.hour));
  result = result.split("m").join(String(tp.minute));
  result = result.split("s").join(String(tp.second));
  return result;
};

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

const transformIf = (v, args) => {
  const firstComma = args.indexOf(",");
  if (firstComma < 0) return v;
  const testVal = args.substring(0, firstComma);
  const rest = args.substring(firstComma + 1);
  const secondComma = rest.indexOf(",");
  const thenVal = secondComma >= 0 ? rest.substring(0, secondComma) : rest;
  const elseVal = secondComma >= 0 ? rest.substring(secondComma + 1) : "";
  if (testVal === "") return v ? thenVal : elseVal;
  return v === testVal ? thenVal : elseVal;
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

const TRANSFORMERS = {
  date: transformDate,
  time: transformTime,
  left: transformLeft,
  right: transformRight,
  mid: transformMid,
  pad: transformPad,
  padRight: transformPadRight,
  upper: (v) => v.toUpperCase(),
  lower: (v) => v.toLowerCase(),
  trim: (v) => v.trim(),
  default: (v, a) => v ? v : String(a),
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
// Pipe parser
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

const applyPipeTransformers = (value, transformerString) => {
  const transformers = parsePipeTransformers(transformerString);
  let current = value == null ? "" : String(value);
  for (const { name, args } of transformers) {
    const fn = TRANSFORMERS[name];
    if (fn) current = fn(current, args);
  }
  return current;
};

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * テンプレートトークンを解決する
 *
 * @param {string} template - トークンを含むテンプレート文字列
 * @param {{ now?: Date, recordId?: string, folderUrl?: string, recordUrl?: string, formUrl?: string, fileUrls?: string, labelValueMap?: Object }} context
 * @returns {string} 解決済みの文字列
 */
export const resolveTemplateTokens = (template, context) => {
  if (!template || typeof template !== "string") return template || "";
  if (!template.includes("{")) return template;

  const ctx = context || {};
  const ESC_OPEN = "__NFB_ESC_OB__";
  const ESC_CLOSE = "__NFB_ESC_CB__";

  const result = template
    .split("\\{").join(ESC_OPEN)
    .split("\\}").join(ESC_CLOSE)
    .replace(/\{([^{}]+)\}/g, (_match, tokenBody) => {
      const raw = tokenBody || "";
      const forceField = raw.startsWith("\\");
      const tokenName = forceField ? raw.slice(1) : raw;
      if (!tokenName) return "";

      const pipeIndex = tokenName.indexOf("|");
      if (pipeIndex >= 0) {
        const fieldPart = tokenName.substring(0, pipeIndex);
        const transformersPart = tokenName.substring(pipeIndex + 1);
        let resolved;
        if (!forceField) {
          const reservedVal = resolveReservedToken(fieldPart, ctx);
          resolved = reservedVal !== null ? reservedVal : ((ctx.labelValueMap || {})[fieldPart] ?? "");
        } else {
          resolved = (ctx.labelValueMap || {})[fieldPart] ?? "";
        }
        return applyPipeTransformers(resolved, transformersPart);
      }

      if (!forceField) {
        const reservedVal = resolveReservedToken(tokenName, ctx);
        if (reservedVal !== null) return reservedVal;
      }
      return (ctx.labelValueMap || {})[tokenName] ?? "";
    });

  return result.split(ESC_OPEN).join("{").split(ESC_CLOSE).join("}");
};

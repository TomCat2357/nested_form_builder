/* AUTO-GENERATED — DO NOT EDIT.
   Source: builder/src/features/expression/gasRuntimeEntry.js
   Regenerate: npm run build:gas-udfs */
var NfbAlasqlRuntime = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // builder/src/features/expression/gasRuntimeEntry.js
  var gasRuntimeEntry_exports = {};
  __export(gasRuntimeEntry_exports, {
    MULTI_VALUE_SEP: () => MULTI_VALUE_SEP,
    ULID_ALPHABET: () => ULID_ALPHABET,
    ULID_RANDOM_LENGTH: () => ULID_RANDOM_LENGTH,
    coerceResultToString: () => coerceResultToString,
    collectBalancedBraces: () => collectBalancedBraces,
    createUlid: () => createUlid,
    encodeUlidRandom: () => encodeUlidRandom,
    encodeUlidTime: () => encodeUlidTime,
    ensureNfbUdfsRegistered: () => ensureNfbUdfsRegistered,
    escapeBraces: () => escapeBraces,
    escapeSegment: () => escapeSegment,
    fieldHasValue: () => fieldHasValue,
    formatCanonical: () => formatCanonical,
    formatJstString: () => formatJstString,
    headerKeyToAlaSqlKey: () => headerKeyToAlaSqlKey,
    incrementBase32: () => incrementBase32,
    isFullQueryBody: () => isFullQueryBody,
    joinEscaped: () => joinEscaped,
    joinFieldPath: () => joinFieldPath,
    joinMultiValue: () => joinMultiValue,
    mapSchema: () => mapSchema,
    parseJstString: () => parseJstString,
    preprocessAlaSqlExpression: () => preprocessAlaSqlExpression,
    resolveOrderedChildKeys: () => resolveOrderedChildKeys,
    scanAndReplace: () => scanAndReplace,
    shouldShowUnconditionalChildren: () => shouldShowUnconditionalChildren,
    splitEscaped: () => splitEscaped,
    splitFieldKey: () => splitFieldKey,
    splitFieldPath: () => splitFieldPath,
    splitMultiValue: () => splitMultiValue,
    splitTopLevelCommas: () => splitTopLevelCommas,
    toMsUnixTime: () => toMsUnixTime,
    traverseSchema: () => traverseSchema,
    unescapeBraces: () => unescapeBraces
  });

  // builder/src/features/expression/kanaTables.js
  var HALF_TO_FULL_KANA = {
    "\uFF66": "\u30F2",
    "\uFF67": "\u30A1",
    "\uFF68": "\u30A3",
    "\uFF69": "\u30A5",
    "\uFF6A": "\u30A7",
    "\uFF6B": "\u30A9",
    "\uFF6C": "\u30E3",
    "\uFF6D": "\u30E5",
    "\uFF6E": "\u30E7",
    "\uFF6F": "\u30C3",
    "\uFF70": "\u30FC",
    "\uFF71": "\u30A2",
    "\uFF72": "\u30A4",
    "\uFF73": "\u30A6",
    "\uFF74": "\u30A8",
    "\uFF75": "\u30AA",
    "\uFF76": "\u30AB",
    "\uFF77": "\u30AD",
    "\uFF78": "\u30AF",
    "\uFF79": "\u30B1",
    "\uFF7A": "\u30B3",
    "\uFF7B": "\u30B5",
    "\uFF7C": "\u30B7",
    "\uFF7D": "\u30B9",
    "\uFF7E": "\u30BB",
    "\uFF7F": "\u30BD",
    "\uFF80": "\u30BF",
    "\uFF81": "\u30C1",
    "\uFF82": "\u30C4",
    "\uFF83": "\u30C6",
    "\uFF84": "\u30C8",
    "\uFF85": "\u30CA",
    "\uFF86": "\u30CB",
    "\uFF87": "\u30CC",
    "\uFF88": "\u30CD",
    "\uFF89": "\u30CE",
    "\uFF8A": "\u30CF",
    "\uFF8B": "\u30D2",
    "\uFF8C": "\u30D5",
    "\uFF8D": "\u30D8",
    "\uFF8E": "\u30DB",
    "\uFF8F": "\u30DE",
    "\uFF90": "\u30DF",
    "\uFF91": "\u30E0",
    "\uFF92": "\u30E1",
    "\uFF93": "\u30E2",
    "\uFF94": "\u30E4",
    "\uFF95": "\u30E6",
    "\uFF96": "\u30E8",
    "\uFF97": "\u30E9",
    "\uFF98": "\u30EA",
    "\uFF99": "\u30EB",
    "\uFF9A": "\u30EC",
    "\uFF9B": "\u30ED",
    "\uFF9C": "\u30EF",
    "\uFF9D": "\u30F3"
  };
  var DAKUTEN_MAP = {
    "\u30AB": "\u30AC",
    "\u30AD": "\u30AE",
    "\u30AF": "\u30B0",
    "\u30B1": "\u30B2",
    "\u30B3": "\u30B4",
    "\u30B5": "\u30B6",
    "\u30B7": "\u30B8",
    "\u30B9": "\u30BA",
    "\u30BB": "\u30BC",
    "\u30BD": "\u30BE",
    "\u30BF": "\u30C0",
    "\u30C1": "\u30C2",
    "\u30C4": "\u30C5",
    "\u30C6": "\u30C7",
    "\u30C8": "\u30C9",
    "\u30CF": "\u30D0",
    "\u30D2": "\u30D3",
    "\u30D5": "\u30D6",
    "\u30D8": "\u30D9",
    "\u30DB": "\u30DC",
    "\u30A6": "\u30F4"
  };
  var HANDAKUTEN_MAP = {
    "\u30CF": "\u30D1",
    "\u30D2": "\u30D4",
    "\u30D5": "\u30D7",
    "\u30D8": "\u30DA",
    "\u30DB": "\u30DD"
  };
  var FULL_TO_HALF_KANA = {};
  var DAKUTEN_TO_HALF = {};
  var HANDAKUTEN_TO_HALF = {};
  for (const k of Object.keys(HALF_TO_FULL_KANA)) {
    FULL_TO_HALF_KANA[HALF_TO_FULL_KANA[k]] = k;
  }
  for (const k of Object.keys(DAKUTEN_MAP)) {
    const halfBase = FULL_TO_HALF_KANA[k];
    if (halfBase) DAKUTEN_TO_HALF[DAKUTEN_MAP[k]] = halfBase + "\uFF9E";
  }
  for (const k of Object.keys(HANDAKUTEN_MAP)) {
    const halfBase = FULL_TO_HALF_KANA[k];
    if (halfBase) HANDAKUTEN_TO_HALF[HANDAKUTEN_MAP[k]] = halfBase + "\uFF9F";
  }

  // builder/src/features/expression/eraConversion.js
  var ERAS = [
    { name: "\u4EE4\u548C", short: "R", start: new Date(2019, 4, 1), year: 2019, month: 5, day: 1 },
    { name: "\u5E73\u6210", short: "H", start: new Date(1989, 0, 8), year: 1989, month: 1, day: 8 },
    { name: "\u662D\u548C", short: "S", start: new Date(1926, 11, 25), year: 1926, month: 12, day: 25 },
    { name: "\u5927\u6B63", short: "T", start: new Date(1912, 6, 30), year: 1912, month: 7, day: 30 },
    { name: "\u660E\u6CBB", short: "M", start: new Date(1868, 0, 25), year: 1868, month: 1, day: 25 }
  ];
  function resolveEraFromParts(dateParts) {
    for (let i = 0; i < ERAS.length; i++) {
      const e = ERAS[i];
      const sameOrAfter = dateParts.year > e.year || dateParts.year === e.year && dateParts.month > e.month || dateParts.year === e.year && dateParts.month === e.month && dateParts.day >= e.day;
      if (sameOrAfter) return { name: e.name, year: dateParts.year - e.year + 1 };
    }
    return { name: "", year: dateParts.year };
  }
  var dateGte_ = (a, b) => a.year > b.year || a.year === b.year && a.month > b.month || a.year === b.year && a.month === b.month && a.day >= b.day;
  var eraStartParts_ = (e) => ({ year: e.start.getFullYear(), month: e.start.getMonth() + 1, day: e.start.getDate() });
  function formatEraNonPadded(dateParts, opts = {}) {
    if (!dateParts) return null;
    const { year, month, day } = dateParts;
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const era = ERAS.find((e) => dateGte_(dateParts, eraStartParts_(e)));
    if (!era) return null;
    const eraYearNum = year - era.start.getFullYear() + 1;
    const eraYearStr = eraYearNum === 1 ? "\u5143" : String(eraYearNum);
    let base = `${era.name}${eraYearStr}\u5E74${month}\u6708${day}\u65E5`;
    if (opts.withTime) {
      const hh = Number.isFinite(dateParts.hour) ? dateParts.hour : 0;
      const mi = Number.isFinite(dateParts.minute) ? dateParts.minute : 0;
      const ss = Number.isFinite(dateParts.second) ? dateParts.second : 0;
      const f = opts.padTime ? (n) => String(n).padStart(2, "0") : (n) => String(n);
      base += opts.timeKanji ? ` ${f(hh)}\u6642${f(mi)}\u5206${f(ss)}\u79D2` : ` ${f(hh)}:${f(mi)}:${f(ss)}`;
    }
    return base;
  }
  var ERA_TIME_KANJI_RE_ = /\s*(\d{1,2})時(?:(\d{1,2})分(?:(\d{1,2})秒)?)?$/;
  var ERA_TIME_COLON_RE_ = /\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;
  function parseEraFlexible(text) {
    if (text === null || text === void 0) return null;
    let s = String(text).trim();
    if (!s) return null;
    let hh = 0;
    let mi = 0;
    let ss = 0;
    let tm = s.match(ERA_TIME_KANJI_RE_);
    if (tm) {
      hh = parseInt(tm[1], 10);
      mi = tm[2] ? parseInt(tm[2], 10) : 0;
      ss = tm[3] ? parseInt(tm[3], 10) : 0;
      s = s.slice(0, tm.index).trim();
    } else {
      tm = s.match(ERA_TIME_COLON_RE_);
      if (tm) {
        hh = parseInt(tm[1], 10);
        mi = parseInt(tm[2], 10);
        ss = tm[3] ? parseInt(tm[3], 10) : 0;
        s = s.slice(0, tm.index).trim();
      }
    }
    if (hh < 0 || hh > 23 || mi < 0 || mi > 59 || ss < 0 || ss > 59) return null;
    let eraKey;
    let eraYearPart;
    let mo = 1;
    let da = 1;
    let d = s.match(/^(令和|平成|昭和|大正|明治)(元|\d{1,2})年(?:(\d{1,2})月(?:(\d{1,2})日)?)?$/);
    if (d) {
      eraKey = d[1];
      eraYearPart = d[2];
      mo = d[3] ? parseInt(d[3], 10) : 1;
      da = d[4] ? parseInt(d[4], 10) : 1;
    }
    if (!d) {
      d = s.match(/^([RHSTMrhstm])(元|\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{1,2}))?$/);
      if (d) {
        eraKey = d[1].toUpperCase();
        eraYearPart = d[2];
        mo = parseInt(d[3], 10);
        da = d[4] ? parseInt(d[4], 10) : 1;
      }
    }
    if (!d) {
      d = s.match(/^([RHSTMrhstm])(\d{2})(\d{2})(\d{2})$/);
      if (d) {
        eraKey = d[1].toUpperCase();
        eraYearPart = String(parseInt(d[2], 10));
        mo = parseInt(d[3], 10);
        da = parseInt(d[4], 10);
      }
    }
    if (!d) return null;
    const era = ERAS.find((e) => e.name === eraKey || e.short === eraKey);
    if (!era) return null;
    const eraYear = eraYearPart === "\u5143" ? 1 : parseInt(eraYearPart, 10);
    if (!Number.isInteger(eraYear) || eraYear < 1) return null;
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    const year = era.start.getFullYear() + eraYear - 1;
    return { year, month: mo, day: da, hour: hh, minute: mi, second: ss };
  }

  // builder/src/core/constants.js
  var RECORD_CACHE_MAX_AGE_MS = 30 * 60 * 1e3;
  var RECORD_CACHE_BACKGROUND_REFRESH_MS = 5 * 60 * 1e3;
  var FORM_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
  var FORM_CACHE_BACKGROUND_REFRESH_MS = 15 * 60 * 1e3;
  var ANALYTICS_SOURCE_TABLE_CACHE_TTL_MS = 60 * 60 * 1e3;
  var UPLOAD_RETRY_BASE_MS = 2 * 1e3;
  var UPLOAD_RETRY_MAX_MS = 5 * 60 * 1e3;
  var MS_PER_DAY = 24 * 60 * 60 * 1e3;
  var SERIAL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
  var JST_OFFSET_MS = 9 * 60 * 60 * 1e3;
  var UNIX_MS_THRESHOLD = 1e11;

  // builder/src/utils/dateTime.js
  var TIME_ZONE = "Asia/Tokyo";
  var DEFAULT_LOCALE = "ja-JP";
  var SERIAL_EPOCH_JST_MS = SERIAL_EPOCH_UTC_MS - JST_OFFSET_MS;
  var UNIX_SECONDS_THRESHOLD = 1e9;
  var pad2 = (value) => String(value).padStart(2, "0");
  var pad3 = (value) => String(value).padStart(3, "0");
  var normalizeNumericToUnixMs = (numeric) => {
    if (!Number.isFinite(numeric)) return null;
    const abs = Math.abs(numeric);
    if (abs >= UNIX_MS_THRESHOLD) return numeric;
    if (abs >= UNIX_SECONDS_THRESHOLD) return numeric * 1e3;
    return null;
  };
  var parseTzOffsetMs = (token) => {
    if (typeof token !== "string") return null;
    const s = token.trim();
    if (s === "Z" || s === "z") return 0;
    const m = s.match(/^([+-])(\d{2}):?(\d{2})$/);
    if (!m) return null;
    const sign = m[1] === "-" ? -1 : 1;
    const hh = parseInt(m[2], 10);
    const mm = parseInt(m[3], 10);
    if (hh > 23 || mm > 59) return null;
    return sign * (hh * 60 + mm) * 6e4;
  };
  var parseStringToUnixMs = (str) => {
    if (!str) return null;
    const dt = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T\/\s_]+(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d+))?)?\s*(Z|z|[+-]\d{2}:?\d{2})?)?$/);
    if (dt) {
      const year = parseInt(dt[1], 10);
      const month = parseInt(dt[2], 10);
      const day = parseInt(dt[3], 10);
      const hour = dt[4] ? parseInt(dt[4], 10) : 0;
      const minute = dt[5] ? parseInt(dt[5], 10) : 0;
      const second = dt[6] ? parseInt(dt[6], 10) : 0;
      const millisecond = dt[7] ? parseInt((dt[7] + "000").slice(0, 3), 10) : 0;
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
      let offsetMs = JST_OFFSET_MS;
      if (dt[8]) {
        const tz = parseTzOffsetMs(dt[8]);
        if (tz === null) return null;
        offsetMs = tz;
      }
      return Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offsetMs;
    }
    const t = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (t) {
      const hour = parseInt(t[1], 10);
      const minute = parseInt(t[2], 10);
      const second = t[3] ? parseInt(t[3], 10) : 0;
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
      return Date.UTC(1899, 11, 30, hour, minute, second) - JST_OFFSET_MS;
    }
    if (/^[-+]?\d+(?:\.\d+)?$/.test(str)) {
      const numeric = Number(str);
      if (!Number.isFinite(numeric)) return null;
      return normalizeNumericToUnixMs(numeric);
    }
    return null;
  };
  var toUnixMs = (value) => {
    if (value === null || value === void 0) return null;
    if (typeof value === "number" && Number.isFinite(value)) {
      return normalizeNumericToUnixMs(value);
    }
    if (value instanceof Date) return value.getTime();
    const parsed = parseStringToUnixMs(String(value).trim());
    return Number.isFinite(parsed) ? parsed : null;
  };
  var buildFormatter = (options) => new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeZone: TIME_ZONE, hour12: false, ...options });
  var formatterDate = buildFormatter({ year: "numeric", month: "2-digit", day: "2-digit" });
  var formatterTime = buildFormatter({ hour: "2-digit", minute: "2-digit" });
  var JST_STORAGE_RE = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T\s_]+(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,3}))?)?)?$/;
  var formatJstString = (value) => {
    if (value === null || value === void 0 || value === "") return "";
    let unixMs;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return "";
      const parsedDate = parseJstString(trimmed);
      if (parsedDate) {
        unixMs = parsedDate.getTime();
      } else {
        unixMs = toUnixMs(trimmed);
      }
    } else if (typeof value === "number" && Number.isFinite(value)) {
      unixMs = normalizeNumericToUnixMs(value);
    } else if (value instanceof Date) {
      unixMs = value.getTime();
    } else {
      return "";
    }
    if (!Number.isFinite(unixMs)) return "";
    const jstDate = new Date(unixMs + JST_OFFSET_MS);
    const yyyy = jstDate.getUTCFullYear();
    const mm = pad2(jstDate.getUTCMonth() + 1);
    const dd = pad2(jstDate.getUTCDate());
    const hh = pad2(jstDate.getUTCHours());
    const mi = pad2(jstDate.getUTCMinutes());
    const ss = pad2(jstDate.getUTCSeconds());
    const sss = pad3(jstDate.getUTCMilliseconds());
    return `${yyyy}-${mm}-${dd}_${hh}:${mi}:${ss}.${sss}`;
  };
  var parseJstString = (str) => {
    if (typeof str !== "string") return null;
    const trimmed = str.trim();
    if (!trimmed) return null;
    const m = trimmed.match(JST_STORAGE_RE);
    if (!m) return null;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    const hour = m[4] ? parseInt(m[4], 10) : 0;
    const minute = m[5] ? parseInt(m[5], 10) : 0;
    const second = m[6] ? parseInt(m[6], 10) : 0;
    const ms = m[7] ? parseInt(m[7].padEnd(3, "0"), 10) : 0;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
    const utcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms) - JST_OFFSET_MS;
    if (!Number.isFinite(utcMs)) return null;
    return new Date(utcMs);
  };
  var nowJstString = () => formatJstString(Date.now());
  var TIME_ONLY_RE = /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?$/;
  var parseTimeStringToMsSinceMidnight = (str) => {
    if (typeof str !== "string") return null;
    const m = str.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
    if (!m) return null;
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    const second = m[3] ? parseInt(m[3], 10) : 0;
    const ms = m[4] ? parseInt(m[4].padEnd(3, "0"), 10) : 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
    return hour * 36e5 + minute * 6e4 + second * 1e3 + ms;
  };
  var extractJstPartsFull = (value) => {
    const ms = toUnixMs(value);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms + JST_OFFSET_MS);
    if (Number.isNaN(d.getTime())) return null;
    return {
      unixMs: ms,
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      ms: d.getUTCMilliseconds()
    };
  };
  var toMsUnixTime = (v) => {
    if (v === null || v === void 0 || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? normalizeNumericToUnixMs(v) : null;
    if (v instanceof Date) {
      const t = v.getTime();
      return Number.isFinite(t) ? t : null;
    }
    const s = String(v).trim();
    if (!s) return null;
    if (TIME_ONLY_RE.test(s)) return parseTimeStringToMsSinceMidnight(s);
    const ms = parseStringToUnixMs(s);
    return Number.isFinite(ms) ? ms : null;
  };
  var pad4 = (value) => String(value).padStart(4, "0");
  var formatTimeParts_ = (hh, mi, ss, sss, kind) => {
    if (kind === "timem") return `${pad2(hh)}:${pad2(mi)}`;
    if (kind === "times") return `${pad2(hh)}:${pad2(mi)}:${pad2(ss)}`;
    return `${pad2(hh)}:${pad2(mi)}:${pad2(ss)}.${pad3(sss)}`;
  };
  var TIME_KINDS_ = /* @__PURE__ */ new Set(["time", "timems", "times", "timem"]);
  var TIME_ONLY_BASE_DATE_ = { year: 1970, month: 1, day: 1 };
  var formatCanonical = (v, kind) => {
    if (v === null || v === void 0 || v === "") return null;
    const isTimeOnlyStr = typeof v === "string" && TIME_ONLY_RE.test(v.trim());
    let hh, mi, ss, sss, datedParts;
    if (isTimeOnlyStr) {
      const msMid = parseTimeStringToMsSinceMidnight(v.trim());
      if (msMid === null) return null;
      const total = (msMid % MS_PER_DAY + MS_PER_DAY) % MS_PER_DAY;
      hh = Math.floor(total / 36e5);
      mi = Math.floor(total % 36e5 / 6e4);
      ss = Math.floor(total % 6e4 / 1e3);
      sss = total % 1e3;
      datedParts = { ...TIME_ONLY_BASE_DATE_, hour: hh, minute: mi, second: ss, ms: sss };
    } else {
      const p = extractJstPartsFull(v);
      if (!p) return null;
      hh = p.hour;
      mi = p.minute;
      ss = p.second;
      sss = p.ms || 0;
      datedParts = p;
    }
    if (TIME_KINDS_.has(kind)) return formatTimeParts_(hh, mi, ss, sss, kind);
    if (kind === "date") {
      return `${pad4(datedParts.year)}-${pad2(datedParts.month)}-${pad2(datedParts.day)}`;
    }
    return `${pad4(datedParts.year)}-${pad2(datedParts.month)}-${pad2(datedParts.day)}_${pad2(hh)}:${pad2(mi)}:${pad2(ss)}.${pad3(sss)}`;
  };

  // builder/src/utils/pathCodec.js
  var PATH_SEP = "/";
  function escapeSegment(segment, sep) {
    const s = String(segment === null || segment === void 0 ? "" : segment);
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "\\" || ch === sep) out += "\\";
      out += ch;
    }
    return out;
  }
  function joinEscaped(segments, sep) {
    if (!Array.isArray(segments)) return "";
    const out = [];
    for (let i = 0; i < segments.length; i++) out.push(escapeSegment(segments[i], sep));
    return out.join(sep);
  }
  function splitEscaped(text, sep, allowQuotes) {
    const str = String(text === null || text === void 0 ? "" : text);
    const tokens = [];
    let current = "";
    let escaping = false;
    let quote = null;
    let i = 0;
    while (i < str.length) {
      const ch = str[i];
      if (escaping) {
        current += ch;
        escaping = false;
        i++;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        i++;
        continue;
      }
      if (quote) {
        if (ch === quote) {
          if (str[i + 1] === quote) {
            current += quote;
            i += 2;
            continue;
          }
          quote = null;
          i++;
          continue;
        }
        current += ch;
        i++;
        continue;
      }
      if (allowQuotes && (ch === "'" || ch === '"')) {
        quote = ch;
        i++;
        continue;
      }
      if (ch === sep) {
        tokens.push(current);
        current = "";
        i++;
        continue;
      }
      current += ch;
      i++;
    }
    if (escaping) current += "\\";
    tokens.push(current);
    return tokens;
  }
  function joinFieldPath(segments) {
    return joinEscaped(segments, PATH_SEP);
  }
  function splitFieldPath(path) {
    if (path === null || path === void 0 || path === "") return [];
    const raw = splitEscaped(path, PATH_SEP, true);
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const seg = raw[i].trim();
      if (seg) out.push(seg);
    }
    return out;
  }
  function splitFieldKey(key) {
    if (key === null || key === void 0 || key === "") return [];
    return splitEscaped(key, PATH_SEP, false);
  }

  // builder/src/utils/multiValue.js
  var MULTI_VALUE_SEP = ",";
  function joinMultiValue(labels) {
    if (!Array.isArray(labels)) return "";
    const out = [];
    for (let i = 0; i < labels.length; i++) {
      const lbl = labels[i];
      if (lbl === null || lbl === void 0) continue;
      const s = String(lbl);
      if (s === "") continue;
      out.push(escapeSegment(s, MULTI_VALUE_SEP));
    }
    return out.join(MULTI_VALUE_SEP);
  }
  function splitMultiValue(text) {
    if (text === null || text === void 0) return [];
    const str = String(text);
    if (str === "") return [];
    const tokens = splitEscaped(str, MULTI_VALUE_SEP, false);
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] !== "") out.push(tokens[i]);
    }
    return out;
  }

  // builder/src/features/expression/registerNfbUdfs.js
  var DAY_OF_WEEK_SHORT = ["\u65E5", "\u6708", "\u706B", "\u6C34", "\u6728", "\u91D1", "\u571F"];
  var DAY_OF_WEEK_LONG = ["\u65E5\u66DC\u65E5", "\u6708\u66DC\u65E5", "\u706B\u66DC\u65E5", "\u6C34\u66DC\u65E5", "\u6728\u66DC\u65E5", "\u91D1\u66DC\u65E5", "\u571F\u66DC\u65E5"];
  var TIME_ONLY_STR_RE = /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?$/;
  function valueToFullParts(value) {
    if (value === null || value === void 0 || value === "") return null;
    if (typeof value === "string") {
      const s = value.trim();
      if (TIME_ONLY_STR_RE.test(s)) {
        const msMid = parseTimeStringToMsSinceMidnight(s);
        if (msMid === null) return null;
        const total = (msMid % MS_PER_DAY + MS_PER_DAY) % MS_PER_DAY;
        return {
          year: null,
          month: null,
          day: null,
          hour: Math.floor(total / 36e5),
          minute: Math.floor(total % 36e5 / 6e4),
          second: Math.floor(total % 6e4 / 1e3),
          ms: msMid % 1e3
        };
      }
    }
    return extractJstPartsFull(value);
  }
  function dateValueToParts(value) {
    if (value === null || value === void 0 || value === "") return null;
    if (typeof value === "string") {
      const s = value.trim();
      if (!s) return null;
      if (TIME_ONLY_STR_RE.test(s)) {
        const tm = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,3}))?)?/);
        const hh = Number(tm[1]);
        const mi = Number(tm[2]);
        const ss = tm[3] ? Number(tm[3]) : 0;
        const ms = tm[4] ? Number(tm[4].padEnd(3, "0")) : 0;
        if (hh > 23 || mi > 59 || ss > 59) return null;
        return { date: null, time: { hour: hh, minute: mi, second: ss, ms } };
      }
      if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}[T\/\s_]/.test(s) && /(?:Z|z|[+-]\d{2}:?\d{2})$/.test(s)) {
        const pz = extractJstPartsFull(value);
        if (!pz) return null;
        return { date: { year: pz.year, month: pz.month, day: pz.day }, time: { hour: pz.hour, minute: pz.minute, second: pz.second, ms: pz.ms || 0 } };
      }
      const m1 = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
      if (m1) {
        const dateParts = { year: Number(m1[1]), month: Number(m1[2]), day: Number(m1[3]) };
        const tm = s.match(/[\sT_](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?/);
        const timeParts = tm ? { hour: Number(tm[1]), minute: Number(tm[2]), second: tm[3] ? Number(tm[3]) : 0, ms: tm[4] ? Number(tm[4].padEnd(3, "0")) : 0 } : null;
        return { date: dateParts, time: timeParts };
      }
      const m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (m2) {
        return { date: { year: Number(m2[1]), month: Number(m2[2]), day: Number(m2[3]) }, time: null };
      }
      const t = Date.parse(s);
      if (!Number.isFinite(t)) return null;
      const d = new Date(t);
      return {
        date: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
        time: { hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(), ms: d.getMilliseconds() }
      };
    }
    const p = extractJstPartsFull(value);
    if (!p) return null;
    return { date: { year: p.year, month: p.month, day: p.day }, time: { hour: p.hour, minute: p.minute, second: p.second, ms: p.ms || 0 } };
  }
  function replaceTokens(formatStr, replacements) {
    let result = formatStr;
    for (let i = 0; i < replacements.length; i++) {
      result = result.split(replacements[i][0]).join(replacements[i][1]);
    }
    return result;
  }
  var REGISTERED = "__nfb_udfs_registered__";
  function ensureNfbUdfsRegistered(alasql) {
    if (!alasql) return;
    alasql.fn = alasql.fn || {};
    alasql.aggr = alasql.aggr || {};
    if (alasql.fn[REGISTERED]) return;
    alasql.fn.TO_BOOL = function(value) {
      if (value === null || value === void 0) return false;
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
      const s = String(value).trim().toLowerCase();
      if (s === "" || s === "0" || s === "false" || s === "no" || s === "off") return false;
      return true;
    };
    alasql.fn.TO_NUMBER = function(value) {
      if (value === null || value === void 0 || value === "") return null;
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      const n = Number(String(value).trim());
      return Number.isFinite(n) ? n : null;
    };
    alasql.fn.DATE = function(value) {
      return formatCanonical(value, "date");
    };
    alasql.fn.DATETIME = function(value) {
      return formatCanonical(value, "datetime");
    };
    alasql.fn.TIME = function(value) {
      return formatCanonical(value, "time");
    };
    alasql.fn.TIMEMS = function(value) {
      return formatCanonical(value, "time");
    };
    alasql.fn.TIMES = function(value) {
      return formatCanonical(value, "times");
    };
    alasql.fn.TIMEM = function(value) {
      return formatCanonical(value, "timem");
    };
    alasql.fn.TIMESTAMP = function(value) {
      const ms = toMsUnixTime(value);
      return Number.isFinite(ms) ? ms : null;
    };
    alasql.fn.YEAR = function(value) {
      const p = valueToFullParts(value);
      return p && p.year != null ? p.year : null;
    };
    alasql.fn.MONTH = function(value) {
      const p = valueToFullParts(value);
      return p && p.month != null ? p.month : null;
    };
    alasql.fn.DAY = function(value) {
      const p = valueToFullParts(value);
      return p && p.day != null ? p.day : null;
    };
    alasql.fn.HOUR = function(value) {
      const p = valueToFullParts(value);
      return p && p.hour != null ? p.hour : null;
    };
    alasql.fn.MINUTE = function(value) {
      const p = valueToFullParts(value);
      return p && p.minute != null ? p.minute : null;
    };
    alasql.fn.SECOND = function(value) {
      const p = valueToFullParts(value);
      if (!p || p.second == null) return null;
      return p.ms ? p.second + p.ms / 1e3 : p.second;
    };
    alasql.fn.NENDO = function(value) {
      const p = valueToFullParts(value);
      if (!p || p.year == null || p.month == null) return null;
      return p.month >= 4 ? p.year : p.year - 1;
    };
    alasql.fn.LIKE_ANY = function(needle, ...cols) {
      if (needle === null || needle === void 0) return false;
      const nLower = String(needle).toLowerCase();
      if (!nLower) return true;
      function valueToStrings(v) {
        if (v === null || v === void 0) return [];
        if (typeof v === "number") {
          if (!Number.isFinite(v)) return [];
          const out = [String(v)];
          if (Math.abs(v) >= UNIX_MS_THRESHOLD) {
            try {
              out.push(new Date(v).toISOString());
            } catch (_e) {
            }
          }
          return out;
        }
        if (v instanceof Date) {
          try {
            return [v.toISOString()];
          } catch (_e) {
            return [String(v)];
          }
        }
        if (Array.isArray(v)) {
          const parts = [];
          for (const x of v) {
            for (const s of valueToStrings(x)) parts.push(s);
          }
          return parts;
        }
        if (typeof v === "object") {
          if (v.name) return [String(v.name)];
          try {
            return [JSON.stringify(v)];
          } catch (_e) {
            return [String(v)];
          }
        }
        return [String(v)];
      }
      for (let i = 0; i < cols.length; i++) {
        const candidates = valueToStrings(cols[i]);
        for (let k = 0; k < candidates.length; k++) {
          if (candidates[k].toLowerCase().indexOf(nLower) >= 0) return true;
        }
      }
      return false;
    };
    alasql.fn.MV_EQ = function(cell, target) {
      const tokens = splitMultiValue(cell);
      const t = String(target);
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === t) return true;
      }
      return false;
    };
    alasql.fn.MV_IN = function(cell, ...targets) {
      const tokens = splitMultiValue(cell);
      if (tokens.length === 0) return false;
      const targetStrs = targets.map((v) => String(v));
      for (let i = 0; i < tokens.length; i++) {
        for (let k = 0; k < targetStrs.length; k++) {
          if (tokens[i] === targetStrs[k]) return true;
        }
      }
      return false;
    };
    alasql.fn.KANA = function(value) {
      if (value === null || value === void 0) return "";
      const s = String(value);
      let result = "";
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code >= 12353 && code <= 12438) {
          result += String.fromCharCode(code + 96);
        } else {
          result += s.charAt(i);
        }
      }
      return result;
    };
    alasql.fn.ZEN = function(value) {
      if (value === null || value === void 0) return "";
      const s = String(value);
      let result = "";
      for (let i = 0; i < s.length; i++) {
        const ch = s.charAt(i);
        const code = s.charCodeAt(i);
        if (code >= 33 && code <= 126) {
          result += String.fromCharCode(code + 65248);
          continue;
        }
        if (code === 32) {
          result += "\u3000";
          continue;
        }
        const mapped = HALF_TO_FULL_KANA[ch];
        if (mapped) {
          const next = i + 1 < s.length ? s.charAt(i + 1) : "";
          if (next === "\uFF9E" && DAKUTEN_MAP[mapped]) {
            result += DAKUTEN_MAP[mapped];
            i++;
          } else if (next === "\uFF9F" && HANDAKUTEN_MAP[mapped]) {
            result += HANDAKUTEN_MAP[mapped];
            i++;
          } else {
            result += mapped;
          }
          continue;
        }
        result += ch;
      }
      return result;
    };
    alasql.fn.HAN = function(value) {
      if (value === null || value === void 0) return "";
      const s = String(value);
      let result = "";
      for (let i = 0; i < s.length; i++) {
        const ch = s.charAt(i);
        const code = s.charCodeAt(i);
        if (code >= 65281 && code <= 65374) {
          result += String.fromCharCode(code - 65248);
          continue;
        }
        if (code === 12288) {
          result += " ";
          continue;
        }
        if (DAKUTEN_TO_HALF[ch]) {
          result += DAKUTEN_TO_HALF[ch];
          continue;
        }
        if (HANDAKUTEN_TO_HALF[ch]) {
          result += HANDAKUTEN_TO_HALF[ch];
          continue;
        }
        if (FULL_TO_HALF_KANA[ch]) {
          result += FULL_TO_HALF_KANA[ch];
          continue;
        }
        result += ch;
      }
      return result;
    };
    alasql.fn.NUMBER_FORMAT = function(value, formatStr) {
      if (value === null || value === void 0 || value === "") return "";
      const num = parseFloat(String(value).replace(/^\s+|\s+$/g, ""));
      if (Number.isNaN(num)) return String(value);
      if (!formatStr) return String(num);
      const fmtMatch = String(formatStr).match(/^([^#0,.]*)([#0,.]+)(.*)$/);
      if (!fmtMatch) return String(value);
      const prefix = fmtMatch[1];
      const numFmt = fmtMatch[2];
      const suffix = fmtMatch[3];
      const isNeg = num < 0;
      const absNum = Math.abs(num);
      const dotIndex = numFmt.indexOf(".");
      const useThousands = numFmt.indexOf(",") >= 0;
      const decimalPlaces = dotIndex >= 0 ? numFmt.length - dotIndex - 1 : 0;
      const fixed = absNum.toFixed(decimalPlaces);
      let intPart;
      let decPart;
      if (decimalPlaces > 0) {
        const parts = fixed.split(".");
        intPart = parts[0];
        decPart = parts[1];
      } else {
        intPart = fixed.split(".")[0];
        decPart = "";
      }
      if (useThousands) {
        let formatted = "";
        for (let i = intPart.length - 1, count = 0; i >= 0; i--, count++) {
          if (count > 0 && count % 3 === 0) formatted = "," + formatted;
          formatted = intPart.charAt(i) + formatted;
        }
        intPart = formatted;
      }
      let result = (isNeg ? "-" : "") + prefix + intPart;
      if (decimalPlaces > 0) result += "." + decPart;
      return result + suffix;
    };
    alasql.fn.TIME_FORMAT = function(value, formatStr) {
      if (value === null || value === void 0 || value === "") return "";
      const parts = dateValueToParts(value);
      if (!parts) return String(value);
      let result = String(formatStr || "");
      if (parts.date) {
        const era = resolveEraFromParts(parts.date);
        const dow = new Date(parts.date.year, parts.date.month - 1, parts.date.day).getDay();
        result = replaceTokens(result, [
          ["dddd", DAY_OF_WEEK_LONG[dow]],
          ["ddd", DAY_OF_WEEK_SHORT[dow]],
          ["gg", era.name],
          ["YYYY", String(parts.date.year)],
          ["YY", ("0" + parts.date.year).slice(-2)],
          ["MM", ("0" + parts.date.month).slice(-2)],
          ["DD", ("0" + parts.date.day).slice(-2)],
          ["ee", ("0" + era.year).slice(-2)],
          ["M", String(parts.date.month)],
          ["D", String(parts.date.day)],
          ["e", String(era.year)]
        ]);
      }
      if (parts.time) {
        result = replaceTokens(result, [
          ["SSS", pad3(parts.time.ms || 0)],
          ["HH", ("0" + parts.time.hour).slice(-2)],
          ["mm", ("0" + parts.time.minute).slice(-2)],
          ["ss", ("0" + parts.time.second).slice(-2)],
          ["H", String(parts.time.hour)],
          ["m", String(parts.time.minute)],
          ["s", String(parts.time.second)]
        ]);
      }
      return result;
    };
    alasql.fn.NOW = function() {
      return nowJstString();
    };
    alasql.fn.NOEXT = function(value) {
      if (value === null || value === void 0 || value === "") return "";
      const parts = String(value).split(", ");
      for (let i = 0; i < parts.length; i++) {
        const trimmed = parts[i].trim();
        const dotIndex = trimmed.lastIndexOf(".");
        parts[i] = dotIndex > 0 ? trimmed.substring(0, dotIndex) : trimmed;
      }
      return parts.join(", ");
    };
    alasql.fn.UNIQUE_CSV = function(value) {
      if (value === null || value === void 0 || value === "") return "";
      const seen = /* @__PURE__ */ new Set();
      const result = [];
      String(value).split(",").forEach(function(item) {
        const t = item.trim();
        if (t === "") return;
        if (!seen.has(t)) {
          seen.add(t);
          result.push(t);
        }
      });
      return result.join(",");
    };
    alasql.fn.STR_LEFT = function(value, n) {
      if (value === null || value === void 0) return null;
      const len = Number(n);
      if (!Number.isFinite(len)) return "";
      return String(value).substring(0, Math.max(0, Math.floor(len)));
    };
    alasql.fn.STR_RIGHT = function(value, n) {
      if (value === null || value === void 0) return null;
      const len = Number(n);
      if (!Number.isFinite(len)) return "";
      const s = String(value);
      if (len <= 0) return "";
      if (len >= s.length) return s;
      return s.substring(s.length - Math.floor(len));
    };
    alasql.fn.STR_DEFAULT = function(value, fallback) {
      if (value === null || value === void 0) return fallback;
      if (typeof value === "string" && value === "") return fallback;
      return value;
    };
    alasql.fn.LPAD = function(value, len, ch) {
      let s = value === null || value === void 0 ? "" : String(value);
      const n = Number(len);
      if (!Number.isFinite(n) || n <= 0) return s;
      const c = ch === void 0 || ch === null || ch === "" ? " " : String(ch).charAt(0);
      while (s.length < n) s = c + s;
      return s;
    };
    alasql.fn.RPAD = function(value, len, ch) {
      let s = value === null || value === void 0 ? "" : String(value);
      const n = Number(len);
      if (!Number.isFinite(n) || n <= 0) return s;
      const c = ch === void 0 || ch === null || ch === "" ? " " : String(ch).charAt(0);
      while (s.length < n) s = s + c;
      return s;
    };
    alasql.fn.REGEXP_MATCH = function(text, pattern, groupIdx) {
      if (text === null || text === void 0) return null;
      const idx = groupIdx === null || groupIdx === void 0 ? 0 : Number(groupIdx);
      try {
        const m = String(text).match(new RegExp(String(pattern)));
        if (!m) return "";
        const v = m[idx];
        return v === null || v === void 0 ? "" : v;
      } catch (_e) {
        return "";
      }
    };
    alasql.fn.REGEXP_REPLACE = function(text, pattern, replacement) {
      if (text === null || text === void 0) return null;
      const repl = replacement === null || replacement === void 0 ? "" : String(replacement);
      try {
        return String(text).replace(new RegExp(String(pattern), "g"), repl);
      } catch (_e) {
        return String(text);
      }
    };
    function fileUrlOf_(item) {
      if (!item || typeof item !== "object") return "";
      return item.driveFileUrl || item.fileUrl || item.url || "";
    }
    function normalizeFileUploadCell(value) {
      const empty = { files: [], folderName: "", folderUrl: "" };
      if (value === null || value === void 0 || value === "") return empty;
      let source = value;
      if (typeof source === "string") {
        const trimmed = source.replace(/^\s+|\s+$/g, "");
        if (!trimmed || trimmed[0] !== "[" && trimmed[0] !== "{") return empty;
        try {
          source = JSON.parse(trimmed);
        } catch (_e) {
          return empty;
        }
      }
      if (Array.isArray(source)) {
        const files = [];
        let folderName = "";
        let folderUrl = "";
        for (let i = 0; i < source.length; i++) {
          const item = source[i];
          if (!item || typeof item !== "object") continue;
          files.push({ name: item.name !== void 0 && item.name !== null ? String(item.name) : "", driveFileUrl: fileUrlOf_(item) });
          if (!folderName && item.folderName) folderName = String(item.folderName);
          if (!folderUrl && item.folderUrl) folderUrl = String(item.folderUrl);
        }
        return { files, folderName, folderUrl };
      }
      if (source && typeof source === "object") {
        const rawFiles = Array.isArray(source.files) ? source.files : [];
        const files = [];
        for (let i = 0; i < rawFiles.length; i++) {
          const item = rawFiles[i];
          if (!item || typeof item !== "object") continue;
          files.push({ name: item.name !== void 0 && item.name !== null ? String(item.name) : "", driveFileUrl: fileUrlOf_(item) });
        }
        return {
          files,
          folderName: source.folderName ? String(source.folderName) : "",
          folderUrl: source.folderUrl ? String(source.folderUrl) : ""
        };
      }
      return empty;
    }
    function joinNonEmpty_(list) {
      const parts = [];
      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        if (v !== null && v !== void 0 && v !== "") parts.push(String(v));
      }
      return parts.join(", ");
    }
    alasql.fn.FILE_NAMES = function(value) {
      return joinNonEmpty_(normalizeFileUploadCell(value).files.map((f) => f.name));
    };
    alasql.fn.FILE_URLS = function(value) {
      return joinNonEmpty_(normalizeFileUploadCell(value).files.map((f) => f.driveFileUrl));
    };
    alasql.fn.FOLDER_NAME = function(value) {
      return normalizeFileUploadCell(value).folderName || "";
    };
    alasql.fn.FOLDER_URL = function(value) {
      return normalizeFileUploadCell(value).folderUrl || "";
    };
    function pickChildObject(value) {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (value[i] && typeof value[i] === "object") return value[i];
        }
        return null;
      }
      return value && typeof value === "object" ? value : null;
    }
    alasql.fn.CHILD_FORM_NAME = function(value) {
      const obj = pickChildObject(value);
      return obj && obj.childFormName ? String(obj.childFormName) : "";
    };
    alasql.fn.CHILD_FORM_ID = function(value) {
      const obj = pickChildObject(value);
      return obj && obj.childFormId ? String(obj.childFormId) : "";
    };
    alasql.fn.CHILD_FORM_URL = function(value) {
      const obj = pickChildObject(value);
      return obj && obj.childFormUrl ? String(obj.childFormUrl) : "";
    };
    alasql.fn.CHILD_FORM_COUNT = function(value) {
      const obj = pickChildObject(value);
      if (!obj) return 0;
      if (Number.isFinite(obj.count)) return obj.count;
      return Array.isArray(obj.records) ? obj.records.length : 0;
    };
    alasql.fn.DATE2ERA = function(value) {
      const p = valueToFullParts(value);
      if (!p || p.year == null) return null;
      return formatEraNonPadded({ year: p.year, month: p.month, day: p.day }, { withTime: false });
    };
    alasql.fn.DATETIME2ERATIME = function(value) {
      const p = valueToFullParts(value);
      if (!p || p.year == null) return null;
      return formatEraNonPadded(
        { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second },
        { withTime: true, timeKanji: true, padTime: true }
      );
    };
    alasql.fn.ERA2DATE = function(text) {
      const p = parseEraFlexible(text);
      if (!p) return null;
      return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`;
    };
    alasql.fn.ERATIME2DATETIME = function(text) {
      const p = parseEraFlexible(text);
      if (!p) return null;
      return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}_${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}.${pad3(p.ms || 0)}`;
    };
    alasql.aggr.STR_MAX = function(value, accumulator, stage) {
      if (stage === 1) return value === null || value === void 0 ? void 0 : value;
      if (stage === 2) {
        if (value === null || value === void 0) return accumulator;
        if (accumulator === null || accumulator === void 0) return value;
        return value > accumulator ? value : accumulator;
      }
      return accumulator === void 0 ? null : accumulator;
    };
    alasql.aggr.STR_MIN = function(value, accumulator, stage) {
      if (stage === 1) return value === null || value === void 0 ? void 0 : value;
      if (stage === 2) {
        if (value === null || value === void 0) return accumulator;
        if (accumulator === null || accumulator === void 0) return value;
        return value < accumulator ? value : accumulator;
      }
      return accumulator === void 0 ? null : accumulator;
    };
    alasql.fn[REGISTERED] = true;
  }

  // builder/src/features/analytics/utils/headerToAlaSqlKey.js
  function headerKeyToAlaSqlKey(key) {
    if (!key) return "";
    const strKey = String(key);
    if (strKey === "No.") return "No_";
    const out = [];
    const parts = splitEscaped(strKey, "/", false);
    for (let i = 0; i < parts.length; i++) {
      const sub = parts[i].split("|");
      for (let j = 0; j < sub.length; j++) out.push(sub[j]);
    }
    return out.join("__");
  }

  // builder/src/features/analytics/utils/sqlLiteralMask.js
  var KIND_SINGLE_QUOTE = "single-quote";
  var KIND_DOUBLE_QUOTE = "double-quote";
  var KIND_BRACKET = "bracket";
  var KIND_BACKTICK = "backtick";
  var KIND_LINE_COMMENT = "line-comment";
  var KIND_BLOCK_COMMENT = "block-comment";
  var SENTINEL = "";
  var PLACEHOLDER_RE = /\u0001(\d+)\u0001/g;
  function findRegionEnd(sql, n, start, kind, opts) {
    switch (kind) {
      case KIND_SINGLE_QUOTE: {
        let j = start + 1;
        while (j < n) {
          const c = sql.charAt(j);
          if (c === "'" && sql.charAt(j + 1) === "'") {
            j += 2;
            continue;
          }
          if (opts.singleQuoteAllowsBackslash && c === "\\" && j + 1 < n) {
            j += 2;
            continue;
          }
          if (c === "'") {
            j++;
            break;
          }
          j++;
        }
        return j;
      }
      case KIND_DOUBLE_QUOTE: {
        let j = start + 1;
        while (j < n) {
          const c = sql.charAt(j);
          if (c === '"' && sql.charAt(j + 1) === '"') {
            j += 2;
            continue;
          }
          if (c === '"') {
            j++;
            break;
          }
          j++;
        }
        return j;
      }
      case KIND_BRACKET: {
        let j = start + 1;
        while (j < n && sql.charAt(j) !== "]") j++;
        if (j < n) j++;
        return j;
      }
      case KIND_BACKTICK: {
        let j = start + 1;
        while (j < n && sql.charAt(j) !== "`") j++;
        if (j < n) j++;
        return j;
      }
      case KIND_LINE_COMMENT: {
        let j = start;
        while (j < n && sql.charAt(j) !== "\n") j++;
        return j;
      }
      case KIND_BLOCK_COMMENT: {
        let j = start + 2;
        while (j < n - 1 && !(sql.charAt(j) === "*" && sql.charAt(j + 1) === "/")) j++;
        return Math.min(j + 2, n);
      }
    }
    return start + 1;
  }
  function scanMaskRegions(sql, opts) {
    const o = opts || {};
    const includeSingleQuote = o.includeSingleQuote !== false;
    const out = [];
    const n = sql.length;
    let i = 0;
    while (i < n) {
      const c = sql.charAt(i);
      let kind = null;
      if (includeSingleQuote && c === "'") kind = KIND_SINGLE_QUOTE;
      else if (o.includeDoubleQuote && c === '"') kind = KIND_DOUBLE_QUOTE;
      else if (o.includeBracket && c === "[") kind = KIND_BRACKET;
      else if (o.includeBacktick && c === "`") kind = KIND_BACKTICK;
      else if (o.includeLineComment && c === "-" && sql.charAt(i + 1) === "-") kind = KIND_LINE_COMMENT;
      else if (o.includeBlockComment && c === "/" && sql.charAt(i + 1) === "*") kind = KIND_BLOCK_COMMENT;
      if (kind) {
        const end = findRegionEnd(sql, n, i, kind, o);
        out.push({ start: i, end, kind });
        i = end;
      } else {
        i++;
      }
    }
    return out;
  }
  function maskWithPlaceholders(sql, opts) {
    const src = sql == null ? "" : String(sql);
    const regions = scanMaskRegions(src, opts || {});
    const placeholders = [];
    let out = "";
    let cursor = 0;
    for (const r of regions) {
      out += src.substring(cursor, r.start);
      out += SENTINEL + placeholders.length + SENTINEL;
      placeholders.push(src.substring(r.start, r.end));
      cursor = r.end;
    }
    out += src.substring(cursor);
    return {
      masked: out,
      placeholders,
      unmask(text) {
        return String(text).replace(PLACEHOLDER_RE, (_m, idx) => placeholders[Number(idx)]);
      }
    };
  }

  // builder/src/features/expression/sqlEmit.js
  var bracketIdent = (name) => "[" + String(name).replace(/]/g, "") + "]";

  // builder/src/features/expression/preprocessAlaSqlExpression.js
  var RESERVED_FN_REWRITES = [
    [/\bLEFT\s*\(/gi, "STR_LEFT("],
    [/\bRIGHT\s*\(/gi, "STR_RIGHT("],
    [/\bDEFAULT\s*\(/gi, "STR_DEFAULT("]
  ];
  function preprocessAlaSqlExpression(expr) {
    if (!expr || typeof expr !== "string") return expr || "";
    const { masked, unmask } = maskWithPlaceholders(expr, { includeDoubleQuote: true });
    let rewritten = masked.replace(/`([^`]+)`/g, (_m, name) => {
      return "`" + headerKeyToAlaSqlKey(name) + "`";
    });
    rewritten = rewritten.replace(/\[([^\]]+)\]/g, (_m, name) => {
      return bracketIdent(headerKeyToAlaSqlKey(name));
    });
    for (const [re, repl] of RESERVED_FN_REWRITES) {
      rewritten = rewritten.replace(re, repl);
    }
    return unmask(rewritten);
  }

  // builder/src/features/expression/templateScanner.js
  var FULL_QUERY_RE = /^\s*SELECT\b/i;
  function isFullQueryBody(body) {
    return FULL_QUERY_RE.test(String(body == null ? "" : body));
  }
  function findBalancedCloseIndex(text, openIndex) {
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
      end: close + 1
    };
  }
  function scanAndReplace(text, replacer) {
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
        out += ch;
        i++;
        continue;
      }
      out += replacer(tok);
      i = tok.end;
    }
    return out;
  }
  function collectBalancedBraces(text) {
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
  function splitTopLevelCommas(body) {
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
  var ESCAPE_OPEN = "NFB_LBRACE";
  var ESCAPE_CLOSE = "NFB_RBRACE";
  function escapeBraces(text) {
    if (!text) return "";
    return String(text).split("\\{").join(ESCAPE_OPEN).split("\\}").join(ESCAPE_CLOSE);
  }
  function unescapeBraces(text) {
    if (!text) return "";
    return String(text).split(ESCAPE_OPEN).join("{").split(ESCAPE_CLOSE).join("}");
  }

  // builder/src/features/expression/coerceResultToString.js
  function coerceResultToString(value) {
    if (value === null || value === void 0) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return "";
      return String(value);
    }
    if (typeof value === "boolean") return value ? "true" : "false";
    if (Object.prototype.toString.call(value) === "[object Date]") {
      const t = value.getTime();
      return Number.isFinite(t) ? String(t) : "";
    }
    if (Array.isArray(value)) {
      return value.map((v) => coerceResultToString(v)).join(", ");
    }
    if (typeof value === "object") {
      if (typeof value.name === "string") return value.name;
      try {
        return JSON.stringify(value);
      } catch (_e) {
        return "";
      }
    }
    return String(value);
  }

  // builder/src/core/ids.js
  var ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  var ULID_RANDOM_LENGTH = 16;
  var lastUlidTimeMs = -1;
  var lastUlidRandomPart = "";
  var createRandomBytes = (length) => {
    var _a;
    const bytes = new Uint8Array(length);
    if ((_a = globalThis == null ? void 0 : globalThis.crypto) == null ? void 0 : _a.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
      return bytes;
    }
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
  };
  var encodeUlidTime = (unixMs) => {
    let value = Math.floor(Number(unixMs));
    if (!Number.isFinite(value) || value < 0) value = 0;
    let encoded = "";
    for (let i = 0; i < 10; i += 1) {
      encoded = ULID_ALPHABET[value % 32] + encoded;
      value = Math.floor(value / 32);
    }
    return encoded;
  };
  var encodeUlidRandom = (bytes) => {
    let encoded = "";
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < bytes.length; i += 1) {
      buffer = buffer << 8 | bytes[i];
      bits += 8;
      while (bits >= 5) {
        encoded += ULID_ALPHABET[buffer >> bits - 5 & 31];
        bits -= 5;
        if (bits === 0) {
          buffer = 0;
        } else {
          buffer &= (1 << bits) - 1;
        }
      }
    }
    if (bits > 0) {
      encoded += ULID_ALPHABET[buffer << 5 - bits & 31];
    }
    return encoded;
  };
  var createUlidRandomPart = () => encodeUlidRandom(createRandomBytes(10)).slice(0, ULID_RANDOM_LENGTH);
  var incrementBase32 = (value) => {
    const chars = String(value || "").padEnd(ULID_RANDOM_LENGTH, ULID_ALPHABET[0]).slice(0, ULID_RANDOM_LENGTH).split("");
    for (let i = chars.length - 1; i >= 0; i -= 1) {
      const currentIndex = ULID_ALPHABET.indexOf(chars[i]);
      const safeIndex = currentIndex >= 0 ? currentIndex : 0;
      if (safeIndex < ULID_ALPHABET.length - 1) {
        chars[i] = ULID_ALPHABET[safeIndex + 1];
        for (let j = i + 1; j < chars.length; j += 1) chars[j] = ULID_ALPHABET[0];
        return { value: chars.join(""), overflow: false };
      }
      chars[i] = ULID_ALPHABET[0];
    }
    return { value: chars.join(""), overflow: true };
  };
  var createUlid = () => {
    let nowMs = Math.floor(Number(Date.now()));
    if (!Number.isFinite(nowMs) || nowMs < 0) nowMs = 0;
    if (lastUlidTimeMs < 0 || nowMs > lastUlidTimeMs) {
      lastUlidTimeMs = nowMs;
      lastUlidRandomPart = createUlidRandomPart();
      return `${encodeUlidTime(lastUlidTimeMs)}${lastUlidRandomPart}`;
    }
    if (!lastUlidRandomPart || lastUlidRandomPart.length !== ULID_RANDOM_LENGTH) {
      lastUlidRandomPart = createUlidRandomPart();
    }
    const next = incrementBase32(lastUlidRandomPart);
    if (next.overflow) {
      lastUlidTimeMs += 1;
      lastUlidRandomPart = createUlidRandomPart();
    } else {
      lastUlidRandomPart = next.value;
    }
    return `${encodeUlidTime(lastUlidTimeMs)}${lastUlidRandomPart}`;
  };

  // builder/src/utils/arrays.js
  var ensureArray = (value) => Array.isArray(value) ? value : [];

  // builder/src/core/fieldValue.js
  var fieldHasValue = (field, value) => {
    if (!field || typeof field !== "object") return false;
    const type = field.type;
    if (type === "text" || type === "email" || type === "url") {
      return typeof value === "string" && value.replace(/^\s+|\s+$/g, "") !== "";
    }
    if (type === "phone") {
      if (typeof value !== "string") return false;
      return value.replace(/[\s\-()]/g, "") !== "";
    }
    if (type === "number") {
      if (value === "" || value === null || value === void 0) return false;
      return !isNaN(Number(value));
    }
    if (type === "date" || type === "time") {
      return typeof value === "string" && value !== "";
    }
    if (type === "fileUpload") {
      return Array.isArray(value) && value.length > 0;
    }
    return false;
  };
  var shouldShowUnconditionalChildren = (field, value) => field && field.type === "message" || fieldHasValue(field, value);

  // builder/src/core/schemaUtils.js
  var resolveOrderedChildKeys = (field) => {
    const branches = field && field.childrenByValue;
    if (!branches || typeof branches !== "object" || Array.isArray(branches)) return [];
    const keys = [];
    for (const k in branches) {
      if (Object.prototype.hasOwnProperty.call(branches, k)) keys.push(k);
    }
    if (!keys.length) return [];
    const ordered = [];
    const seen = {};
    const options = field && Array.isArray(field.options) ? field.options : [];
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const label = opt && typeof opt.label === "string" ? opt.label : "";
      if (!label || seen[label] || !Object.prototype.hasOwnProperty.call(branches, label)) continue;
      ordered.push(label);
      seen[label] = true;
    }
    for (let j = 0; j < keys.length; j++) {
      if (seen[keys[j]]) continue;
      ordered.push(keys[j]);
      seen[keys[j]] = true;
    }
    return ordered;
  };
  var defaultFieldSegment = (field, indexTrail) => {
    const rawLabel = field && field.label !== void 0 && field.label !== null ? String(field.label) : "";
    const trimmed = rawLabel.replace(/^\s+|\s+$/g, "");
    if (trimmed) return trimmed;
    const type = field && field.type !== void 0 && field.type !== null ? String(field.type) : "unknown";
    return "\u8CEA\u554F " + indexTrail.join(".") + " (" + type + ")";
  };
  var traverseSchema = (schema, visitor, options = {}) => {
    const opts = options || {};
    const hasGetChildKeys = typeof opts.getChildKeys === "function";
    const hasResponses = !!opts.responses;
    const fieldSegmentFn = typeof opts.fieldSegment === "function" ? opts.fieldSegment : null;
    const branchSegmentFn = typeof opts.branchSegment === "function" ? opts.branchSegment : null;
    const walk = (nodes, pathSegments, depth, indexTrail) => {
      const list = ensureArray(nodes);
      for (let i = 0; i < list.length; i++) {
        const field = list[i];
        if (field === void 0 || field === null) continue;
        const currentIndexTrail = indexTrail.concat(i + 1);
        const segmentCtx = {
          pathSegments,
          index: i,
          depth,
          indexTrail: currentIndexTrail
        };
        const segment = fieldSegmentFn ? fieldSegmentFn(field, segmentCtx) : defaultFieldSegment(field, currentIndexTrail);
        if (segment === null || segment === void 0) continue;
        const currentPath = pathSegments.concat(segment);
        const context = {
          pathSegments: currentPath,
          index: i,
          depth,
          indexTrail: currentIndexTrail
        };
        const shouldContinue = visitor(field, context);
        if (shouldContinue === false) continue;
        if (field.childrenByValue && typeof field.childrenByValue === "object" && !Array.isArray(field.childrenByValue)) {
          let childKeys;
          if (hasGetChildKeys) {
            const custom = opts.getChildKeys(field, context);
            childKeys = ensureArray(custom);
          } else if (hasResponses) {
            const value = opts.responses[field.id];
            if (field.type === "checkboxes" && Array.isArray(value)) {
              const selected = {};
              for (let s = 0; s < value.length; s++) selected[value[s]] = true;
              const all = resolveOrderedChildKeys(field);
              childKeys = [];
              for (let a = 0; a < all.length; a++) {
                if (selected[all[a]]) childKeys.push(all[a]);
              }
            } else if ((field.type === "radio" || field.type === "select") && typeof value === "string" && value) {
              childKeys = field.childrenByValue[value] ? [value] : [];
            } else {
              childKeys = [];
            }
          } else {
            childKeys = resolveOrderedChildKeys(field);
          }
          for (let ci = 0; ci < childKeys.length; ci++) {
            const key = childKeys[ci];
            const branchSegment = branchSegmentFn ? branchSegmentFn(key, field, context) : key;
            const childPath = branchSegment === null || branchSegment === void 0 ? currentPath : currentPath.concat(branchSegment);
            walk(field.childrenByValue[key], childPath, depth + 1, currentIndexTrail);
          }
        }
        if (Array.isArray(field.children) && field.children.length > 0) {
          let traverseChildren = true;
          if (hasResponses) {
            const inputValue = opts.responses[field.id];
            traverseChildren = shouldShowUnconditionalChildren(field, inputValue);
          }
          if (traverseChildren) {
            walk(field.children, currentPath, depth + 1, currentIndexTrail);
          }
        }
      }
    };
    walk(ensureArray(schema), [], 1, []);
  };
  var mapSchema = (schema, mapper) => {
    const walk = (nodes, pathSegments, depth) => {
      const list = ensureArray(nodes);
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const field = list[i];
        const rawLabel = field && field.label !== void 0 && field.label !== null ? String(field.label) : "";
        const trimmed = rawLabel.replace(/^\s+|\s+$/g, "");
        const currentPath = pathSegments.concat(trimmed);
        const context = { pathSegments: currentPath, index: i, depth };
        const newField = mapper(field, context);
        if (newField && newField.childrenByValue && typeof newField.childrenByValue === "object" && !Array.isArray(newField.childrenByValue)) {
          const newChildren = {};
          const orderedKeys = resolveOrderedChildKeys(newField);
          for (let k = 0; k < orderedKeys.length; k++) {
            const optLabel = orderedKeys[k];
            newChildren[optLabel] = walk(
              newField.childrenByValue[optLabel],
              currentPath.concat(optLabel),
              depth + 1
            );
          }
          newField.childrenByValue = newChildren;
        }
        if (newField && Array.isArray(newField.children)) {
          newField.children = walk(newField.children, currentPath, depth + 1);
        }
        out.push(newField);
      }
      return out;
    };
    return walk(ensureArray(schema), [], 1);
  };
  return __toCommonJS(gasRuntimeEntry_exports);
})();

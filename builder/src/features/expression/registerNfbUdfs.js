/**
 * alasql に prefix-less UDF（スカラー関数 `alasql.fn.*` と集計関数 `alasql.aggr.*`）を
 * 登録する単一エントリポイント。
 *
 * 旧 NFB_* 名は Plan P5 で完全削除済。すべての UDF は idempotent 実装で
 * 同じ alasql インスタンスに対して重複登録しても副作用なし。
 *
 * --- UDF 追加ガイド (優先順位) ---
 *   ① alasql ネイティブ関数を最優先 (UPPER/LOWER/IFNULL/COALESCE/LPAD/RPAD/
 *      CAST 等は再定義しない)。
 *      ※ YEAR/MONTH/DAY/HOUR/MINUTE/SECOND は canonical 文字列 / msunixtime /
 *        TIME-only を受けるため本ファイルで override する（下記「日付の値表現」参照）。
 *   ② JS 標準関数で済むものは alasql.fn に薄ラッパーで登録。
 *   ③ 上記で表現できない独自セマンティクスのみ JS 実装を alasql.fn に登録。
 *      数字が小さい方が優先で、③ は最終手段。
 *
 * --- 日付の値表現（canonical 文字列） ---
 *   DATE/DATETIME/TIME 型は「ゼロパディング済み canonical 文字列」として扱う:
 *     DATE     → "YYYY/MM/DD"
 *     DATETIME → "YYYY/MM/DD HH:mm:ss.SSS"   (日付はスラッシュ、日付↔時刻は半角スペース。ms までゼロ埋め。createdAt / modifiedAt / deletedAt 専用型)
 *     TIME     → "HH:mm:ss.SSS"               (00:00:00 から超過した時間。ms までゼロ埋め)
 *   これらは辞書順 = 時系列順なので alasql の `=` `<` `>` がそのまま機能する
 *   （Date オブジェクトの参照比較問題を避けるための旧 unix ms 統一は不要になった）。
 *   - DATE(v) / DATETIME(v) / TIME(v): 引数は文字列か数値（msunixtime）。文字列は
 *     その型に整形（不足成分を 0 埋め、不要成分を切り落とし）、数値はその瞬間の
 *     JST 壁時計を整形。空 / 不正は NULL。
 *   - TIMESTAMP(v): 文字列 → msunixtime。TIME-only 文字列（"00:01:00" 等）は
 *     ms since midnight（→ 60000）。
 *   - DATE2ERA / DATETIME2ERATIME: ゼロパディングなし和暦文字列（令和1年 → 令和元年）。
 *     DATETIME2ERATIME は引数に時刻が無くても「時/分/秒」を常に表示。
 *   - ERA2DATE / ERATIME2DATETIME: 和暦文字列 → canonical 文字列（DATE2ERA /
 *     DATETIME2ERATIME の逆）。
 *   - YEAR/MONTH/DAY/HOUR/MINUTE/SECOND: 数値。SECOND のみ小数あり得る（msunixtime の
 *     ミリ秒成分を反映）。
 *   日時値の canonical 化・パーツ抽出は utils/dateTime.js（formatCanonical /
 *   toMsUnixTime / extractJstPartsFull / parseTimeStringToMsSinceMidnight）を共有する。
 *   GAS 側の双子は gas/expressionFunctions.gs（nfbDt_* / EXPR_FUNCTIONS_）。
 *
 * 大きな定数テーブル / 純関数群は別モジュールに切り出している:
 * - kanaTables.js: 半角⇔全角カナのマッピング（ZEN/HAN UDF 用）
 * - eraConversion.js: 元号テーブル + resolveEraFromParts（TIME_FORMAT 用）/
 *   formatEraNonPadded（DATE2ERA / DATETIME2ERATIME 用）/ parseEraFlexible
 *   （ERA2DATE / ERATIME2DATETIME 用）
 */

import {
  HALF_TO_FULL_KANA,
  DAKUTEN_MAP,
  HANDAKUTEN_MAP,
  FULL_TO_HALF_KANA,
  DAKUTEN_TO_HALF,
  HANDAKUTEN_TO_HALF,
} from "./kanaTables.js";
import { resolveEraFromParts, formatEraNonPadded, parseEraFlexible } from "./eraConversion.js";
import {
  toMsUnixTime,
  formatCanonical,
  extractJstPartsFull,
  parseTimeStringToMsSinceMidnight,
  nowJstString,
  pad2,
  pad3,
  pad4,
} from "../../utils/dateTime.js";
import { MS_PER_DAY, UNIX_MS_THRESHOLD } from "../../core/constants.js";

const DAY_OF_WEEK_SHORT = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_OF_WEEK_LONG = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
const TIME_ONLY_STR_RE = /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?$/;

// 任意の日時値 → { year, month, day, hour, minute, second, ms }（数値、非パディング）。
// TIME-only 文字列は { year: null, month: null, day: null, hour, minute, second, ms } を返す
// （暦日成分を持たない）。不正値は null。
function valueToFullParts(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const s = value.trim();
    if (TIME_ONLY_STR_RE.test(s)) {
      const msMid = parseTimeStringToMsSinceMidnight(s);
      if (msMid === null) return null;
      const total = ((msMid % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
      return {
        year: null,
        month: null,
        day: null,
        hour: Math.floor(total / 3600000),
        minute: Math.floor((total % 3600000) / 60000),
        second: Math.floor((total % 60000) / 1000),
        ms: msMid % 1000,
      };
    }
  }
  return extractJstPartsFull(value);
}

// TIME_FORMAT 用: 文字列は壁時計成分を直接パース（TZ 非依存）、数値/Date は瞬間として
// JST 壁時計に変換。{ date: {year,month,day}|null, time: {hour,minute,second}|null } を返す。
function dateValueToParts(value) {
  if (value === null || value === undefined || value === "") return null;
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
    // ISO 8601 で TZ 指定子（Z / ±HH:MM）付き → その時差を考慮して JST 壁時計成分に正規化
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
      time: { hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(), ms: d.getMilliseconds() },
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

const REGISTERED = "__nfb_udfs_registered__";

export function ensureNfbUdfsRegistered(alasql) {
  if (!alasql) return;
  alasql.fn = alasql.fn || {};
  alasql.aggr = alasql.aggr || {};
  if (alasql.fn[REGISTERED]) return;

  // ---------------------------------------------------------------------------
  // TO_BOOL — 真偽判定。空 / "false" / "0" / 0 / null は false、それ以外は true。
  //   pipeEngine の toBooleanLike 互換挙動。
  // ---------------------------------------------------------------------------
  alasql.fn.TO_BOOL = function (value) {
    if (value === null || value === undefined) return false;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
    const s = String(value).trim().toLowerCase();
    if (s === "" || s === "0" || s === "false" || s === "no" || s === "off") return false;
    return true;
  };

  // ---------------------------------------------------------------------------
  // TO_NUMBER — 数値化。失敗時 NULL を返す（alasql の比較では NULL 同士の比較が
  // false になるので、フィルタが暗黙にスキップされる）。
  // ---------------------------------------------------------------------------
  alasql.fn.TO_NUMBER = function (value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const n = Number(String(value).trim());
    return Number.isFinite(n) ? n : null;
  };

  // ---------------------------------------------------------------------------
  // DATE / DATETIME / TIME — canonical 文字列を返す。
  //   DATE     → "YYYY/MM/DD"
  //   DATETIME → "YYYY/MM/DD HH:mm:ss.SSS"（日付はスラッシュ、日付↔時刻は半角スペース。ms までゼロ埋め。
  //              createdAt / modifiedAt / deletedAt 専用型だが関数としては誰でも呼べる）
  //   TIME = TIMEMS → "HH:mm:ss.SSS"（00:00:00 から超過した時間。ms までゼロ埋め。
  //              datetime を渡すと時刻成分のみ）
  //   TIMES    → "HH:mm:ss"（秒まで）
  //   TIMEM    → "HH:mm"（分まで）
  //   引数は文字列か数値（msunixtime）。空 / 不正は NULL。整形ロジックは
  //   utils/dateTime.js の formatCanonical に集約。各関数は合成可能
  //   （TIME(TIMEM(T)) → "HH:mm:00.000"、DATETIME(TIMEM(T)) → "1970/01/01 HH:mm:00.000"）。
  // TIMESTAMP — 文字列（DATE/DATETIME/TIME 関数が受ける形式）→ msunixtime。
  //   TIME-only 文字列（"00:01:00"）は ms since midnight（→ 60000）。
  // ---------------------------------------------------------------------------
  alasql.fn.DATE = function (value) {
    return formatCanonical(value, "date");
  };
  alasql.fn.DATETIME = function (value) {
    return formatCanonical(value, "datetime");
  };
  alasql.fn.TIME = function (value) {
    return formatCanonical(value, "time");
  };
  alasql.fn.TIMEMS = function (value) {
    return formatCanonical(value, "time");
  };
  alasql.fn.TIMES = function (value) {
    return formatCanonical(value, "times");
  };
  alasql.fn.TIMEM = function (value) {
    return formatCanonical(value, "timem");
  };
  alasql.fn.TIMESTAMP = function (value) {
    const ms = toMsUnixTime(value);
    return Number.isFinite(ms) ? ms : null;
  };

  // ---------------------------------------------------------------------------
  // YEAR / MONTH / DAY / HOUR / MINUTE / SECOND — alasql ネイティブ override。
  //   canonical 文字列 / msunixtime / ゆる日時文字列 / TIME-only 文字列を受け、数値を返す。
  //   TIME-only 文字列に対する YEAR/MONTH/DAY は NULL（暦日成分なし）。
  //   SECOND のみ小数あり得る（msunixtime のミリ秒成分を反映）。空 / 不正は NULL。
  // ---------------------------------------------------------------------------
  alasql.fn.YEAR = function (value) {
    const p = valueToFullParts(value);
    return p && p.year != null ? p.year : null;
  };
  alasql.fn.MONTH = function (value) {
    const p = valueToFullParts(value);
    return p && p.month != null ? p.month : null;
  };
  alasql.fn.DAY = function (value) {
    const p = valueToFullParts(value);
    return p && p.day != null ? p.day : null;
  };
  alasql.fn.HOUR = function (value) {
    const p = valueToFullParts(value);
    return p && p.hour != null ? p.hour : null;
  };
  alasql.fn.MINUTE = function (value) {
    const p = valueToFullParts(value);
    return p && p.minute != null ? p.minute : null;
  };
  alasql.fn.SECOND = function (value) {
    const p = valueToFullParts(value);
    if (!p || p.second == null) return null;
    return p.ms ? p.second + p.ms / 1000 : p.second;
  };

  // ---------------------------------------------------------------------------
  // LIKE_ANY — 全列横断 LIKE。
  //   検索バー裸単語（比較演算子なしのキーワード）の評価で使う。
  //   needle と各 col を文字列化して大小無視で部分一致判定。
  //   needle が "*" を含めば LIKE 互換のワイルドカード扱い。
  // ---------------------------------------------------------------------------
  alasql.fn.LIKE_ANY = function (needle, ...cols) {
    if (needle === null || needle === undefined) return false;
    const nLower = String(needle).toLowerCase();
    if (!nLower) return true; // 空文字は常にヒット扱い（フィルタ無効）
    // 列値を「マッチ可能な文字列の配列」に正規化する。
    // 数値が unix ms 風（|n| >= UNIX_MS_THRESHOLD ≒ 1973-03-03）の場合は ISO 文字列も候補に加える。
    function valueToStrings(v) {
      if (v === null || v === undefined) return [];
      if (typeof v === "number") {
        if (!Number.isFinite(v)) return [];
        const out = [String(v)];
        if (Math.abs(v) >= UNIX_MS_THRESHOLD) {
          try { out.push(new Date(v).toISOString()); } catch (_e) { /* ignore */ }
        }
        return out;
      }
      if (v instanceof Date) {
        try { return [v.toISOString()]; } catch (_e) { return [String(v)]; }
      }
      if (Array.isArray(v)) {
        const parts = [];
        for (const x of v) { for (const s of valueToStrings(x)) parts.push(s); }
        return parts;
      }
      if (typeof v === "object") {
        if (v.name) return [String(v.name)];
        try { return [JSON.stringify(v)]; } catch (_e) { return [String(v)]; }
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

  // ---------------------------------------------------------------------------
  // KANA — ひらがな → カタカナ。pipeEngine の nfbTransformKana_ 移植。
  // ---------------------------------------------------------------------------
  alasql.fn.KANA = function (value) {
    if (value === null || value === undefined) return "";
    const s = String(value);
    let result = "";
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code >= 0x3041 && code <= 0x3096) {
        result += String.fromCharCode(code + 0x60);
      } else {
        result += s.charAt(i);
      }
    }
    return result;
  };

  // ---------------------------------------------------------------------------
  // ZEN — 半角 → 全角。
  // ---------------------------------------------------------------------------
  alasql.fn.ZEN = function (value) {
    if (value === null || value === undefined) return "";
    const s = String(value);
    let result = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      const code = s.charCodeAt(i);
      if (code >= 0x21 && code <= 0x7E) { result += String.fromCharCode(code + 0xFEE0); continue; }
      if (code === 0x20) { result += "　"; continue; }
      const mapped = HALF_TO_FULL_KANA[ch];
      if (mapped) {
        const next = i + 1 < s.length ? s.charAt(i + 1) : "";
        if (next === "ﾞ" && DAKUTEN_MAP[mapped]) { result += DAKUTEN_MAP[mapped]; i++; }
        else if (next === "ﾟ" && HANDAKUTEN_MAP[mapped]) { result += HANDAKUTEN_MAP[mapped]; i++; }
        else { result += mapped; }
        continue;
      }
      result += ch;
    }
    return result;
  };

  // ---------------------------------------------------------------------------
  // HAN — 全角 → 半角。
  // ---------------------------------------------------------------------------
  alasql.fn.HAN = function (value) {
    if (value === null || value === undefined) return "";
    const s = String(value);
    let result = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      const code = s.charCodeAt(i);
      if (code >= 0xFF01 && code <= 0xFF5E) { result += String.fromCharCode(code - 0xFEE0); continue; }
      if (code === 0x3000) { result += " "; continue; }
      if (DAKUTEN_TO_HALF[ch]) { result += DAKUTEN_TO_HALF[ch]; continue; }
      if (HANDAKUTEN_TO_HALF[ch]) { result += HANDAKUTEN_TO_HALF[ch]; continue; }
      if (FULL_TO_HALF_KANA[ch]) { result += FULL_TO_HALF_KANA[ch]; continue; }
      result += ch;
    }
    return result;
  };

  // ---------------------------------------------------------------------------
  // NUMBER_FORMAT — 数値整形。pipeEngine の nfbTransformNumber_ 移植。
  //   形式: prefix [#0,.]+ suffix （例: "#,##0.00円" / "$#,##0"）
  // ---------------------------------------------------------------------------
  alasql.fn.NUMBER_FORMAT = function (value, formatStr) {
    if (value === null || value === undefined || value === "") return "";
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
      intPart = parts[0]; decPart = parts[1];
    } else {
      intPart = fixed.split(".")[0]; decPart = "";
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

  // ---------------------------------------------------------------------------
  // TIME_FORMAT — 日時整形（和暦/曜日対応）。pipeEngine の nfbTransformTime_ 移植。
  //   v は msunixtime / Date / canonical or ゆる日時文字列 / TIME-only 文字列。
  //   元号テーブル / resolveEra は eraConversion.js 経由で共有。
  // ---------------------------------------------------------------------------
  alasql.fn.TIME_FORMAT = function (value, formatStr) {
    if (value === null || value === undefined || value === "") return "";
    const parts = dateValueToParts(value);
    if (!parts) return String(value);
    let result = String(formatStr || "");
    if (parts.date) {
      const era = resolveEraFromParts(parts.date);
      const dow = new Date(parts.date.year, parts.date.month - 1, parts.date.day).getDay();
      result = replaceTokens(result, [
        ["dddd", DAY_OF_WEEK_LONG[dow]],
        ["ddd",  DAY_OF_WEEK_SHORT[dow]],
        ["gg",   era.name],
        ["YYYY", String(parts.date.year)],
        ["YY",   ("0" + parts.date.year).slice(-2)],
        ["MM",   ("0" + parts.date.month).slice(-2)],
        ["DD",   ("0" + parts.date.day).slice(-2)],
        ["ee",   ("0" + era.year).slice(-2)],
        ["M",    String(parts.date.month)],
        ["D",    String(parts.date.day)],
        ["e",    String(era.year)],
      ]);
    }
    if (parts.time) {
      result = replaceTokens(result, [
        ["SSS", pad3(parts.time.ms || 0)],
        ["HH", ("0" + parts.time.hour).slice(-2)],
        ["mm", ("0" + parts.time.minute).slice(-2)],
        ["ss", ("0" + parts.time.second).slice(-2)],
        ["H",  String(parts.time.hour)],
        ["m",  String(parts.time.minute)],
        ["s",  String(parts.time.second)],
      ]);
    }
    return result;
  };

  // ---------------------------------------------------------------------------
  // NOW() — 現在時刻を DATETIME canonical 文字列で返す。
  //   "YYYY/MM/DD HH:mm:ss.SSS"（JST 壁時計時刻、ms までゼロ埋め）。
  //   テンプレート / Question SQL / 検索 SQL のどこでも同じ意味で使える。
  //   YEAR(NOW()) / TIME_FORMAT(NOW(), 'YYYY-MM-DD') / DATE(NOW()) などで加工。
  //   alasql 4.x 組み込みの NOW()（JS Date を返す）を override する。
  // ---------------------------------------------------------------------------
  alasql.fn.NOW = function () {
    return nowJstString();
  };

  // ---------------------------------------------------------------------------
  // NOEXT — ファイル名から拡張子を除去（", " 区切りの複数対応）。
  // ---------------------------------------------------------------------------
  alasql.fn.NOEXT = function (value) {
    if (value === null || value === undefined || value === "") return "";
    const parts = String(value).split(", ");
    for (let i = 0; i < parts.length; i++) {
      const trimmed = parts[i].trim();
      const dotIndex = trimmed.lastIndexOf(".");
      parts[i] = dotIndex > 0 ? trimmed.substring(0, dotIndex) : trimmed;
    }
    return parts.join(", ");
  };

  // ---------------------------------------------------------------------------
  // STR_LEFT / STR_RIGHT / STR_DEFAULT — alasql の予約語（LEFT / RIGHT JOIN・
  //   DEFAULT VALUES）と衝突するため、式中の `LEFT(...)` / `RIGHT(...)` / `DEFAULT(...)`
  //   は preprocessAlaSqlExpression がこれらの名前にリネームしてから alasql に渡す。
  //   - STR_LEFT(v, n)    : 先頭 n 文字
  //   - STR_RIGHT(v, n)   : 末尾 n 文字
  //   - STR_DEFAULT(v, f) : 空値（null / undefined / 空文字）なら f、それ以外は v
  // ---------------------------------------------------------------------------
  alasql.fn.STR_LEFT = function (value, n) {
    if (value === null || value === undefined) return null;
    const len = Number(n);
    if (!Number.isFinite(len)) return "";
    return String(value).substring(0, Math.max(0, Math.floor(len)));
  };
  alasql.fn.STR_RIGHT = function (value, n) {
    if (value === null || value === undefined) return null;
    const len = Number(n);
    if (!Number.isFinite(len)) return "";
    const s = String(value);
    if (len <= 0) return "";
    if (len >= s.length) return s;
    return s.substring(s.length - Math.floor(len));
  };
  alasql.fn.STR_DEFAULT = function (value, fallback) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "string" && value === "") return fallback;
    return value;
  };

  // ---------------------------------------------------------------------------
  // LPAD / RPAD — 左/右ゼロ埋め等。alasql 4.x 本体には未収録なので UDF として登録。
  //   旧 PAD_LEFT / PAD_RIGHT は gas/adminMigrations.gs の rename テーブルで LPAD / RPAD に
  //   自動移行される。パディング文字は第 3 引数（省略時は半角スペース）。
  // ---------------------------------------------------------------------------
  alasql.fn.LPAD = function (value, len, ch) {
    let s = value === null || value === undefined ? "" : String(value);
    const n = Number(len);
    if (!Number.isFinite(n) || n <= 0) return s;
    const c = ch === undefined || ch === null || ch === "" ? " " : String(ch).charAt(0);
    while (s.length < n) s = c + s;
    return s;
  };
  alasql.fn.RPAD = function (value, len, ch) {
    let s = value === null || value === undefined ? "" : String(value);
    const n = Number(len);
    if (!Number.isFinite(n) || n <= 0) return s;
    const c = ch === undefined || ch === null || ch === "" ? " " : String(ch).charAt(0);
    while (s.length < n) s = s + c;
    return s;
  };

  // ---------------------------------------------------------------------------
  // REGEXP_MATCH(text, pattern, groupIdx=0) — JS 標準 String.prototype.match の薄ラッパー。
  //   - groupIdx 省略時は 0（マッチ全体）。括弧の有無による自動分岐はしない。
  //   - 非マッチ / グループ未定義は "" を返す。
  //   - text が null / undefined のときは null（NULL 伝搬）。
  //   - 不正パターンは "" を返す（例外を投げない）。
  // 部分置換は REGEXP_REPLACE(text, '(prefix)(\\d+)(suffix)', '$1NEW$3') の形で
  // $1 バックリファレンスを使う（JS 標準と同じ）。
  // 判定（boolean）は alasql ネイティブ `x REGEXP p` 演算子か REGEXP_LIKE(x, p[, flags]) を使う。
  // ---------------------------------------------------------------------------
  alasql.fn.REGEXP_MATCH = function (text, pattern, groupIdx) {
    if (text === null || text === undefined) return null;
    const idx = (groupIdx === null || groupIdx === undefined) ? 0 : Number(groupIdx);
    try {
      const m = String(text).match(new RegExp(String(pattern)));
      if (!m) return "";
      const v = m[idx];
      return (v === null || v === undefined) ? "" : v;
    } catch (_e) {
      return "";
    }
  };

  // ---------------------------------------------------------------------------
  // REGEXP_REPLACE(text, pattern, replacement) — JS 標準 String.prototype.replace + 'g' フラグ。
  //   - JS 標準の特殊シーケンス（$&, $1〜$9, $<name>, $`, $', $$）がそのまま使える。
  //   - text が null / undefined のときは null（NULL 伝搬）。
  //   - replacement が null / undefined のときは "" として扱う。
  //   - 不正パターンは元 text をそのまま返す。
  // ---------------------------------------------------------------------------
  alasql.fn.REGEXP_REPLACE = function (text, pattern, replacement) {
    if (text === null || text === undefined) return null;
    const repl = (replacement === null || replacement === undefined) ? "" : String(replacement);
    try {
      return String(text).replace(new RegExp(String(pattern), "g"), repl);
    } catch (_e) {
      return String(text);
    }
  };

  // ---------------------------------------------------------------------------
  // FILE_NAMES / FILE_URLS / FOLDER_NAME / FOLDER_URL
  //   fileUpload フィールドの値（[{ name, driveFileUrl, folderName, folderUrl }, ...]）
  //   を読む UDF。値が文字列のときは「カンマ区切りファイル名」とみなして passthrough。
  // ---------------------------------------------------------------------------
  function pickFromList(value, picker) {
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) {
      const parts = [];
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (!item) continue;
        const v = picker(item);
        if (v !== null && v !== undefined && v !== "") parts.push(String(v));
      }
      return parts.join(", ");
    }
    if (typeof value === "object") {
      const v = picker(value);
      return v === null || v === undefined ? "" : String(v);
    }
    return picker.useStringFallback ? String(value) : "";
  }
  const pickName = (item) => (item.name !== undefined ? item.name : "");
  pickName.useStringFallback = true;
  const pickFileUrl = (item) => item.driveFileUrl || item.fileUrl || item.url || "";

  alasql.fn.FILE_NAMES = function (value) {
    return pickFromList(value, pickName);
  };
  alasql.fn.FILE_URLS = function (value) {
    return pickFromList(value, pickFileUrl);
  };
  alasql.fn.FOLDER_NAME = function (value) {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const v = value[i] && value[i].folderName;
        if (v) return String(v);
      }
      return "";
    }
    if (value && typeof value === "object" && value.folderName) return String(value.folderName);
    return "";
  };
  alasql.fn.FOLDER_URL = function (value) {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const v = value[i] && value[i].folderUrl;
        if (v) return String(v);
      }
      return "";
    }
    if (value && typeof value === "object" && value.folderUrl) return String(value.folderUrl);
    return "";
  };

  // ===========================================================================
  // 和暦変換 UDF（DATE2ERA / DATETIME2ERATIME / ERA2DATE / ERATIME2DATETIME）
  //   元号テーブル / formatEraNonPadded / parseEraFlexible は eraConversion.js から import。
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // DATE2ERA(value) — Date → ゼロパディングなし和暦（日付のみ。時刻は削除）。
  //   令和1年 → "令和元年"。例: DATE2ERA('2019-05-01') = "令和元年5月1日"。
  //   引数は DATE 関数等と同じ形式（文字列 / msunixtime）。改元前 / 不正は NULL。
  // ---------------------------------------------------------------------------
  alasql.fn.DATE2ERA = function (value) {
    const p = valueToFullParts(value);
    if (!p || p.year == null) return null;
    return formatEraNonPadded({ year: p.year, month: p.month, day: p.day }, { withTime: false });
  };

  // ---------------------------------------------------------------------------
  // DATETIME2ERATIME(value) — Date → ゼロパディングなし和暦 + 時/分/秒（時刻 2 桁
  //   ゼロパディング）。引数に時刻が無くても "0時0分0秒" ではなく "00時00分00秒" まで表示。
  //   令和1年 → "令和元年"。例: DATETIME2ERATIME('2020-04-15 10:22:00') =
  //   "令和2年4月15日 10時22分00秒"。改元前 / 不正は NULL。
  // ---------------------------------------------------------------------------
  alasql.fn.DATETIME2ERATIME = function (value) {
    const p = valueToFullParts(value);
    if (!p || p.year == null) return null;
    return formatEraNonPadded(
      { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second },
      { withTime: true, timeKanji: true, padTime: true },
    );
  };

  // ---------------------------------------------------------------------------
  // ERA2DATE(text) — 和暦文字列 → "YYYY-MM-DD"（DATE2ERA の逆。時刻は削除）。
  //   "令和1年"/"令和元年"、"02月"/"2月"、月日省略、漢字/コロン時刻に対応。不正は NULL。
  // ---------------------------------------------------------------------------
  alasql.fn.ERA2DATE = function (text) {
    const p = parseEraFlexible(text);
    if (!p) return null;
    return `${pad4(p.year)}/${pad2(p.month)}/${pad2(p.day)}`;
  };

  // ---------------------------------------------------------------------------
  // ERATIME2DATETIME(text) — 和暦文字列 → "YYYY/MM/DD HH:mm:ss.SSS"（DATETIME2ERATIME の逆）。
  //   戻り値は canonical DATETIME 文字列なので日付はスラッシュ、日付↔時刻は半角スペース。
  //   "令和元年02月4日 13時" のような部分時刻も解釈。不正は NULL。
  // ---------------------------------------------------------------------------
  alasql.fn.ERATIME2DATETIME = function (text) {
    const p = parseEraFlexible(text);
    if (!p) return null;
    return `${pad4(p.year)}/${pad2(p.month)}/${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}.${pad3(p.ms || 0)}`;
  };

  // ===========================================================================
  // 集計 UDF（alasql.aggr.*）
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // STR_MAX / STR_MIN — 辞書順比較で動く MAX / MIN 集計。
  //   alasql 4 の組み込み MIN/MAX は生成コード内で値を number/bigint に強制し、
  //   それ以外（文字列・canonical 日付文字列 "YYYY-MM-DD" 等）を undefined に落とすため、
  //   非数値列の MIN/MAX が NULL になる。これを補う集計 UDF。
  //   canonical 文字列は辞書順 = 時系列順なので `<` / `>` 比較がそのまま機能する
  //   （数値同士の比較も同じ演算子で正しく働く）。
  //   alasql 規約: (value, accumulator, stage) — stage 1=グループ最初の値 /
  //   2=後続の値 / 3=確定（accumulator をそのまま返す）。NULL / undefined は無視する。
  // ---------------------------------------------------------------------------
  alasql.aggr.STR_MAX = function (value, accumulator, stage) {
    if (stage === 1) return (value === null || value === undefined) ? undefined : value;
    if (stage === 2) {
      if (value === null || value === undefined) return accumulator;
      if (accumulator === null || accumulator === undefined) return value;
      return value > accumulator ? value : accumulator;
    }
    return (accumulator === undefined) ? null : accumulator;
  };
  alasql.aggr.STR_MIN = function (value, accumulator, stage) {
    if (stage === 1) return (value === null || value === undefined) ? undefined : value;
    if (stage === 2) {
      if (value === null || value === undefined) return accumulator;
      if (accumulator === null || accumulator === undefined) return value;
      return value < accumulator ? value : accumulator;
    }
    return (accumulator === undefined) ? null : accumulator;
  };

  alasql.fn[REGISTERED] = true;
}

import { MS_PER_DAY, SERIAL_EPOCH_UTC_MS, JST_OFFSET_MS, UNIX_MS_THRESHOLD } from "../core/constants.js";

const TIME_ZONE = "Asia/Tokyo";
const DEFAULT_LOCALE = "ja-JP";
const SERIAL_EPOCH_JST_MS = SERIAL_EPOCH_UTC_MS - JST_OFFSET_MS;
const UNIX_SECONDS_THRESHOLD = 1000000000;

export const pad2 = (value) => String(value).padStart(2, "0");
export const pad3 = (value) => String(value).padStart(3, "0");
const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
// 数値 → Unix ms。Unix ms（>= 1e11）/ Unix 秒（>= 1e9 → ×1000）のみ判定する。
// Excel シリアル値（< 1e9 の小さな数値）の「値による推測」は行わない（例: 2027 → 1905 年の誤変換を防ぐ）。
// シリアル → 日付の変換はスプレッドシート読み取り境界（GAS Sheets_applyTemporalFormatsToMemory_）で
// のみ行い、アプリ内部・式評価・検索は canonical 文字列だけを扱う。明示変換が必要なときは serialToUnixMs を直接呼ぶ。
export const normalizeNumericToUnixMs = (numeric) => {
  if (!Number.isFinite(numeric)) return null;
  const abs = Math.abs(numeric);
  if (abs >= UNIX_MS_THRESHOLD) return numeric;
  if (abs >= UNIX_SECONDS_THRESHOLD) return numeric * 1000;
  return null;
};

export const unixMsToSerial = (unixMs) => (unixMs - SERIAL_EPOCH_JST_MS) / MS_PER_DAY;
export const serialToUnixMs = (serial) => SERIAL_EPOCH_JST_MS + serial * MS_PER_DAY;

// タイムゾーン指定子 ("Z" / "+09:00" / "+0900" / "-05:00") → UTC からのオフセット ms。
// 不正値は null。
const parseTzOffsetMs = (token) => {
  if (typeof token !== "string") return null;
  const s = token.trim();
  if (s === "Z" || s === "z") return 0;
  const m = s.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const hh = parseInt(m[2], 10);
  const mm = parseInt(m[3], 10);
  if (hh > 23 || mm > 59) return null;
  return sign * (hh * 60 + mm) * 60000;
};

const parseStringToUnixMs = (str) => {
  if (!str) return null;

  // YYYY-MM-DD / YYYY/MM/DD（+ 任意の HH:mm[:ss[.fff]] と任意の TZ 指定子）。
  // 日付↔時刻の区切りは `T` / `/` / 半角スペース / `_` を許容。
  // TZ 指定子（`Z` / `±HH:MM`）があればその時差を考慮して瞬間を確定し、
  // 無ければ日本ローカルタイム（JST）の壁時計時刻として解釈する。
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

export const parseStringToSerial = (value) => {
  if (typeof value !== "string") return null;
  const ms = parseStringToUnixMs(value.trim());
  return ms !== null ? ms : null;
};

export const toUnixMs = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeNumericToUnixMs(value);
  }
  if (value instanceof Date) return value.getTime();
  const parsed = parseStringToUnixMs(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
};

// 固定メタ列 (createdAt / modifiedAt / deletedAt) 専用の厳密パーサ。
// abs >= UNIX_MS_THRESHOLD のみ Unix ms として通し、それ未満は null を返す。
// Unix 秒(×1000) や Excel シリアル値の自動再解釈をしないため、手動編集で
// 桁を削った値が遠未来日付として復元されることがない。
export const toStrictUnixMs = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.abs(value) >= UNIX_MS_THRESHOLD ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric)) return null;
      return Math.abs(numeric) >= UNIX_MS_THRESHOLD ? numeric : null;
    }
    const parsed = parseStringToUnixMs(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return Math.abs(parsed) >= UNIX_MS_THRESHOLD ? parsed : null;
  }
  return null;
};

export const resolveStrictUnixMs = (...candidates) => {
  for (const candidate of candidates) {
    const unixMs = toStrictUnixMs(candidate);
    if (Number.isFinite(unixMs)) return unixMs;
  }
  return null;
};

const buildFormatter = (options) => new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeZone: TIME_ZONE, hour12: false, ...options });

const formatFromPartsMs = (formatter, unixMs) => {
  if (!Number.isFinite(unixMs)) return "";
  try {
    const parts = formatter.formatToParts(new Date(unixMs));
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    const yyyy = get("year");
    const mm = get("month");
    const dd = get("day");
    const hh = get("hour");
    const mi = get("minute");
    if (hh !== "" && mi !== "") {
      return `${yyyy}-${mm}-${dd}_${hh}:${mi}`;
    }
    return `${yyyy}-${mm}-${dd}`;
  } catch (error) {
    return "";
  }
};

const formatterDateTime = buildFormatter({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const formatterDate = buildFormatter({ year: "numeric", month: "2-digit", day: "2-digit" });
const formatterTime = buildFormatter({ hour: "2-digit", minute: "2-digit" });

export const formatUnixMsDateTime = (value) => {
  const ms = toUnixMs(value);
  return formatFromPartsMs(formatterDateTime, ms);
};
export const formatUnixMsDate = (value) => {
  const ms = toUnixMs(value);
  return formatFromPartsMs(formatterDate, ms);
};
export const formatUnixMsTime = (value) => {
  const ms = toUnixMs(value);
  if (!Number.isFinite(ms)) return "";
  try {
    const parts = formatterTime.formatToParts(new Date(ms));
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    const hh = get("hour");
    const mi = get("minute");
    return hh && mi ? `${pad2(hh)}:${pad2(mi)}` : "";
  } catch (error) {
    return "";
  }
};

const formatJstDateTime = (value, { includeSeconds = false, includeMilliseconds = false } = {}) => {
  const ms = toUnixMs(value);
  if (!Number.isFinite(ms)) return "";
  const jstDate = new Date(ms + JST_OFFSET_MS);
  const yyyy = jstDate.getUTCFullYear();
  const mm = pad2(jstDate.getUTCMonth() + 1);
  const dd = pad2(jstDate.getUTCDate());
  const hh = pad2(jstDate.getUTCHours());
  const mi = pad2(jstDate.getUTCMinutes());
  const ss = pad2(jstDate.getUTCSeconds());
  const sss = pad3(jstDate.getUTCMilliseconds());

  let formatted = `${yyyy}-${mm}-${dd}_${hh}:${mi}`;
  if (includeSeconds || includeMilliseconds) formatted += `:${ss}`;
  if (includeMilliseconds) formatted += `.${sss}`;
  return formatted;
};

export const formatUnixMsDateTimeSec = (value) => formatJstDateTime(value, { includeSeconds: true });
export const formatUnixMsDateTimeMs = (value) => formatJstDateTime(value, { includeSeconds: true, includeMilliseconds: true });

// 一覧の日時列でソート可能な数値へ。数値はそのまま、それ以外は toUnixMs。不正値は 0。
export const toComparableUnixMs = (value) => {
  const ms = Number.isFinite(value) ? value : toUnixMs(value);
  return Number.isFinite(ms) ? ms : 0;
};

// 一覧の日時列の表示用文字列。値が無ければ "---"。
export const formatUnixMsValue = (value) => {
  const ms = toComparableUnixMs(value);
  return ms > 0 ? formatUnixMsDateTimeSec(ms) : "---";
};

// ============================================================================
// JST 文字列ストレージ形式（メタ日時）
// `YYYY-MM-DD_HH:mm:ss.SSS` 固定（日付はハイフン、日付↔時刻の区切りはアンダースコア。ms までゼロ埋め）。
// ハイフン+ゼロ埋めの固定幅で「辞書順 = 時系列順」が成立し、`<` `>` `>=` `=` の文字列比較で
// 正しい時系列比較ができる。
// createdAt / modifiedAt / deletedAt のシート格納・JSON ワイヤ・JS 内部の唯一の表現。
// パース時の区切りは `-`/`/` と `_` / 半角スペース / `T` を許容、ms 省略形（`.ss` 末尾なし）も許容（旧データ互換）。
// ============================================================================

const JST_STORAGE_RE = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T\s_]+(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,3}))?)?)?$/;

/**
 * Date / Unix ms / 文字列 を JST ストレージ文字列 `YYYY-MM-DD_HH:mm:ss.SSS` に変換。
 * 不正値は空文字列。
 */
export const formatJstString = (value) => {
  if (value === null || value === undefined || value === "") return "";
  let unixMs;
  if (typeof value === "string") {
    // すでに JST 文字列形式ならパースして再正規化（緩いフォーマット → 厳格な canonical）
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

/**
 * JST ストレージ文字列 → Date オブジェクト。
 * 日付の区切りは `/` / `-`、日付↔時刻の区切りは 半角スペース / `_` / `T` を許容（旧形式互換）。
 * 時刻省略時は 00:00:00。不正値は null。
 */
export const parseJstString = (str) => {
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
  // JST の壁時計時刻として解釈。getTime() で UTC unix ms を取得。
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms) - JST_OFFSET_MS;
  if (!Number.isFinite(utcMs)) return null;
  return new Date(utcMs);
};

/**
 * 現在時刻を JST ストレージ文字列で返す。
 */
export const nowJstString = () => formatJstString(Date.now());

/**
 * JST 文字列 → Unix ms（移行期に旧 `*UnixMs` フィールド消費側のシム用）。
 */
export const jstStringToUnixMs = (str) => {
  const d = parseJstString(str);
  return d ? d.getTime() : null;
};

// ============================================================================
// レコード保存時の date / time フィールド値正規化。
// 「date 型は時刻 00:00、time 型は基準日 1899-12-30」をシート側に書かせるため、
// 余計な成分（date に時刻が混じる、time に日付が混じる）をフロント save パスで
// 削ぎ落として canonical 文字列に統一する。GAS 側 Sheets_parseDateLikeToJstDate_
// が string → Date 化のときに 00:00:00 / 1899-12-30 を自動付与する仕様に依存。
//
// 入力許容: 既存 input が出す `YYYY-MM-DD` / `HH:mm[:ss]` のほか、ISO 文字列・
// JST canonical 文字列・Date・unix ms 数値・シリアル値など toUnixMs が解釈できる
// 全形式。空 / 不正値は "" を返す。
// ============================================================================

/**
 * date / time フィールド保存値の正規化。整形は formatCanonical に集約し、TIME-only 文字列
 *（ミリ秒含む）も堅牢に扱う。
 * - `fieldType === "date"` → `YYYY-MM-DD`
 * - `fieldType === "time"` → `options.precision` に応じて
 *     `minute` → `HH:mm` / `second` → `HH:mm:ss` / `millisecond` → `HH:mm:ss.SSS`
 *   `precision` 未指定時は legacy `options.includeSeconds === false → minute` else `second`。
 *   ※ time は保存後にシートで Date 化され、読み戻し時に formatCanonical が `HH:mm:ss.SSS` を再付与する。
 * - その他の型 → 値をそのまま返す（呼び出し側でフィルタしない前提）
 * 空 / 不正値は "" を返す。
 * @param {*} value
 * @param {string} fieldType
 * @param {Object} [options]
 * @param {"minute"|"second"|"millisecond"} [options.precision]
 * @param {boolean} [options.includeSeconds] legacy（precision 不在時のみ参照）
 */
export const normalizeDateTimeFieldValue = (value, fieldType, options = {}) => {
  if (fieldType !== "date" && fieldType !== "time") return value;
  if (value === null || value === undefined || value === "") return "";
  if (fieldType === "date") return formatCanonical(value, "date") ?? "";
  const precision = options.precision
    || (options.includeSeconds === false ? "minute" : "second");
  const kind = precision === "minute" ? "timem" : (precision === "millisecond" ? "time" : "times");
  return formatCanonical(value, kind) ?? "";
};

// ============================================================================
// DATE / DATETIME / TIME 関数の canonical 文字列コア。
// 「DATE/DATETIME/TIME 型は文字（canonical 文字列 = ハイフン/アンダースコア区切り）として
// alasql 上もシート上も一貫して扱う」仕様の中核。registerNfbUdfs.js（フロント alasql UDF）と
// expressionFunctions.gs（GAS 側 twin nfbDt_*）の両方で同セマンティクスを実装する。
//
// 文字列の区別:
//   - TIME-only 文字列 = `HH:mm[:ss[.SSS]]`（先頭に日付成分なし）→ 「00:00:00 から
//     超過した時間」= ms since midnight。
//   - date を含む文字列 / Date / 数値 msunixtime → unix ms の「瞬間」。
// ============================================================================

const TIME_ONLY_RE = /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?$/;

/**
 * `HH:mm[:ss[.SSS]]` 形式の時刻文字列を 0:00:00 からのミリ秒数に変換する。
 * 24h を超える値・不正値は null。
 */
export const parseTimeStringToMsSinceMidnight = (str) => {
  if (typeof str !== "string") return null;
  const m = str.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const second = m[3] ? parseInt(m[3], 10) : 0;
  const ms = m[4] ? parseInt(m[4].padEnd(3, "0"), 10) : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  return hour * 3600000 + minute * 60000 + second * 1000 + ms;
};

/**
 * 任意の日時値（数値 msunixtime / Date / canonical or ゆる日時文字列）から JST の
 * 暦・時刻パーツを取り出す。全成分は数値（非パディング）。
 * - 数値は normalizeNumericToUnixMs で ms / 秒×1000 / Excel シリアルを自動判別。
 * - TIME-only 文字列は 1899-12-30 を基準日にした unix ms 経由でパーツ化されるため
 *   year/month/day は 1899/12/30 になる（呼び出し側で TIME-only を別扱いすること）。
 * 不正値は null。
 */
export const extractJstPartsFull = (value) => {
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
    ms: d.getUTCMilliseconds(),
  };
};

/**
 * 日時値 → unix ms。`TIMESTAMP(v)` 等が使う。
 * - 数値 → normalizeNumericToUnixMs（自動判別）。
 * - Date → getTime()。
 * - TIME-only 文字列 → ms since midnight（`"00:01:00"` → 60000）。
 * - date を含む文字列 → parseStringToUnixMs（JST 解釈）。
 * 不正値は null。
 */
export const toMsUnixTime = (v) => {
  if (v === null || v === undefined || v === "") return null;
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

export const pad4 = (value) => String(value).padStart(4, "0");

// 時刻成分 {hh,mi,ss,sss}（全て数値）を時刻系 kind の canonical 文字列へ整形する。
const formatTimeParts_ = (hh, mi, ss, sss, kind) => {
  if (kind === "timem") return `${pad2(hh)}:${pad2(mi)}`;
  if (kind === "times") return `${pad2(hh)}:${pad2(mi)}:${pad2(ss)}`;
  // "time" / "timems"
  return `${pad2(hh)}:${pad2(mi)}:${pad2(ss)}.${pad3(sss)}`;
};

const TIME_KINDS_ = new Set(["time", "timems", "times", "timem"]);

// 基準日 1970-01-01（UNIX エポック）。時刻のみ文字列を date/datetime へ展開する際の暦日。
// 仕様: 「年月日は適当だが UNIXTIME で一日経過していない日付」。
const TIME_ONLY_BASE_DATE_ = { year: 1970, month: 1, day: 1 };

/**
 * 日時値を kind に応じた canonical 文字列へ整形する。
 *   kind="date"            → `YYYY-MM-DD`
 *   kind="datetime"        → `YYYY-MM-DD_HH:mm:ss.SSS`（日付はハイフン、日付↔時刻の区切りはアンダースコア。ms までゼロ埋め）
 *   kind="time" / "timems" → `HH:mm:ss.SSS`（ミリ秒まで）
 *   kind="times"           → `HH:mm:ss`（秒まで）
 *   kind="timem"           → `HH:mm`（分まで）
 * 補完（不足成分の 0 埋め）・切り落とし（不要成分の除去）は自動。各関数の出力は互いに合成可能
 * （例: `formatCanonical(formatCanonical(T,"timem"),"time")` → `HH:mm:00.000`）。
 * - 数値 msunixtime → その瞬間の JST 壁時計時刻を整形。
 * - TIME-only 文字列（`HH:mm[:ss[.SSS]]`）:
 *     時刻系 kind → mod 24h で整形。
 *     date/datetime → 基準日 1970-01-01 を付与して展開（DATETIME("12:34") → "1970-01-01_12:34:00.000"）。
 * 空 / 不正値は null。
 */
export const formatCanonical = (v, kind) => {
  if (v === null || v === undefined || v === "") return null;
  const isTimeOnlyStr = typeof v === "string" && TIME_ONLY_RE.test(v.trim());

  // 時刻成分 {hh,mi,ss,sss} を確定（TIME-only は mod 24h、それ以外は JST 壁時計）。
  let hh, mi, ss, sss, datedParts;
  if (isTimeOnlyStr) {
    const msMid = parseTimeStringToMsSinceMidnight(v.trim());
    if (msMid === null) return null;
    const total = ((msMid % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
    hh = Math.floor(total / 3600000);
    mi = Math.floor((total % 3600000) / 60000);
    ss = Math.floor((total % 60000) / 1000);
    sss = total % 1000;
    datedParts = { ...TIME_ONLY_BASE_DATE_, hour: hh, minute: mi, second: ss, ms: sss };
  } else {
    const p = extractJstPartsFull(v);
    if (!p) return null;
    hh = p.hour; mi = p.minute; ss = p.second; sss = p.ms || 0;
    datedParts = p;
  }

  if (TIME_KINDS_.has(kind)) return formatTimeParts_(hh, mi, ss, sss, kind);
  if (kind === "date") {
    return `${pad4(datedParts.year)}-${pad2(datedParts.month)}-${pad2(datedParts.day)}`;
  }
  return `${pad4(datedParts.year)}-${pad2(datedParts.month)}-${pad2(datedParts.day)}_${pad2(hh)}:${pad2(mi)}:${pad2(ss)}.${pad3(sss)}`;
};

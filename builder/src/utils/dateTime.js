const TIME_ZONE = "Asia/Tokyo";
const DEFAULT_LOCALE = "ja-JP";

const pad2 = (value) => String(value).padStart(2, "0");

const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());

const buildDateFromParts = (year, month, day, hour, minute, second) =>
  new Date(year, month, day, hour || 0, minute || 0, second || 0);

const parseStringToDate = (value) => {
  if (typeof value !== "string") return null;
  const str = value.trim();
  if (!str) return null;

  // ISO（タイムゾーン付き/なし）
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
    const iso = new Date(str);
    return isValidDate(iso) ? iso : null;
  }

  // YYYY-MM-DD HH:MM[:SS]
  const dt = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (dt) {
    const date = buildDateFromParts(
      parseInt(dt[1], 10),
      parseInt(dt[2], 10) - 1,
      parseInt(dt[3], 10),
      parseInt(dt[4], 10),
      parseInt(dt[5], 10),
      dt[6] ? parseInt(dt[6], 10) : 0
    );
    return isValidDate(date) ? date : null;
  }

  // YYYY-MM-DD
  const d = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (d) {
    const dateOnly = buildDateFromParts(parseInt(d[1], 10), parseInt(d[2], 10) - 1, parseInt(d[3], 10));
    return isValidDate(dateOnly) ? dateOnly : null;
  }

  // HH:MM[:SS] （基準日: 1970-01-01 JST）
  const t = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (t) {
    const timeOnly = buildDateFromParts(1970, 0, 1, parseInt(t[1], 10), parseInt(t[2], 10), t[3] ? parseInt(t[3], 10) : 0);
    return isValidDate(timeOnly) ? timeOnly : null;
  }

  return null;
};

export const toUnixMs = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  const parsed = parseStringToDate(String(value));
  return parsed ? parsed.getTime() : null;
};

const buildFormatter = (options) => new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeZone: TIME_ZONE, hour12: false, ...options });

const formatFromParts = (formatter, unixMs) => {
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
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    }
    return `${yyyy}-${mm}-${dd}`;
  } catch (error) {
    return "";
  }
};

const formatterDateTime = buildFormatter({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const formatterDate = buildFormatter({ year: "numeric", month: "2-digit", day: "2-digit" });
const formatterTime = buildFormatter({ hour: "2-digit", minute: "2-digit" });

export const formatUnixMsDateTime = (unixMs) => formatFromParts(formatterDateTime, unixMs);
export const formatUnixMsDate = (unixMs) => formatFromParts(formatterDate, unixMs);
export const formatUnixMsTime = (unixMs) => {
  if (!Number.isFinite(unixMs)) return "";
  try {
    const parts = formatterTime.formatToParts(new Date(unixMs));
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    const hh = get("hour");
    const mi = get("minute");
    return hh && mi ? `${pad2(hh)}:${pad2(mi)}` : "";
  } catch (error) {
    return "";
  }
};

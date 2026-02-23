import { MS_PER_DAY, SERIAL_EPOCH_UTC_MS, JST_OFFSET_MS } from "../core/constants.js";

const TIME_ZONE = "Asia/Tokyo";
const DEFAULT_LOCALE = "ja-JP";
const SERIAL_EPOCH_JST_MS = SERIAL_EPOCH_UTC_MS - JST_OFFSET_MS;

const pad2 = (value) => String(value).padStart(2, "0");

const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());

const isProbablyUnixMs = (value) => Math.abs(value) >= 100000000000;

const unixMsToSerial = (unixMs) => (unixMs - SERIAL_EPOCH_JST_MS) / MS_PER_DAY;
const serialToUnixMs = (serial) => SERIAL_EPOCH_JST_MS + serial * MS_PER_DAY;

const buildUtcSerial = (year, month, day, hour, minute, second) => {
  const utcMs = Date.UTC(year, month, day, hour || 0, minute || 0, second || 0);
  const date = new Date(utcMs);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== (hour || 0) ||
    date.getUTCMinutes() !== (minute || 0) ||
    date.getUTCSeconds() !== (second || 0)
  ) {
    return null;
  }
  return (utcMs - SERIAL_EPOCH_UTC_MS) / MS_PER_DAY;
};

export const parseStringToSerial = (value) => {
  if (typeof value !== "string") return null;
  const str = value.trim();
  if (!str) return null;

  // ISO（タイムゾーン付き/なし）
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
    const iso = new Date(str);
    return isValidDate(iso) ? unixMsToSerial(iso.getTime()) : null;
  }

  // YYYY-MM-DD[/ ]HH:MM[:SS]
  const dt = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[\/\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dt) {
    const year = parseInt(dt[1], 10);
    const month = parseInt(dt[2], 10);
    const day = parseInt(dt[3], 10);
    const hour = dt[4] ? parseInt(dt[4], 10) : 0;
    const minute = dt[5] ? parseInt(dt[5], 10) : 0;
    const second = dt[6] ? parseInt(dt[6], 10) : 0;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
    return buildUtcSerial(year, month - 1, day, hour, minute, second);
  }

  // HH:MM[:SS] （基準日: 1899-12-30）
  const t = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (t) {
    const hour = parseInt(t[1], 10);
    const minute = parseInt(t[2], 10);
    const second = t[3] ? parseInt(t[3], 10) : 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
    return buildUtcSerial(1899, 11, 30, hour, minute, second);
  }

  if (/^[-+]?\d+(?:\.\d+)?$/.test(str)) {
    const numeric = Number(str);
    if (!Number.isFinite(numeric)) return null;
    return isProbablyUnixMs(numeric) ? unixMsToSerial(numeric) : numeric;
  }

  return null;
};

export const toUnixMs = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return isProbablyUnixMs(value) ? unixMsToSerial(value) : value;
  }
  if (value instanceof Date) return unixMsToSerial(value.getTime());
  const parsed = parseStringToSerial(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const buildFormatter = (options) => new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeZone: TIME_ZONE, hour12: false, ...options });

const normalizeSerialForFormat = (value) => {
  if (!Number.isFinite(value)) return null;
  const serial = isProbablyUnixMs(value) ? unixMsToSerial(value) : value;
  return serialToUnixMs(serial);
};

const formatFromParts = (formatter, serial) => {
  const unixMs = normalizeSerialForFormat(serial);
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
      return `${yyyy}-${mm}-${dd}/${hh}:${mi}`;
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
  const normalized = normalizeSerialForFormat(unixMs);
  if (!Number.isFinite(normalized)) return "";
  try {
    const parts = formatterTime.formatToParts(new Date(normalized));
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    const hh = get("hour");
    const mi = get("minute");
    return hh && mi ? `${pad2(hh)}:${pad2(mi)}` : "";
  } catch (error) {
    return "";
  }
};

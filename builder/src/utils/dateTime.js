import { MS_PER_DAY, SERIAL_EPOCH_UTC_MS, JST_OFFSET_MS } from "../core/constants.js";

const TIME_ZONE = "Asia/Tokyo";
const DEFAULT_LOCALE = "ja-JP";
const SERIAL_EPOCH_JST_MS = SERIAL_EPOCH_UTC_MS - JST_OFFSET_MS;

const pad2 = (value) => String(value).padStart(2, "0");
const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
const isProbablyUnixMs = (value) => Math.abs(value) >= 100000000000;

export const unixMsToSerial = (unixMs) => (unixMs - SERIAL_EPOCH_JST_MS) / MS_PER_DAY;
export const serialToUnixMs = (serial) => SERIAL_EPOCH_JST_MS + serial * MS_PER_DAY;

const parseStringToUnixMs = (str) => {
  if (!str) return null;

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
    const iso = new Date(str);
    return isValidDate(iso) ? iso.getTime() : null;
  }

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
    return Date.UTC(year, month - 1, day, hour, minute, second) - JST_OFFSET_MS;
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
    return isProbablyUnixMs(numeric) ? numeric : serialToUnixMs(numeric);
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
    return isProbablyUnixMs(value) ? value : serialToUnixMs(value);
  }
  if (value instanceof Date) return value.getTime();
  const parsed = parseStringToUnixMs(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
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
      return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
    }
    return `${yyyy}/${mm}/${dd}`;
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

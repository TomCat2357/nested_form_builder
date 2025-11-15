const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const toStringOrEmpty = (value) => (typeof value === "string" ? value : "");

const pad2 = (value) => String(value).padStart(2, "0");

const isSheetTime = (date) => {
  if (!(date instanceof Date)) return false;
  const year = date.getFullYear();
  return year === 1899 || year === 1900;
};

export const isIsoDateTimeString = (value) => ISO_DATE_TIME_PATTERN.test(toStringOrEmpty(value));

export const parseIsoDateTime = (value) => {
  const str = toStringOrEmpty(value);
  if (!isIsoDateTimeString(str)) return null;
  try {
    const date = new Date(str);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  } catch (error) {
    return null;
  }
};

export const formatTimeHHMM = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

export const formatDateYYYYMMDD = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const convertIsoTimeToLocal = (value) => {
  const date = parseIsoDateTime(value);
  if (!date || !isSheetTime(date)) return value;
  return formatTimeHHMM(date);
};

export const convertIsoDateToLocal = (value) => {
  const date = parseIsoDateTime(value);
  if (!date) return value;
  return formatDateYYYYMMDD(date);
};

export const formatIsoDateTimeDisplay = (value) => {
  const date = parseIsoDateTime(value);
  if (!date) return value;
  if (isSheetTime(date)) return formatTimeHHMM(date);
  const dateStr = formatDateYYYYMMDD(date);
  const timeStr = formatTimeHHMM(date);
  if (timeStr === "00:00") return dateStr;
  return `${dateStr} ${timeStr}`;
};

export const isoDateTimeToTimestamp = (value) => {
  const date = parseIsoDateTime(value);
  return date ? date.getTime() : null;
};

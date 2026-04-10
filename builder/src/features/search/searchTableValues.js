import {
  formatUnixMsDateTime,
  formatUnixMsDateTimeSec,
  formatUnixMsDate,
  formatUnixMsTime,
  toUnixMs,
  parseStringToSerial,
} from "../../utils/dateTime.js";
import { isChoiceMarkerValue } from "../../utils/responses.js";

const FALSE_LIKE_VALUES = new Set([null, undefined, "", false, 0, "0"]);

export const toBooleanLike = (value) => {
  if (Array.isArray(value)) {
    return value.some((item) => toBooleanLike(item));
  }
  return !FALSE_LIKE_VALUES.has(value);
};

export const columnType = (column) => column?.sourceType || column?.type || "";
export const isChoiceColumn = (column) => {
  const type = columnType(column);
  return type === "checkboxes" || type === "radio" || type === "select" || type === "weekday";
};
export const isBooleanSortColumn = (column) => columnType(column) === "checkboxes";
export const isNumericColumn = (column) => columnType(column) === "number";
export const isDateLikeColumn = (column) => {
  const type = columnType(column);
  return type === "date" || type === "time" || column?.key === "modifiedAt" || column?.key === "createdAt";
};
export const toNumericValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const isDevEnvironment = (() => {
  try {
    if (typeof import.meta !== "undefined" && import.meta.env && typeof import.meta.env.DEV === "boolean") {
      return import.meta.env.DEV;
    }
  } catch (error) {
    // no-op: import.meta may not be available in some runtimes
  }
  if (typeof process !== "undefined" && process.env && typeof process.env.NODE_ENV === "string") {
    return process.env.NODE_ENV !== "production";
  }
  return false;
})();

export const debugLog = (...args) => {
  if (!isDevEnvironment) return;
  console.debug("[searchTable]", ...args);
};

export const valueToDisplayString = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => valueToDisplayString(item))
      .filter((item) => item !== "" && item !== null && item !== undefined)
      .join("、");
  }
  if (value === null || value === undefined) return "";
  if (value === "") return "";

  return String(value);
};

export const formatTemporalValue = (rawValue, unixMs, column) => {
  const type = columnType(column);
  if (type !== "date" && type !== "time") return valueToDisplayString(rawValue);

  const ms = Number.isFinite(unixMs) ? unixMs : toUnixMs(rawValue);
  if (!Number.isFinite(ms)) return valueToDisplayString(rawValue);

  return type === "time" ? formatUnixMsTime(ms) : formatUnixMsDate(ms);
};

export const deriveChoiceLabels = (key, value) => {
  if (!isChoiceMarkerValue(value)) return null;
  if (typeof key !== "string" || !key.includes("|")) return null;

  const segments = key.split("|").filter(Boolean);
  if (segments.length === 0) return null;

  const optionLabel = segments[segments.length - 1];
  const questionLabel = segments.slice(0, -1).join("|");
  const combinedLabel = questionLabel ? `${questionLabel}:${optionLabel}` : optionLabel;

  return {
    optionLabel,
    combinedLabel,
  };
};

export const formatDateTime = (value) => {
  if (value instanceof Date) return formatUnixMsDateTime(value.getTime());
  const ms = Number.isFinite(value) ? value : toUnixMs(value);
  if (Number.isFinite(ms)) return formatUnixMsDateTime(ms);
  if (typeof value === "string") return value;
  return "";
};

export const normalizeSearchText = (text) => String(text || "").toLowerCase();
export const normalizeColumnName = (text) => String(text || "").trim().toLowerCase();
export const isEntryIdColumnName = (columnName) => normalizeColumnName(columnName) === "id";

export const parseFileUploadJson = (value) => {
  if (typeof value !== "string" || !value.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    if (parsed.length > 0 && typeof parsed[0]?.driveFileId !== "undefined") return parsed;
    return null;
  } catch {
    return null;
  }
};

export const buildSearchableCandidates = (key, value, unixMs = undefined) => {
  const candidates = [];

  const fileEntries = parseFileUploadJson(value);
  if (fileEntries !== null) {
    fileEntries.forEach((entry) => {
      const name = typeof entry?.name === "string" ? entry.name.trim() : "";
      if (name) candidates.push(name);
    });
    return candidates;
  }

  const displayValue = valueToDisplayString(value, unixMs);
  if (displayValue) {
    candidates.push(displayValue);
  }

  const choiceLabels = deriveChoiceLabels(key, value);
  if (choiceLabels?.optionLabel) {
    candidates.push(choiceLabels.optionLabel);
    if (choiceLabels.combinedLabel && choiceLabels.combinedLabel !== choiceLabels.optionLabel) {
      candidates.push(choiceLabels.combinedLabel);
    }
  }

  return candidates;
};

export const resolveChoiceDisplayValue = (path, rawValue, column) => {
  const type = columnType(column);
  if (type !== "radio" && type !== "select") return rawValue;
  if (!isChoiceMarkerValue(rawValue)) return rawValue;
  const choiceLabels = deriveChoiceLabels(path, rawValue);
  if (!choiceLabels?.optionLabel) return rawValue;
  return choiceLabels.optionLabel;
};

export const compareStrings = (a, b) => {
  const aa = String(a || "");
  const bb = String(b || "");
  return aa.localeCompare(bb, "ja");
};

export const compareValues = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (typeof a === 'number' && typeof b !== 'number') {
    return -1;
  }
  if (typeof a !== 'number' && typeof b === 'number') {
    return 1;
  }
  return compareStrings(a, b);
};

export const collectDirectOptionLabels = (data, path, optionOrder = null) => {
  const optionValues = [];
  const prefix = `${path}|`;
  Object.entries(data).forEach(([key, value]) => {
    if (!key.startsWith(prefix) || key === path) return;
    const remainder = key.slice(prefix.length);
    if (!remainder) return;
    const [head, ...rest] = remainder.split("|");
    if (!head || rest.length > 0) return;
    if (toBooleanLike(value)) {
      optionValues.push(head);
    }
  });
  if (Array.isArray(optionOrder) && optionOrder.length > 0) {
    const orderMap = new Map(optionOrder.map((label, index) => [label, index]));
    optionValues.sort((a, b) => {
      const orderA = orderMap.has(a) ? orderMap.get(a) : Number.MAX_SAFE_INTEGER;
      const orderB = orderMap.has(b) ? orderMap.get(b) : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return compareStrings(a, b);
    });
  }
  return optionValues;
};

const deriveBooleanValue = (rawValues) => toBooleanLike(rawValues.length ? rawValues : undefined);

const resolveSortValue = ({ rawValues, display, dataUnixMs, path, column }) => {
  // radio/select はラベル文字列で並び替えるため、真偽値ソートは checkboxes のみに限定する
  if (isBooleanSortColumn(column)) {
    return deriveBooleanValue(rawValues) ? 1 : 0;
  }

  if (rawValues.length === 0) return "";
  if (rawValues.length > 1) return display;

  const raw = rawValues[0];

  if (isNumericColumn(column)) {
    const num = toNumericValue(raw);
    if (num !== null) return num;
  }

  return display;
};

export const collectFieldValue = (entry, path, column) => {
  const data = entry?.data || {};
  const dataUnixMs = entry?.dataUnixMs || {};

  const values = [];
  const rawValues = [];
  const addValue = (raw, unixMs) => {
    const normalizedRaw = resolveChoiceDisplayValue(path, raw, column);
    const display = formatTemporalValue(normalizedRaw, unixMs, column);
    if (display === "" || display === null || display === undefined) return;
    values.push(display);
    rawValues.push(raw);
  };

  // 直接値がある場合はそれを優先
  const hasDirectValue = Object.prototype.hasOwnProperty.call(data, path);
  const optionValues = collectDirectOptionLabels(data, path, column?.optionOrder);

  if (hasDirectValue) {
    const directValue = data[path];
    const shouldPreferOptionLabels =
      (columnType(column) === "radio" || columnType(column) === "select") &&
      isChoiceMarkerValue(directValue) &&
      optionValues.length > 0;
    if (shouldPreferOptionLabels) {
      optionValues.forEach((v) => addValue(v));
    } else {
      addValue(directValue, dataUnixMs[path]);
    }
  } else {
    // 直接値がない場合のみ、option値を探す
    if (optionValues.length) {
      optionValues.forEach((v) => addValue(v));
    }
  }

  const display = values.join("、");
  const primary = values[0] || "";
  const sortDisplay = isChoiceColumn(column) && values.length <= 1 ? primary : display;
  const sortValue = resolveSortValue({ rawValues, display: sortDisplay, dataUnixMs, path, column });

  return {
    display,
    search: normalizeSearchText(values.join(" ")),
    sort: sortValue,
    boolean: deriveBooleanValue(rawValues),
  };
};

export const matchColumnName = (column, normalized) => {
  if (!column || !normalized) return false;

  if (column.key && column.key.toLowerCase() === normalized) return true;
  if (column.path && column.path.toLowerCase() === normalized) return true;

  if (Array.isArray(column.searchAliases)) {
    if (column.searchAliases.some((alias) => String(alias || "").toLowerCase() === normalized)) {
      return true;
    }
  }

  if (column.segments && Array.isArray(column.segments)) {
    const lastSegment = column.segments[column.segments.length - 1];
    if (lastSegment && String(lastSegment).toLowerCase() === normalized) return true;

    const fullName = column.segments.join("|").toLowerCase();
    if (fullName === normalized) return true;
  }

  return false;
};

const createEmptyCellValue = () => ({ display: "", search: "", sort: "", boolean: false });

export const computeRowValues = (entry, columns) => {
  const values = {};
  (columns || []).forEach((column) => {
    if (!column || !column.key) return;
    if (typeof column.getValue !== "function") {
      values[column.key] = createEmptyCellValue();
      return;
    }
    values[column.key] = column.getValue(entry, column) || createEmptyCellValue();
  });
  return values;
};

export const compareByColumn = (a, b, column, order = "asc") => {
  if (!column || column.sortable === false) return 0;
  const sortableA = a?.values?.[column.key]?.sort ?? "";
  const sortableB = b?.values?.[column.key]?.sort ?? "";
  const result = compareValues(sortableA, sortableB);
  const finalResult = order === "asc" ? result : -result;
  return finalResult;
};

export const buildDisplayText = (value) => valueToDisplayString(value);

export const applyDisplayLengthLimit = (text, limit) => {
  if (typeof text !== "string") return text ?? "";
  const maxLength = Number(limit);
  if (!Number.isFinite(maxLength) || maxLength <= 0) return text;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
};

export const parseSearchCellDisplayLimit = (rawValue) => {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

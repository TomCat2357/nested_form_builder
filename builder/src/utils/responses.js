import { formatUnixMsDate, formatUnixMsTime, toUnixMs } from "./dateTime.js";
import { deepEqual } from "./deepEqual.js";
import { traverseSchema } from "../core/schemaUtils.js";
import { formatPhoneValueForField } from "../core/phone.js";
import { sanitizeFileUploadEntry, normalizeFileUploadEntries, parseFileUploadStorage } from "../core/collect.js";

const normalizeTemporalValue = (field, rawValue, unixMsValue) => {
  if (field.type !== "time" && field.type !== "date") return rawValue;

  const unixMs = Number.isFinite(unixMsValue) ? unixMsValue : toUnixMs(rawValue);
  if (!Number.isFinite(unixMs)) return rawValue;

  const d = new Date(unixMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  if (field.type === "time") {
    return field.includeSeconds ? `${hh}:${mi}:${ss}` : `${hh}:${mi}`;
  }
  return `${yyyy}-${mm}-${dd}`;
};

const CHOICE_TYPES = new Set(["checkboxes", "radio", "select", "weekday"]);
export const isChoiceMarkerValue = (value) => value === true || value === 1 || value === "1" || value === "●";

const collectOptionLabels = (field) => {
  const labels = [];
  const seen = new Set();
  (Array.isArray(field?.options) ? field.options : []).forEach((opt) => {
    const label = typeof opt?.label === "string" ? opt.label : "";
    if (!label || seen.has(label)) return;
    labels.push(label);
    seen.add(label);
  });
  return labels;
};

const mergeChoiceLabels = (field, labels) => {
  const unique = [];
  const seen = new Set();
  labels.forEach((label) => {
    if (typeof label !== "string" || !label || seen.has(label)) return;
    unique.push(label);
    seen.add(label);
  });
  if (unique.length === 0) return [];

  const ordered = [];
  const orderedSeen = new Set();
  const selectedSet = new Set(unique);

  collectOptionLabels(field).forEach((label) => {
    if (!selectedSet.has(label) || orderedSeen.has(label)) return;
    ordered.push(label);
    orderedSeen.add(label);
  });

  unique.forEach((label) => {
    if (orderedSeen.has(label)) return;
    ordered.push(label);
    orderedSeen.add(label);
  });

  return ordered;
};

const collectDirectChoiceLabels = (field, directValue) => {
  if (!CHOICE_TYPES.has(field?.type)) return [];
  const labels = [];
  if (field.type === "checkboxes") {
    if (Array.isArray(directValue)) {
      directValue.forEach((item) => {
        if (typeof item === "string") labels.push(item);
      });
    } else if (typeof directValue === "string") {
      labels.push(directValue);
    }
  } else if (typeof directValue === "string") {
    labels.push(directValue);
  }

  if (directValue && typeof directValue === "object" && !Array.isArray(directValue)) {
    Object.entries(directValue).forEach(([label, marker]) => {
      if (isChoiceMarkerValue(marker)) labels.push(label);
    });
  }

  return mergeChoiceLabels(field, labels);
};

const collectMarkerChoiceLabels = (field, baseKey, data) => {
  if (!CHOICE_TYPES.has(field?.type)) return [];
  const labels = [];
  (Array.isArray(field?.options) ? field.options : []).forEach((opt) => {
    const optionLabel = typeof opt?.label === "string" ? opt.label : "";
    if (!optionLabel) return;
    const markerKey = `${baseKey}|${optionLabel}`;
    if (isChoiceMarkerValue(data?.[markerKey])) {
      labels.push(optionLabel);
    }
  });

  const prefix = `${baseKey}|`;
  Object.entries(data || {}).forEach(([key, marker]) => {
    if (!key.startsWith(prefix)) return;
    if (!isChoiceMarkerValue(marker)) return;
    const remainder = key.slice(prefix.length);
    if (!remainder || remainder.includes("|")) return;
    labels.push(remainder);
  });

  return mergeChoiceLabels(field, labels);
};

const collectDefaultSelectedLabels = (field) => {
  const labels = [];
  (Array.isArray(field?.options) ? field.options : []).forEach((opt) => {
    const label = typeof opt?.label === "string" ? opt.label : "";
    if (!label || !opt?.defaultSelected) return;
    labels.push(label);
  });
  return labels;
};

const resolveTextDefaultValue = (field, options = {}) => {
  const userName = typeof options?.userName === "string" ? options.userName : "";
  const userAffiliation = typeof options?.userAffiliation === "string" ? options.userAffiliation : "";
  const userTitle = typeof options?.userTitle === "string" ? options.userTitle : "";

  switch (field?.defaultValueMode) {
    case "userName":
      return userName;
    case "userAffiliation":
      return userAffiliation;
    case "userTitle":
      return userTitle;
    case "custom":
      return typeof field?.defaultValueText === "string" ? field.defaultValueText : "";
    default:
      return "";
  }
};

export const restoreResponsesFromData = (schema, data = {}, dataUnixMs = {}) => {
  const responses = {};

  traverseSchema(schema, (field, context) => {
    const baseKey = context.pathSegments.join("|");

    if (CHOICE_TYPES.has(field.type)) {
      const directLabels = collectDirectChoiceLabels(field, data?.[baseKey]);
      const markerLabels = collectMarkerChoiceLabels(field, baseKey, data);
      const selectedLabels = mergeChoiceLabels(field, [...directLabels, ...markerLabels]);
      if (field.type === "checkboxes") {
        if (selectedLabels.length > 0) {
          Object.assign(responses, { [field.id]: selectedLabels });
        }
      } else if (selectedLabels[0]) {
        Object.assign(responses, { [field.id]: selectedLabels[0] });
      }
    } else if (field.type === "fileUpload") {
      const files = normalizeFileUploadEntries(data?.[baseKey]);
      if (files.length > 0) {
        Object.assign(responses, { [field.id]: files });
      }
    } else {
      const normalized = normalizeTemporalValue(field, data[baseKey], dataUnixMs[baseKey]);
      if (normalized !== undefined && normalized !== null) {
        Object.assign(responses, {
          [field.id]: field.type === "number" && normalized !== ""
            ? String(normalized)
            : normalized,
        });
      }
    }
  }, {
    getChildKeys: (field) => {
      const value = responses[field.id];
      if (field.type === "checkboxes" && Array.isArray(value)) {
        return value.filter(k => Object.prototype.hasOwnProperty.call(field.childrenByValue, k));
      } else if (["radio", "select"].includes(field.type) && typeof value === "string" && value) {
        return field.childrenByValue[value] ? [value] : [];
      }
      return [];
    }
  });

  return responses;
};

export const collectDefaultNowResponses = (schema, now = new Date(), options = {}) => {
  const defaults = {};
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  const dateValue = `${yyyy}-${mm}-${dd}`;

  const userName = typeof options?.userName === "string" ? options.userName : "";
  const userEmail = typeof options?.userEmail === "string" ? options.userEmail : "";
  const userPhone = typeof options?.userPhone === "string" ? options.userPhone : "";

  traverseSchema(schema, (field) => {
    if (!field?.id) return;

    if (["date", "time"].includes(field?.type) && field?.defaultNow && field?.id) {
      const timeValue = field.includeSeconds ? `${hh}:${mi}:${ss}` : `${hh}:${mi}`;
      defaults[field.id] = field.type === "date" ? dateValue : timeValue;
    }
    if (field?.type === "userName" && field?.defaultNow && field?.id && userName) {
      defaults[field.id] = userName;
    }
    if (field?.type === "text") {
      const defaultValue = resolveTextDefaultValue(field, options);
      if (defaultValue !== "") {
        defaults[field.id] = defaultValue;
      }
    }
    if (field?.type === "email" && (field?.autoFillUserEmail || field?.defaultNow) && field?.id && userEmail) {
      defaults[field.id] = userEmail;
    }
    if (field?.type === "phone" && field?.autoFillUserPhone && userPhone) {
      const formattedPhone = formatPhoneValueForField(userPhone, field);
      if (formattedPhone) {
        defaults[field.id] = formattedPhone;
      } else if (userPhone.trim()) {
        defaults[field.id] = userPhone;
      }
    }
    if (field?.type === "checkboxes") {
      const selected = collectDefaultSelectedLabels(field);
      if (selected.length > 0) {
        defaults[field.id] = selected;
      }
    }
    if (field?.type === "weekday" && field?.defaultToday) {
      const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
      defaults[field.id] = WEEKDAY_LABELS[now.getDay()];
    }
    if (["radio", "select"].includes(field?.type)) {
      const selected = collectDefaultSelectedLabels(field);
      if (selected[0]) {
        defaults[field.id] = selected[0];
      }
    }
  });

  return defaults;
};

export const hasDirtyChanges = (a, b) => {
  return !deepEqual(a || {}, b || {});
};

export const collectFileUploadFolderUrls = (schema, data = {}) => {
  const folderUrls = {};
  traverseSchema(schema, (field, context) => {
    if (field?.type !== "fileUpload" || !field?.id) return;
    const baseKey = context.pathSegments.join("|");
    const parsed = parseFileUploadStorage(data?.[baseKey]);
    if (parsed.folderUrl) folderUrls[field.id] = parsed.folderUrl;
  });
  return folderUrls;
};

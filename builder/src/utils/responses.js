import { formatUnixMsDate, formatUnixMsTime, toUnixMs } from "./dateTime.js";
import { deepEqual } from "./deepEqual.js";

const buildKey = (prefix, label) => (prefix ? `${prefix}|${label}` : label);

const normalizeTemporalValue = (field, rawValue, unixMsValue) => {
  if (field.type !== "time" && field.type !== "date") return rawValue;

  const unixMs = Number.isFinite(unixMsValue) ? unixMsValue : toUnixMs(rawValue);
  if (!Number.isFinite(unixMs)) return rawValue;

  return field.type === "time" ? formatUnixMsTime(unixMs) : formatUnixMsDate(unixMs);
};

export const restoreResponsesFromData = (schema, data = {}, dataUnixMs = {}) => {
  const responses = {};
  const walk = (fields, prefix) => {
    (fields || []).forEach((field) => {
      const label = field?.label || "";
      if (!label) return;

      const baseKey = buildKey(prefix, label);

      if (field.type === "checkboxes") {
        const values = [];
        (field.options || []).forEach((opt) => {
          const key = buildKey(baseKey, opt.label || "");
          if (data[key]) {
            values.push(opt.label);
            if (field.childrenByValue?.[opt.label]) {
              walk(field.childrenByValue[opt.label], key);
            }
          }
        });
        if (values.length) responses[field.id] = values;
      } else if (["radio", "select"].includes(field.type)) {
        let selected = null;
        (field.options || []).forEach((opt) => {
          const key = buildKey(baseKey, opt.label || "");
          if (data[key]) selected = opt.label;
        });
        if (selected) {
          responses[field.id] = selected;
          if (field.childrenByValue?.[selected]) {
            walk(field.childrenByValue[selected], buildKey(baseKey, selected));
          }
        }
      } else {
        const normalized = normalizeTemporalValue(field, data[baseKey], dataUnixMs[baseKey]);
        if (normalized !== undefined && normalized !== null) {
          responses[field.id] = normalized;
        }
      }
    });
  };

  walk(schema, "");
  return responses;
};

export const collectDefaultNowResponses = (schema, now = new Date()) => {
  const defaults = {};
  const dateValue = formatUnixMsDate(now.getTime());
  const timeValue = formatUnixMsTime(now.getTime());

  const walk = (fields) => {
    (fields || []).forEach((field) => {
      if (["date", "time"].includes(field?.type) && field?.defaultNow && field?.id) {
        defaults[field.id] = field.type === "date" ? dateValue : timeValue;
      }
      if (field?.childrenByValue && typeof field.childrenByValue === "object") {
        Object.values(field.childrenByValue).forEach((children) => walk(children));
      }
    });
  };

  walk(schema);
  return defaults;
};

export const hasDirtyChanges = (a, b) => {
  return !deepEqual(a || {}, b || {});
};

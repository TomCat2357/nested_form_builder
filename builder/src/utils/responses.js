import { formatUnixMsDate, formatUnixMsTime, toUnixMs } from "./dateTime.js";

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

export const hasDirtyChanges = (a, b) => {
  try {
    return JSON.stringify(a || {}) !== JSON.stringify(b || {});
  } catch (error) {
    return true;
  }
};

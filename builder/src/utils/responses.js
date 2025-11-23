import { formatUnixMsDate, formatUnixMsTime, toUnixMs } from "./dateTime.js";

const buildKey = (prefix, label) => (prefix ? `${prefix}|${label}` : label);

export const restoreResponsesFromData = (schema, data = {}, dataUnixMs = {}) => {
  const responses = {};
  const walk = (fields, prefix) => {
    (fields || []).forEach((field) => {
      const label = field?.label || "";
      const baseKey = buildKey(prefix, label);
      if (!label) return;

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
        let value = data[baseKey];
        const unix = dataUnixMs[baseKey];
        if (Number.isFinite(unix)) {
          value = field.type === "time" ? formatUnixMsTime(unix) : field.type === "date" ? formatUnixMsDate(unix) : value;
        } else if (value !== undefined) {
          if (field.type === "time") {
            const ms = toUnixMs(value);
            value = Number.isFinite(ms) ? formatUnixMsTime(ms) : value;
          } else if (field.type === "date") {
            const ms = toUnixMs(value);
            value = Number.isFinite(ms) ? formatUnixMsDate(ms) : value;
          }
          responses[field.id] = value;
        }
        if (value !== undefined && value !== null) {
          responses[field.id] = value;
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

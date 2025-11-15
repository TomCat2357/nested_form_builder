import { convertIsoDateToLocal, convertIsoTimeToLocal } from "./dateTime.js";

const buildKey = (prefix, label) => (prefix ? `${prefix}|${label}` : label);

export const restoreResponsesFromData = (schema, data = {}) => {
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
        if (value !== undefined) {
          // 時間・日付フィールドの場合はISO形式から適切な形式に変換
          if (field.type === "time") {
            value = convertIsoTimeToLocal(value);
          } else if (field.type === "date") {
            value = convertIsoDateToLocal(value);
          } else if (typeof value === "string") {
            const normalizedTime = convertIsoTimeToLocal(value);
            if (normalizedTime !== value) {
              value = normalizedTime;
            } else {
              value = convertIsoDateToLocal(value);
            }
          }
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

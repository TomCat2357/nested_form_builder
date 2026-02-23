import { formatUnixMsDate, formatUnixMsTime, toUnixMs } from "./dateTime.js";
import { deepEqual } from "./deepEqual.js";
import { traverseSchema } from "../core/schemaUtils.js";

const normalizeTemporalValue = (field, rawValue, unixMsValue) => {
  if (field.type !== "time" && field.type !== "date") return rawValue;

  const unixMs = Number.isFinite(unixMsValue) ? unixMsValue : toUnixMs(rawValue);
  if (!Number.isFinite(unixMs)) return rawValue;

  return field.type === "time" ? formatUnixMsTime(unixMs) : formatUnixMsDate(unixMs);
};

export const restoreResponsesFromData = (schema, data = {}, dataUnixMs = {}) => {
  const responses = {};

  traverseSchema(schema, (field, context) => {
    const baseKey = context.pathSegments.join("|");

    if (field.type === "checkboxes") {
      const values = [];
      (field.options || []).forEach((opt) => {
        const key = opt.label ? `${baseKey}|${opt.label}` : baseKey;
        if (data[key]) values.push(opt.label);
      });
      if (values.length) Object.assign(responses, { [field.id]: values });
    } else if (["radio", "select"].includes(field.type)) {
      let selected = null;
      (field.options || []).forEach((opt) => {
        const key = opt.label ? `${baseKey}|${opt.label}` : baseKey;
        if (data[key]) selected = opt.label;
      });
      if (selected) Object.assign(responses, { [field.id]: selected });
    } else {
      const normalized = normalizeTemporalValue(field, data[baseKey], dataUnixMs[baseKey]);
      if (normalized !== undefined && normalized !== null) {
        Object.assign(responses, { [field.id]: normalized });
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
  const dateValue = formatUnixMsDate(now.getTime());
  const timeValue = formatUnixMsTime(now.getTime());
  const userName = typeof options?.userName === "string" ? options.userName : "";

  traverseSchema(schema, (field) => {
    if (["date", "time"].includes(field?.type) && field?.defaultNow && field?.id) {
      defaults[field.id] = field.type === "date" ? dateValue : timeValue;
    }
    if (field?.type === "userName" && field?.defaultNow && field?.id && userName) {
      defaults[field.id] = userName;
    }
  });

  return defaults;
};

export const hasDirtyChanges = (a, b) => {
  return !deepEqual(a || {}, b || {});
};

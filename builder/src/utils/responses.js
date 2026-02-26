import { formatUnixMsDate, formatUnixMsTime, toUnixMs } from "./dateTime.js";
import { deepEqual } from "./deepEqual.js";
import { traverseSchema } from "../core/schemaUtils.js";

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
  return field.type === "time" ? `${hh}:${mi}` : `${yyyy}-${mm}-${dd}`;
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
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");

  const dateValue = `${yyyy}-${mm}-${dd}`;
  const timeValue = `${hh}:${mi}`;

  const userName = typeof options?.userName === "string" ? options.userName : "";
  const userEmail = typeof options?.userEmail === "string" ? options.userEmail : "";

  traverseSchema(schema, (field) => {
    if (["date", "time"].includes(field?.type) && field?.defaultNow && field?.id) {
      defaults[field.id] = field.type === "date" ? dateValue : timeValue;
    }
    if (field?.type === "userName" && field?.defaultNow && field?.id && userName) {
      defaults[field.id] = userName;
    }
    if (field?.type === "email" && field?.defaultNow && field?.id && userEmail) {
      defaults[field.id] = userEmail;
    }
  });

  return defaults;
};

export const hasDirtyChanges = (a, b) => {
  return !deepEqual(a || {}, b || {});
};

import { traverseSchema } from "./schemaUtils.js";

export const collectResponses = (fields, responses) => {
  const out = {};
  const orderList = [];

  traverseSchema(fields, (field, context) => {
    const value = responses?.[field.id];
    const base = context.pathSegments.join("|");

    if (field.type === "checkboxes" && Array.isArray(value)) {
      value.forEach((lbl) => {
        const key = `${base}|${lbl}`;
        out[key] = "●";
        orderList.push(key);
      });
    } else if (["radio", "select"].includes(field.type) && typeof value === "string" && value) {
      const key = `${base}|${value}`;
      out[key] = "●";
      orderList.push(key);
    } else if (["text", "textarea", "number", "regex", "date", "time", "url", "userName"].includes(field.type) && value != null && value !== "") {
      out[base] = value;
      orderList.push(base);
    }
  }, { responses });

  return out;
};

export const collectAllPossiblePaths = (fields) => {
  const paths = [];

  traverseSchema(fields, (field, context) => {
    const base = context.pathSegments.join("|");

    if (["checkboxes", "radio", "select"].includes(field.type) && Array.isArray(field.options)) {
      field.options.forEach((option) => {
        const optionLabel = option.label || "";
        paths.push(`${base}|${optionLabel}`);
      });
    } else if (["text", "textarea", "number", "regex", "date", "time", "url", "userName"].includes(field.type)) {
      paths.push(base);
    }
  });

  return paths;
};

export const sortResponses = (responses, schema = null) => {
  const source = responses || {};

  if (schema) {
    const allPaths = collectAllPossiblePaths(schema);
    const sorted = {};
    allPaths.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        sorted[key] = source[key];
      }
    });
    return { map: sorted, keys: allPaths };
  }

  const keys = Object.keys(source).sort((a, b) => String(a).localeCompare(String(b), "ja"));
  const sorted = {};
  keys.forEach((key) => {
    sorted[key] = source[key];
  });
  return { map: sorted, keys };
};

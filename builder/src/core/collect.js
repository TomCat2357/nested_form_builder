export const collectResponses = (fields, responses, prefix = "", out = {}, orderList = []) => {
  (fields || []).forEach((field) => {
    const label = field.label || "";
    const base = prefix ? `${prefix}|${label}` : label;
    const value = responses?.[field.id];

    if (field.type === "checkboxes" && Array.isArray(value)) {
      value.forEach((lbl) => {
        const key = `${base}|${lbl}`;
        out[key] = "●";
        orderList.push(key);
        if (field.childrenByValue?.[lbl]) {
          collectResponses(field.childrenByValue[lbl], responses, `${base}|${lbl}`, out, orderList);
        }
      });
    } else if (["radio", "select"].includes(field.type) && typeof value === "string" && value) {
      const key = `${base}|${value}`;
      out[key] = "●";
      orderList.push(key);
      if (field.childrenByValue?.[value]) {
        collectResponses(field.childrenByValue[value], responses, `${base}|${value}`, out, orderList);
      }
    } else if (["text", "textarea", "number", "regex", "date", "time", "url", "userName"].includes(field.type) && value != null && value !== "") {
      out[base] = value;
      orderList.push(base);
    }
  });
  return out;
};

// Generate all possible paths from schema definition (including all options)
export const collectAllPossiblePaths = (fields, prefix = "", paths = []) => {
  (fields || []).forEach((field) => {
    const label = field.label || "";
    const base = prefix ? `${prefix}|${label}` : label;

    if (["checkboxes", "radio", "select"].includes(field.type) && Array.isArray(field.options)) {
      field.options.forEach((option) => {
        const optionLabel = option.label || "";
        const key = `${base}|${optionLabel}`;
        paths.push(key);
        if (field.childrenByValue?.[optionLabel]) {
          collectAllPossiblePaths(field.childrenByValue[optionLabel], `${base}|${optionLabel}`, paths);
        }
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

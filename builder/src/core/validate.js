// Module-level regex cache for better performance across validation calls
const regexCache = new Map();

export const buildSafeRegex = (pattern) => {
  if (!pattern) return { re: null, error: null };
  try {
    return { re: new RegExp(pattern), error: null };
  } catch (err) {
    return { re: null, error: err instanceof Error ? err.message : String(err) };
  }
};

export const validateByPattern = (field, value, cachedRegex = null) => {
  if (field.type !== "regex") return { ok: true, message: "" };
  const { re, error } = cachedRegex || buildSafeRegex(field.pattern || "");
  if (error) return { ok: false, message: `正規表現が不正です: ${error}` };

  const strValue = value ?? "";
  if (field.required && strValue === "") return { ok: false, message: "入力は必須です" };
  if (strValue === "" || !re) return { ok: true, message: "" };

  return re.test(String(value))
    ? { ok: true, message: "" }
    : { ok: false, message: `入力がパターンに一致しません: /${field.pattern}/` };
};

const isEmpty = (field, value) => {
  if (value === undefined || value === null) return true;
  if (["text", "textarea", "regex", "date", "time", "select", "radio", "url"].includes(field.type)) {
    return value === "";
  }
  if (field.type === "number") {
    return value === "";
  }
  if (field.type === "checkboxes") {
    return !Array.isArray(value) || value.length === 0;
  }
  return false;
};

const getRegexResult = (pattern) => {
  const key = pattern || "";
  if (!regexCache.has(key)) {
    regexCache.set(key, buildSafeRegex(key));
  }
  return regexCache.get(key);
};

const normalizePathLabel = (field) => {
  const label = (field?.label || "").trim();
  return label || `無題 (${field?.type || "unknown"})`;
};

export const collectValidationErrors = (fields, responses) => {
  const errors = [];

  const walk = (arr, pathSegments = []) => (arr || []).forEach((field) => {
    const value = responses?.[field.id];
    const currentPath = [...pathSegments, normalizePathLabel(field)];
    const path = currentPath.join(" > ");
    let hasRequiredError = false;

    if (field.required && isEmpty(field, value)) {
      errors.push({
        fieldId: field.id,
        path,
        type: "required",
        message: "必須項目が未入力です",
      });
      hasRequiredError = true;
    }

    if (field.type === "regex") {
      const regexResult = getRegexResult(field.pattern);
      if (regexResult.error) {
        errors.push({
          fieldId: field.id,
          path,
          type: "regex_invalid",
          message: `正規表現が不正です: ${regexResult.error}`,
        });
      } else {
        const result = validateByPattern(field, value, regexResult);
        if (!result.ok && result.message !== "入力は必須です") {
          errors.push({
            fieldId: field.id,
            path,
            type: "regex_mismatch",
            message: result.message,
          });
        } else if (!result.ok && !hasRequiredError) {
          errors.push({
            fieldId: field.id,
            path,
            type: "required",
            message: "必須項目が未入力です",
          });
        }
      }
    }

    if (field.childrenByValue) {
      if (field.type === "checkboxes" && Array.isArray(value)) {
        value.forEach((label) => {
          if (field.childrenByValue[label]) {
            walk(field.childrenByValue[label], [...currentPath, label]);
          }
        });
      } else if (["radio", "select"].includes(field.type) && value && field.childrenByValue[value]) {
        walk(field.childrenByValue[value], [...currentPath, value]);
      } else if (!["checkboxes", "radio", "select"].includes(field.type)) {
        Object.keys(field.childrenByValue).forEach((key) => walk(field.childrenByValue[key], [...currentPath, key]));
      }
    }
  });

  walk(fields);
  return { errors };
};

export const formatValidationErrors = (result) => {
  const errors = result?.errors || [];
  if (errors.length === 0) return "";

  const items = errors.map((error, index) => (
    `${index + 1}. [${error.path}]\n   ${error.message}`
  ));

  return `以下の項目にエラーがあります:\n\n${items.join("\n\n")}`;
};

export const hasValidationErrors = (fields, responses) => collectValidationErrors(fields, responses).errors.length > 0;

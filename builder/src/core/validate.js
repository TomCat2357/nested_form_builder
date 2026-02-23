import { traverseSchema } from "./schemaUtils.js";

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
  if (["text", "textarea", "regex", "date", "time", "select", "radio", "url", "userName"].includes(field.type)) {
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

export const collectValidationErrors = (fields, responses) => {
  const errors = [];

  traverseSchema(fields, (field, context) => {
    const value = responses?.[field.id];
    const path = context.pathSegments.join(" > ");
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
  }, { responses });

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

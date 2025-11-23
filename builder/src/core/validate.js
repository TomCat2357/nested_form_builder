
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

export const hasValidationErrors = (fields, responses) => {
  let hasError = false;
  const regexCache = new Map();

  const getRegexResult = (pattern) => {
    const key = pattern || "";
    if (!regexCache.has(key)) {
      regexCache.set(key, buildSafeRegex(key));
    }
    return regexCache.get(key);
  };

  const walk = (arr) => (arr || []).forEach((field) => {
    const value = responses?.[field.id];
    if (field.type === "regex") {
      const regexResult = getRegexResult(field.pattern);
      if (regexResult.error) {
        hasError = true;
        return;
      }
      const result = validateByPattern(field, value, regexResult);
      if (!result.ok) hasError = true;
    }
    if (field.childrenByValue) {
      Object.keys(field.childrenByValue).forEach((key) => walk(field.childrenByValue[key]));
    }
  });

  walk(fields);
  return hasError;
};

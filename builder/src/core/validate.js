
export const buildSafeRegex = (pattern) => {
  if (!pattern) return { re: null, error: null };
  try {
    return { re: new RegExp(pattern), error: null };
  } catch (err) {
    return { re: null, error: err instanceof Error ? err.message : String(err) };
  }
};

export const validateByPattern = (field, value) => {
  if (field.type !== "regex") return { ok: true, message: "" };
  const { re, error } = buildSafeRegex(field.pattern || "");
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

  const walk = (arr) => (arr || []).forEach((field) => {
    const value = responses?.[field.id];
    if (field.type === "regex") {
      const { error } = buildSafeRegex(field.pattern || "");
      if (error) hasError = true;
      const result = validateByPattern(field, value);
      if (!result.ok) hasError = true;
    }
    if (field.childrenByValue) {
      Object.keys(field.childrenByValue).forEach((key) => walk(field.childrenByValue[key]));
    }
  });

  walk(fields);
  return hasError;
};

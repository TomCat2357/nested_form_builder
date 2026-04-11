import { traverseSchema } from "./schemaUtils.js";
import { getPhoneRegex } from "./phone.js";

const regexCache = new Map();
const NUMBER_INTEGER_DRAFT_REGEX = /^-?\d*$/;
const NUMBER_DECIMAL_DRAFT_REGEX = /^-?\d*(?:\.\d*)?$/;
const NUMBER_INTEGER_FINAL_REGEX = /^-?\d+$/;
const URL_REGEX = /^https?:\/\/.+$/;
const ASCII_ONLY_REGEX = /^[\x00-\x7F]+$/;
const EMAIL_LOCAL_ALLOWED_REGEX = /^[A-Za-z0-9._$=?\^`{}~#-]+$/;
const EMAIL_DOMAIN_ALLOWED_REGEX = /^[A-Za-z0-9.-]+$/;
const EMAIL_DOMAIN_LABEL_REGEX = /^[A-Za-z0-9-]+$/;
const EMAIL_MAX_LENGTH = 256;

const patternEnabled = (field) => field?.type === "regex"
  || (field?.type === "text" && field?.inputRestrictionMode === "pattern");

const getPatternSource = (field) => {
  if (!patternEnabled(field)) return "";
  return typeof field?.pattern === "string" ? field.pattern : "";
};

const getMaxLength = (field) => {
  if (field?.type !== "text" || field?.inputRestrictionMode !== "maxLength") return null;
  const parsed = Number(field?.maxLength);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
};

const toFiniteNumberSetting = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildSafeRegex = (pattern) => {
  if (!pattern) return { re: null, error: null };
  try {
    return { re: new RegExp(pattern), error: null };
  } catch (err) {
    return { re: null, error: err instanceof Error ? err.message : String(err) };
  }
};

const getRegexResult = (pattern) => {
  const key = pattern || "";
  if (!regexCache.has(key)) {
    regexCache.set(key, buildSafeRegex(key));
  }
  return regexCache.get(key);
};

export const isNumberInputDraftAllowed = (value, integerOnly = false) => {
  const source = typeof value === "string" ? value : String(value ?? "");
  return (integerOnly ? NUMBER_INTEGER_DRAFT_REGEX : NUMBER_DECIMAL_DRAFT_REGEX).test(source);
};

const EMAIL_INVALID = { ok: false, code: "email_invalid", message: "メールアドレスの形式が正しくありません" };

const isValidEmailLocal = (local) => {
  if (!local) return false;
  if (!/^[A-Za-z0-9]/.test(local) || !/[A-Za-z0-9]$/.test(local)) return false;
  if (!EMAIL_LOCAL_ALLOWED_REGEX.test(local)) return false;
  if (local.includes("..") || local.includes("__")) return false;
  return true;
};

const isValidEmailDomain = (domain) => {
  if (!domain || !domain.includes(".") || !EMAIL_DOMAIN_ALLOWED_REGEX.test(domain)) return false;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((l) => !l)) return false;
  if (labels.some((l) => !EMAIL_DOMAIN_LABEL_REGEX.test(l))) return false;
  if (labels.some((l) => l.startsWith("-") || l.endsWith("-"))) return false;
  if (labels.some((l) => l.toLowerCase().startsWith("xn--"))) return false;
  return true;
};

const validateEmailAddress = (value) => {
  const source = String(value);
  if (!source || source.length > EMAIL_MAX_LENGTH) return EMAIL_INVALID;
  if (!ASCII_ONLY_REGEX.test(source) || source.includes(" ")) return EMAIL_INVALID;

  const parts = source.split("@");
  if (parts.length !== 2) return EMAIL_INVALID;

  if (!isValidEmailLocal(parts[0]) || !isValidEmailDomain(parts[1])) return EMAIL_INVALID;

  return { ok: true, code: "", message: "" };
};

const validateNumberField = (field, value) => {
  const source = typeof value === "string" ? value : String(value);
  if (!NUMBER_DECIMAL_DRAFT_REGEX.test(source)) {
    return { ok: false, code: "number_invalid", message: "数値を入力してください" };
  }

  const parsed = Number(source);
  if (!Number.isFinite(parsed)) {
    return { ok: false, code: "number_invalid", message: "数値を入力してください" };
  }

  if (field?.integerOnly) {
    if (!NUMBER_INTEGER_FINAL_REGEX.test(source) || !Number.isInteger(parsed)) {
      return { ok: false, code: "number_integer_invalid", message: "整数で入力してください" };
    }
  }

  const minValue = toFiniteNumberSetting(field?.minValue);
  if (minValue !== null && parsed < minValue) {
    return {
      ok: false,
      code: "number_min",
      message: `最小値以上で入力してください（最小: ${minValue}）`,
    };
  }

  const maxValue = toFiniteNumberSetting(field?.maxValue);
  if (maxValue !== null && parsed > maxValue) {
    return {
      ok: false,
      code: "number_max",
      message: `最大値以下で入力してください（最大: ${maxValue}）`,
    };
  }

  return { ok: true, code: "", message: "" };
};

const isEmpty = (field, value) => {
  if (value === undefined || value === null) return true;
  if (field.type === "printTemplate") return true;
  if (field.type === "checkboxes") {
    return !Array.isArray(value) || value.length === 0;
  }
  return value === "";
};

export const validateByPattern = (field, value, cachedRegex = null) => {
  const patternSource = getPatternSource(field);
  const regexResult = patternSource ? (cachedRegex || getRegexResult(patternSource)) : null;

  if (patternSource && regexResult?.error) {
    return { ok: false, code: "pattern_invalid", message: `正規表現が不正です: ${regexResult.error}` };
  }

  if (field.required && isEmpty(field, value)) {
    return { ok: false, code: "required", message: "入力は必須です" };
  }

  if (isEmpty(field, value)) {
    return { ok: true, code: "", message: "" };
  }

  if (field.type === "text") {
    const maxLength = getMaxLength(field);
    if (maxLength !== null && String(value).length > maxLength) {
      return {
        ok: false,
        code: "max_length",
        message: `最大文字数を超えています（最大: ${maxLength}文字）`,
      };
    }
  }

  if (patternSource && regexResult?.re && !regexResult.re.test(String(value))) {
    return {
      ok: false,
      code: "pattern_mismatch",
      message: `入力がパターンに一致しません: /${patternSource}/`,
    };
  }

  if (field.type === "number") {
    return validateNumberField(field, value);
  }

  if (field.type === "email") {
    return validateEmailAddress(value);
  }

  if (field.type === "url" && !URL_REGEX.test(String(value))) {
    return {
      ok: false,
      code: "url_invalid",
      message: "URLの形式が正しくありません",
    };
  }

  if (field.type === "phone") {
    const phoneRegex = getPhoneRegex(field);
    if (!phoneRegex.test(String(value))) {
      return {
        ok: false,
        code: "phone_invalid",
        message: "電話番号の形式が正しくありません",
      };
    }
  }

  return { ok: true, code: "", message: "" };
};

export const collectValidationErrors = (fields, responses) => {
  const errors = [];

  traverseSchema(fields, (field, context) => {
    if (field?.type === "printTemplate") return;
    const value = responses?.[field.id];
    const regexResult = patternEnabled(field) ? getRegexResult(getPatternSource(field)) : null;
    const result = validateByPattern(field, value, regexResult);
    if (result.ok) return;

    errors.push({
      fieldId: field.id,
      path: context.pathSegments.join(" > "),
      type: result.code || "invalid",
      message: result.code === "required" ? "必須項目が未入力です" : result.message,
    });
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

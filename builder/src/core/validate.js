import { traverseSchema } from "./schemaUtils.js";
import { getPhoneRegex } from "./phone.js";
import { toFiniteNumberOrNull as toFiniteNumberSetting } from "../utils/numbers.js";

const regexCache = new Map();
const NUMBER_INTEGER_DRAFT_REGEX = /^-?\d*$/;
const NUMBER_DECIMAL_DRAFT_REGEX = /^-?\d*(?:\.\d*)?$/;
const NUMBER_NONNEGATIVE_DRAFT_REGEX = /^\d*$/;
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

export const NUMBER_MODES = ["unrestricted", "integer", "nonNegativeInteger", "naturalNumber"];
export const DEFAULT_NUMBER_MODE = "unrestricted";

// モードごとの制約。integer=整数限定か / floor=最小値の下限（null は下限なし） /
// minRequired=最小値の入力必須か / minDefault=モード選択時に最小値ボックスへ入れる初期値。
export const NUMBER_MODE_CONFIG = {
  unrestricted: { integer: false, floor: null, minRequired: false, minDefault: null },
  integer: { integer: true, floor: null, minRequired: false, minDefault: null },
  nonNegativeInteger: { integer: true, floor: 0, minRequired: true, minDefault: 0 },
  naturalNumber: { integer: true, floor: 1, minRequired: true, minDefault: 1 },
};

export const getNumberMode = (field) => {
  const mode = field?.numberMode;
  return NUMBER_MODES.includes(mode) ? mode : DEFAULT_NUMBER_MODE;
};

export const isNumberInputDraftAllowed = (value, mode = DEFAULT_NUMBER_MODE) => {
  const source = typeof value === "string" ? value : String(value ?? "");
  if (mode === "integer") return NUMBER_INTEGER_DRAFT_REGEX.test(source);
  if (mode === "nonNegativeInteger" || mode === "naturalNumber") return NUMBER_NONNEGATIVE_DRAFT_REGEX.test(source);
  return NUMBER_DECIMAL_DRAFT_REGEX.test(source);
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

  // 整数限定モード（整数 / ０と自然数 / 自然数）は整数のみ許可。
  // 下限・上限（0以上 / 1以上 を含む）はモード選択時に最小値ボックスへ反映されるため、
  // ここでは最小値/最大値チェックに一本化する（下の min/max を参照）。
  if (NUMBER_MODE_CONFIG[getNumberMode(field)].integer) {
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

// 数値フィールドの「設定」を検証する（回答ではなくフォーム保存時のフィールド設定チェック）。
// { ok, message } を返す。NumberSettingsInput のインライン表示と保存時バリデーションで共用。
export const checkNumberFieldConfig = (field) => {
  const cfg = NUMBER_MODE_CONFIG[getNumberMode(field)];
  const minValue = toFiniteNumberSetting(field?.minValue);
  const maxValue = toFiniteNumberSetting(field?.maxValue);
  const floorLabel = cfg.floor === null ? "" : `${cfg.floor}以上`;

  if (cfg.minRequired && minValue === null) {
    return { ok: false, message: "最小値を入力してください" };
  }
  if (cfg.integer) {
    if (minValue !== null && !Number.isInteger(minValue)) {
      return { ok: false, message: "最小値は整数で入力してください" };
    }
    if (maxValue !== null && !Number.isInteger(maxValue)) {
      return { ok: false, message: "最大値は整数で入力してください" };
    }
  }
  if (cfg.floor !== null) {
    if (minValue !== null && minValue < cfg.floor) {
      return { ok: false, message: `最小値は${floorLabel}で入力してください` };
    }
    if (maxValue !== null && maxValue < cfg.floor) {
      return { ok: false, message: `最大値は${floorLabel}で入力してください` };
    }
  }
  if (minValue !== null && maxValue !== null && minValue > maxValue) {
    return { ok: false, message: "最小値は最大値以下にしてください" };
  }
  return { ok: true, message: "" };
};

const isEmpty = (field, value) => {
  if (value === undefined || value === null) return true;
  if (field.type === "printTemplate") return true;
  if (field.type === "checkboxes") {
    return !Array.isArray(value) || value.length === 0;
  }
  return value === "";
};

// フィールド型ごとの値バリデータ。共通の必須/空欄/パターン検査を通過したあとに呼ばれる。
// text の最大文字数チェックはパターン検査より前に行う必要があるため、ここには含めず本体に残す。
const TYPE_VALUE_VALIDATORS = {
  number: (field, value) => validateNumberField(field, value),
  email: (_field, value) => validateEmailAddress(value),
  url: (_field, value) =>
    URL_REGEX.test(String(value))
      ? { ok: true, code: "", message: "" }
      : { ok: false, code: "url_invalid", message: "URLの形式が正しくありません" },
  phone: (field, value) =>
    getPhoneRegex(field).test(String(value))
      ? { ok: true, code: "", message: "" }
      : { ok: false, code: "phone_invalid", message: "電話番号の形式が正しくありません" },
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

  const typeValidator = TYPE_VALUE_VALIDATORS[field.type];
  if (typeValidator) return typeValidator(field, value);

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

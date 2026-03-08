export const PHONE_FORMAT_HYPHEN = "hyphen";
export const PHONE_FORMAT_PLAIN = "plain";

const FIXED_LINE_EXCLUSION = "(?:50|70|80|90|120|570|800)";

export const normalizePhoneSettings = (field = {}) => ({
  phoneFormat: field.phoneFormat === PHONE_FORMAT_PLAIN ? PHONE_FORMAT_PLAIN : PHONE_FORMAT_HYPHEN,
  allowFixedLineOmitAreaCode: !!field.allowFixedLineOmitAreaCode,
  allowMobile: field.allowMobile !== false,
  allowIpPhone: field.allowIpPhone !== false,
  allowTollFree: field.allowTollFree !== false,
  autoFillUserPhone: !!field.autoFillUserPhone,
});

export const normalizeDomesticPhoneDigits = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("81")) {
    digits = `0${digits.slice(2)}`;
  } else if (digits.startsWith("0081")) {
    digits = `0${digits.slice(4)}`;
  }

  return digits;
};

const buildFixedLinePattern = (format, allowOmitAreaCode) => {
  const exclusion = `(?!${FIXED_LINE_EXCLUSION})`;
  const withAreaCode = format === PHONE_FORMAT_HYPHEN
    ? [
        `0${exclusion}\\d-\\d{4}-\\d{4}`,
        `0${exclusion}\\d{2}-\\d{3}-\\d{4}`,
        `0${exclusion}\\d{3}-\\d{2}-\\d{4}`,
        `0${exclusion}\\d{4}-\\d-\\d{4}`,
      ]
    : [`0${exclusion}\\d{9}`];

  if (!allowOmitAreaCode) return withAreaCode;

  const localOnly = format === PHONE_FORMAT_HYPHEN
    ? ["\\d{2,4}-\\d{4}"]
    : ["\\d{6,8}"];

  return allowOmitAreaCode ? [...withAreaCode, ...localOnly] : withAreaCode;
};

export const buildPhonePattern = (field = {}) => {
  const settings = normalizePhoneSettings(field);
  const patterns = [];

  if (settings.allowMobile) {
    patterns.push(settings.phoneFormat === PHONE_FORMAT_HYPHEN
      ? "(?:090|080|070)-\\d{4}-\\d{4}"
      : "(?:090|080|070)\\d{8}");
  }

  if (settings.allowIpPhone) {
    patterns.push(settings.phoneFormat === PHONE_FORMAT_HYPHEN
      ? "050-\\d{4}-\\d{4}"
      : "050\\d{8}");
  }

  if (settings.allowTollFree) {
    patterns.push(settings.phoneFormat === PHONE_FORMAT_HYPHEN
      ? "0120-\\d{3}-\\d{3}"
      : "0120\\d{6}");
  }

  patterns.push(...buildFixedLinePattern(settings.phoneFormat, settings.allowFixedLineOmitAreaCode));
  return `^(?:${patterns.join("|")})$`;
};

export const getPhoneRegex = (field = {}) => new RegExp(buildPhonePattern(field));

const formatLocalNumber = (digits) => {
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, digits.length - 4)}-${digits.slice(-4)}`;
};

const formatHyphenatedPhone = (digits) => {
  if (!digits) return "";

  if (/^(090|080|070|050)\d{8}$/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  if (/^0120\d{6}$/.test(digits)) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  if (/^(03|06)\d{8}$/.test(digits)) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  if (/^0\d{9}$/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  if (/^\d{6,8}$/.test(digits) && !digits.startsWith("0")) {
    return formatLocalNumber(digits);
  }

  return digits;
};

export const formatPhoneValueForField = (value, field = {}) => {
  const digits = normalizeDomesticPhoneDigits(value);
  if (!digits) return "";

  const settings = normalizePhoneSettings(field);
  const formatted = settings.phoneFormat === PHONE_FORMAT_PLAIN
    ? digits
    : formatHyphenatedPhone(digits);

  return getPhoneRegex(field).test(formatted) ? formatted : "";
};

const PHONE_PLACEHOLDER_EXAMPLES = {
  [PHONE_FORMAT_HYPHEN]: {
    mobile: "090-1234-5678",
    ipPhone: "050-1234-5678",
    tollFree: "0120-123-456",
    fixedLine: "011-211-2111",
    fixedLineLocalOnly: "211-2111",
  },
  [PHONE_FORMAT_PLAIN]: {
    mobile: "09012345678",
    ipPhone: "05012345678",
    tollFree: "0120123456",
    fixedLine: "0112112111",
    fixedLineLocalOnly: "2112111",
  },
};

export const getStandardPhonePlaceholder = (field = {}) => {
  const settings = normalizePhoneSettings(field);
  const exampleSet = PHONE_PLACEHOLDER_EXAMPLES[settings.phoneFormat];
  const examples = [];

  if (settings.allowMobile) {
    examples.push(exampleSet.mobile);
  }
  if (settings.allowIpPhone) {
    examples.push(exampleSet.ipPhone);
  }
  if (settings.allowTollFree) {
    examples.push(exampleSet.tollFree);
  }

  examples.push(settings.allowFixedLineOmitAreaCode ? exampleSet.fixedLineLocalOnly : exampleSet.fixedLine);

  return `${examples.join(" 、 ")} など`;
};

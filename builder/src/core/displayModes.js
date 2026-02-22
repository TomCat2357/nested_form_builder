const TRUE_LIKE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_LIKE_VALUES = new Set(["false", "0", "no", "off", ""]);

const toBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (TRUE_LIKE_VALUES.has(normalized)) return true;
    if (FALSE_LIKE_VALUES.has(normalized)) return false;
  }
  return !!value;
};

/**
 * 表示可否を isDisplayed に正規化して解決する。
 * 旧データ移行ルール:
 * 1. isDisplayed が存在する場合はその値を採用
 * 2. displayMode が存在する場合は "none" 以外を true
 * 3. important が存在する場合は truthy を true
 * 4. 何もなければ false
 */
export const resolveIsDisplayed = (field) => {
  const target = field || {};
  if (Object.prototype.hasOwnProperty.call(target, "isDisplayed")) {
    return toBoolean(target.isDisplayed);
  }
  if (Object.prototype.hasOwnProperty.call(target, "displayMode")) {
    const rawMode = target.displayMode;
    if (typeof rawMode === "string") {
      return rawMode.toLowerCase() !== "none";
    }
    return rawMode !== "none";
  }
  if (Object.prototype.hasOwnProperty.call(target, "important")) {
    return toBoolean(target.important);
  }
  return false;
};

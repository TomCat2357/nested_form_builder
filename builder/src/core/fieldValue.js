/**
 * 入力タイプのフィールドに値が入っているかを判定する（フロント独立実装）。
 * 旧 pipeEngine.fieldHasValue を移植。
 */
export const fieldHasValue = (field, value) => {
  if (!field || typeof field !== "object") return false;
  const type = field.type;
  if (type === "text" || type === "email" || type === "url") {
    return typeof value === "string" && value.replace(/^\s+|\s+$/g, "") !== "";
  }
  if (type === "phone") {
    if (typeof value !== "string") return false;
    return value.replace(/[\s\-()]/g, "") !== "";
  }
  if (type === "number") {
    if (value === "" || value === null || value === undefined) return false;
    return !isNaN(Number(value));
  }
  if (type === "date" || type === "time") {
    return typeof value === "string" && value !== "";
  }
  if (type === "fileUpload") {
    return Array.isArray(value) && value.length > 0;
  }
  return false;
};

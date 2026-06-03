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

/**
 * 無条件子質問（field.children）を表示・走査すべきかを判定する。
 * message は「回答」概念を持たず値が入らないため、子質問は常に表示する（無条件）。
 * それ以外の入力タイプは値が入っているとき（fieldHasValue）に表示する。
 * 子降下を判定する全箇所（traverseSchema / FieldRenderer / printDocument）で共有し、
 * GAS 双子 nfbShouldShowUnconditionalChildren_（gas/schemaUtils.gs）と挙動を揃える。
 */
export const shouldShowUnconditionalChildren = (field, value) =>
  (field && field.type === "message") || fieldHasValue(field, value);

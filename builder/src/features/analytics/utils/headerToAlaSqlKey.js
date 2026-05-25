/**
 * GAS から届く column.key（パイプ区切り）を AlaSQL 安全な列名に変換する。
 * 例: "基本情報|区" → "基本情報__区"
 * 固定列（id, createdAt 等）はそのまま返す。
 */
export function headerKeyToAlaSqlKey(key) {
  if (!key) return "";
  return key.replace(/\|/g, "__");
}

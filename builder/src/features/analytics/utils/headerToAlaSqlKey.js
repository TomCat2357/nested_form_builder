/**
 * GAS から届く column.key（パイプ区切り）を AlaSQL 安全な列名に変換する。
 * 例: "基本情報|区" → "基本情報__区"
 * 固定列（id, createdAt 等）はそのまま返す。
 */
export function headerKeyToAlaSqlKey(key) {
  if (!key) return "";
  return key.replace(/\|/g, "__");
}

/**
 * AlaSQL キー → パイプ区切りキー（逆変換）
 */
export function alaSqlKeyToHeaderKey(alaSqlKey) {
  if (!alaSqlKey) return "";
  return alaSqlKey.replace(/__/g, "|");
}

/**
 * スナップショットの columns 配列から
 * { headerKey → alaSqlKey } のマップを返す
 */
export function buildKeyMap(columns) {
  const map = {};
  for (const col of columns) {
    map[col.key] = headerKeyToAlaSqlKey(col.key);
  }
  return map;
}

import { headerKeyToAlaSqlKey } from "./headerToAlaSqlKey.js";

/**
 * 列指向スナップショット → AlaSQL に渡す行オブジェクト配列に変換する。
 * 列名は AlaSQL 安全なキー（パイプを __ に変換）を使用。
 */
export function snapshotToRows(snapshot) {
  if (!snapshot || !snapshot.columns || snapshot.columns.length === 0) return [];

  const columns = snapshot.columns;
  const rowCount = columns[0].values.length;
  if (rowCount === 0) return [];

  const rows = new Array(rowCount);
  for (let r = 0; r < rowCount; r++) {
    rows[r] = {};
  }

  for (const col of columns) {
    const alaSqlKey = headerKeyToAlaSqlKey(col.key);
    const values = col.values;
    for (let r = 0; r < rowCount; r++) {
      rows[r][alaSqlKey] = values[r];
    }
  }

  return rows;
}

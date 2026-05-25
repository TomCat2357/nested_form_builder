/**
 * lat/lng を持つ rows をグリッドセルに集計する (Grid Map 用)。
 *
 * @param {Array<Object>} rows
 * @param {string} latField
 * @param {string} lngField
 * @param {string} valueField   集計値の列 (空なら count)
 * @param {number} gridSize     1 セルの度数 (例: 0.1 → 約 11km)
 *
 * @returns {Array<{
 *   south: number, west: number, north: number, east: number,
 *   centerLat: number, centerLng: number,
 *   count: number, sum: number, value: number,
 * }>}
 *   value は valueField があれば sum、無ければ count。
 */
export function computeGridMap(rows, latField, lngField, valueField, gridSize) {
  const out = [];
  if (!Array.isArray(rows) || rows.length === 0 || !latField || !lngField) return out;
  const cell = Number(gridSize) > 0 ? Number(gridSize) : 0.1;
  const useCount = !valueField;
  const buckets = new Map(); // "row,col" → bucket

  for (const r of rows) {
    if (!r) continue;
    const lat = Number(r[latField]);
    const lng = Number(r[lngField]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const rowIdx = Math.floor(lat / cell);
    const colIdx = Math.floor(lng / cell);
    const key = rowIdx + "," + colIdx;
    let b = buckets.get(key);
    if (!b) {
      b = {
        south: rowIdx * cell,
        west: colIdx * cell,
        north: (rowIdx + 1) * cell,
        east: (colIdx + 1) * cell,
        count: 0,
        sum: 0,
      };
      b.centerLat = (b.south + b.north) / 2;
      b.centerLng = (b.west + b.east) / 2;
      buckets.set(key, b);
    }
    b.count += 1;
    if (!useCount) {
      const v = Number(r[valueField]);
      if (Number.isFinite(v)) b.sum += v;
    }
  }

  for (const b of buckets.values()) {
    b.value = useCount ? b.count : b.sum;
    out.push(b);
  }
  return out;
}

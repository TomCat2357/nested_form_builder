/**
 * フラットな rows から ECharts sankey 用の {nodes, links} を生成する。
 *
 * @param {Array<Object>} rows
 * @param {string} sourceField
 * @param {string} targetField
 * @param {string} valueField   数値列 (空なら 1 = フロー本数)
 *
 * @returns {{ nodes: Array<{name: string}>, links: Array<{source, target, value}> }}
 *
 * 同じ (source, target) 組のフローは合算する。
 * source === target の自己ループは除外する (ECharts sankey で循環エラーを避ける)。
 */
import { stringifyKey, rowValueOrCount } from "./computeShared.js";

export function buildSankeyData(rows, sourceField, targetField, valueField) {
  const result = { nodes: [], links: [] };
  if (!Array.isArray(rows) || rows.length === 0 || !sourceField || !targetField) return result;

  const linkMap = new Map(); // "src→tgt" → value
  const nodeSet = new Set();
  const nodeOrder = [];

  for (const r of rows) {
    if (!r) continue;
    const src = stringifyKey(r[sourceField]);
    const tgt = stringifyKey(r[targetField]);
    if (src === tgt) continue;
    const v = rowValueOrCount(r, valueField);
    if (v <= 0) continue;

    if (!nodeSet.has(src)) { nodeSet.add(src); nodeOrder.push(src); }
    if (!nodeSet.has(tgt)) { nodeSet.add(tgt); nodeOrder.push(tgt); }

    const key = src + "→" + tgt;
    linkMap.set(key, (linkMap.get(key) || 0) + v);
  }

  result.nodes = nodeOrder.map((name) => ({ name }));
  for (const [key, value] of linkMap) {
    const idx = key.indexOf("→");
    result.links.push({
      source: key.slice(0, idx),
      target: key.slice(idx + 1),
      value,
    });
  }
  return result;
}

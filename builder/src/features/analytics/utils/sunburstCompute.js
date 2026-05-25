/**
 * フラットな rows から ECharts sunburst 用の階層ツリーを生成する。
 *
 * @param {Array<Object>} rows
 * @param {string[]} levelFields  外側から内側への階層列名 (例: ["国", "都道府県", "市"])
 * @param {string} valueField     葉ノードに割り当てる数値列。空なら 1 (count)
 *
 * @returns {Array<{name, value, children?}>}
 *
 * 各内部ノードの value は子ノード値の合計 (ECharts は省略可だが計算しておくと安定)。
 */
import { stringifyKey, rowValueOrCount } from "./computeShared.js";

export function buildSunburstTree(rows, levelFields, valueField) {
  if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(levelFields) || levelFields.length === 0) {
    return [];
  }

  // map: name -> node (children を Map で持つことで重複登場時の合流が O(1))
  const root = { children: new Map() };

  for (const r of rows) {
    if (!r) continue;
    const v = rowValueOrCount(r, valueField);

    let cur = root;
    for (let i = 0; i < levelFields.length; i++) {
      const key = stringifyKey(r[levelFields[i]]);
      let child = cur.children.get(key);
      if (!child) {
        child = { name: key, value: 0, children: new Map() };
        cur.children.set(key, child);
      }
      child.value += v;
      cur = child;
    }
  }

  return mapToArray(root.children);
}

function mapToArray(m) {
  const arr = [];
  for (const node of m.values()) {
    const children = mapToArray(node.children);
    if (children.length === 0) {
      arr.push({ name: node.name, value: node.value });
    } else {
      arr.push({ name: node.name, value: node.value, children });
    }
  }
  return arr;
}

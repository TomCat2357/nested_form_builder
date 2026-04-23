/**
 * スキーマの木構造を変換・巡回するユーティリティ (フロント側アダプタ)。
 *
 * 実装は gas/pipeEngine.js の nfbResolveOrderedChildKeys_ / nfbTraverseSchema_ /
 * nfbMapSchema_ に集約されており、GAS バックエンド (sheetsHeaders.gs 等) と
 * 結果が一致することを構造的に保証する。このファイルはそれらを named re-export
 * し、schemaUtils 固有の高レベルヘルパ (countSchemaNodes) のみ実装する。
 */

import pipeEngine from "../../../gas/pipeEngine.js";

const {
  resolveOrderedChildKeys: sharedResolveOrderedChildKeys,
  traverseSchema: sharedTraverseSchema,
  mapSchema: sharedMapSchema,
} = pipeEngine;

export const resolveOrderedChildKeys = sharedResolveOrderedChildKeys;

export const mapSchema = (schema, mapper) => sharedMapSchema(schema, mapper);

export const traverseSchema = (schema, visitor, options = {}) =>
  sharedTraverseSchema(schema, visitor, options);

export const countSchemaNodes = (schema) => {
  let count = 0;
  traverseSchema(schema, () => { count++; });
  return count;
};

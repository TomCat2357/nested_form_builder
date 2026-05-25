/**
 * スキーマの木構造を変換・巡回するユーティリティ（フロント独立実装）。
 *
 * 旧 pipeEngine の nfbResolveOrderedChildKeys_ / nfbTraverseSchema_ /
 * nfbMapSchema_ をフロント側に移植。alasql 全面移行に伴い pipeEngine 依存を撤去。
 *
 * GAS 側の双子は gas/schemaUtils.gs（nfbResolveOrderedChildKeys_ /
 * nfbTraverseSchema_ / nfbMapSchema_ / nfbStripSchemaIDs_）。振る舞いを変える場合は
 * 両側を揃えること。等価性は tests/schema-walkers-equivalence.test.cjs で担保。
 */

import { fieldHasValue } from "./fieldValue.js";

/**
 * options ラベル順で childrenByValue のキーを並べ替えて返す。options に無い
 * ラベル (後付け編集でズレた等) は後続に残す。空/非オブジェクトは [] を返す。
 */
export const resolveOrderedChildKeys = (field) => {
  const branches = field && field.childrenByValue;
  if (!branches || typeof branches !== "object" || Array.isArray(branches)) return [];
  const keys = [];
  for (const k in branches) {
    if (Object.prototype.hasOwnProperty.call(branches, k)) keys.push(k);
  }
  if (!keys.length) return [];

  const ordered = [];
  const seen = {};
  const options = (field && Array.isArray(field.options)) ? field.options : [];
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const label = (opt && typeof opt.label === "string") ? opt.label : "";
    if (!label || seen[label] || !Object.prototype.hasOwnProperty.call(branches, label)) continue;
    ordered.push(label);
    seen[label] = true;
  }
  for (let j = 0; j < keys.length; j++) {
    if (seen[keys[j]]) continue;
    ordered.push(keys[j]);
    seen[keys[j]] = true;
  }
  return ordered;
};

const defaultFieldSegment = (field, indexTrail) => {
  const rawLabel = field && field.label !== undefined && field.label !== null
    ? String(field.label) : "";
  const trimmed = rawLabel.replace(/^\s+|\s+$/g, "");
  if (trimmed) return trimmed;
  const type = field && field.type !== undefined && field.type !== null
    ? String(field.type) : "unknown";
  return "質問 " + indexTrail.join(".") + " (" + type + ")";
};

/**
 * Read-only 再帰走査。visitor(field, context) が false を返すとその subtree を
 * 打ち切る。context = { pathSegments, depth, index, indexTrail }。
 */
export const traverseSchema = (schema, visitor, options = {}) => {
  const opts = options || {};
  const hasGetChildKeys = typeof opts.getChildKeys === "function";
  const hasResponses = !!opts.responses;
  const fieldSegmentFn = typeof opts.fieldSegment === "function" ? opts.fieldSegment : null;
  const branchSegmentFn = typeof opts.branchSegment === "function" ? opts.branchSegment : null;

  const walk = (nodes, pathSegments, depth, indexTrail) => {
    const list = Array.isArray(nodes) ? nodes : [];
    for (let i = 0; i < list.length; i++) {
      const field = list[i];
      if (field === undefined || field === null) continue;
      const currentIndexTrail = indexTrail.concat(i + 1);
      const segmentCtx = {
        pathSegments,
        index: i,
        depth,
        indexTrail: currentIndexTrail,
      };
      const segment = fieldSegmentFn
        ? fieldSegmentFn(field, segmentCtx)
        : defaultFieldSegment(field, currentIndexTrail);
      if (segment === null || segment === undefined) continue;
      const currentPath = pathSegments.concat(segment);
      const context = {
        pathSegments: currentPath,
        index: i,
        depth,
        indexTrail: currentIndexTrail,
      };
      const shouldContinue = visitor(field, context);
      if (shouldContinue === false) continue;

      if (field.childrenByValue && typeof field.childrenByValue === "object"
          && !Array.isArray(field.childrenByValue)) {
        let childKeys;
        if (hasGetChildKeys) {
          const custom = opts.getChildKeys(field, context);
          childKeys = Array.isArray(custom) ? custom : [];
        } else if (hasResponses) {
          const value = opts.responses[field.id];
          if (field.type === "checkboxes" && Array.isArray(value)) {
            const selected = {};
            for (let s = 0; s < value.length; s++) selected[value[s]] = true;
            const all = resolveOrderedChildKeys(field);
            childKeys = [];
            for (let a = 0; a < all.length; a++) {
              if (selected[all[a]]) childKeys.push(all[a]);
            }
          } else if ((field.type === "radio" || field.type === "select")
                     && typeof value === "string" && value) {
            childKeys = field.childrenByValue[value] ? [value] : [];
          } else {
            childKeys = [];
          }
        } else {
          childKeys = resolveOrderedChildKeys(field);
        }

        for (let ci = 0; ci < childKeys.length; ci++) {
          const key = childKeys[ci];
          const branchSegment = branchSegmentFn ? branchSegmentFn(key, field, context) : key;
          const childPath = (branchSegment === null || branchSegment === undefined)
            ? currentPath : currentPath.concat(branchSegment);
          walk(field.childrenByValue[key], childPath, depth + 1, currentIndexTrail);
        }
      }

      if (Array.isArray(field.children) && field.children.length > 0) {
        let traverseChildren = true;
        if (hasResponses) {
          const inputValue = opts.responses[field.id];
          traverseChildren = fieldHasValue(field, inputValue);
        }
        if (traverseChildren) {
          walk(field.children, currentPath, depth + 1, currentIndexTrail);
        }
      }
    }
  };

  walk(Array.isArray(schema) ? schema : [], [], 1, []);
};

/**
 * スキーマを mapper で再帰変換する。
 */
export const mapSchema = (schema, mapper) => {
  const walk = (nodes, pathSegments, depth) => {
    const list = Array.isArray(nodes) ? nodes : [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const field = list[i];
      const rawLabel = field && field.label !== undefined && field.label !== null
        ? String(field.label) : "";
      const trimmed = rawLabel.replace(/^\s+|\s+$/g, "");
      const currentPath = pathSegments.concat(trimmed);
      const context = { pathSegments: currentPath, index: i, depth };
      const newField = mapper(field, context);
      if (newField && newField.childrenByValue && typeof newField.childrenByValue === "object"
          && !Array.isArray(newField.childrenByValue)) {
        const newChildren = {};
        const orderedKeys = resolveOrderedChildKeys(newField);
        for (let k = 0; k < orderedKeys.length; k++) {
          const optLabel = orderedKeys[k];
          newChildren[optLabel] = walk(
            newField.childrenByValue[optLabel],
            currentPath.concat(optLabel),
            depth + 1,
          );
        }
        newField.childrenByValue = newChildren;
      }
      if (newField && Array.isArray(newField.children)) {
        newField.children = walk(newField.children, currentPath, depth + 1);
      }
      out.push(newField);
    }
    return out;
  };
  return walk(Array.isArray(schema) ? schema : [], [], 1);
};

export const countSchemaNodes = (schema) => {
  let count = 0;
  traverseSchema(schema, () => { count++; });
  return count;
};

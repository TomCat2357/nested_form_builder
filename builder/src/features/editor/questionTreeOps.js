import { deepClone, supportsChildren } from "../../core/schema.js";
import { isChoiceType } from "./fieldTypes.js";

/**
 * 指定フィールドが子質問を受け入れられるか判定する。
 * - 選択肢型: 子は選択肢ごと(childrenByValue)に紐づくため、選択肢が1つ以上必要。
 * - 非選択肢型: supportsChildren が true のタイプのみ。
 */
export function canAcceptChildren(field) {
  if (!field || typeof field !== "object") return false;
  if (isChoiceType(field.type)) return (field.options?.length || 0) > 0;
  return supportsChildren(field.type);
}

/**
 * fields[index] を、すぐ上の兄弟 fields[index-1] の子質問として降格させる。
 * - 上の兄弟が選択肢型なら最後の選択肢の childrenByValue 配下へ。
 * - それ以外（子を持てるタイプ）なら children 末尾へ。
 * 降格できない場合（先頭要素、上の兄弟が子を持てない）は null を返す。
 * @returns {Array|null} 変更後の新しい配列、または null
 */
export function demoteIntoPrevSibling(fields, index) {
  if (!Array.isArray(fields)) return null;
  if (index <= 0 || index >= fields.length) return null;
  const target = fields[index - 1];
  if (!canAcceptChildren(target)) return null;

  const next = deepClone(fields);
  const [moving] = next.splice(index, 1);
  const targetNode = next[index - 1];

  if (isChoiceType(targetNode.type)) {
    const key = targetNode.options[targetNode.options.length - 1].label;
    targetNode.childrenByValue = targetNode.childrenByValue || {};
    targetNode.childrenByValue[key] = [...(targetNode.childrenByValue[key] || []), moving];
  } else {
    targetNode.children = [...(targetNode.children || []), moving];
  }
  return next;
}

/**
 * 親 fields[parentIndex] の子質問を1つ取り出し、親の直後（同じ階層）へ昇格させる。
 * 子の取り出しは removeChild(parentClone) に委譲する（children / childrenByValue の差異を吸収）。
 * removeChild は親のクローンを破壊的に変更し、取り出した子フィールドを返すこと。
 * @returns {Array|null} 変更後の新しい配列、または取り出せなかった場合 null
 */
export function promoteChildToParentLevel(fields, parentIndex, removeChild) {
  if (!Array.isArray(fields)) return null;
  if (parentIndex < 0 || parentIndex >= fields.length) return null;
  const next = deepClone(fields);
  const parent = next[parentIndex];
  const child = removeChild(parent);
  if (!child) return null;
  next.splice(parentIndex + 1, 0, child);
  return next;
}

/**
 * 単一レコードの計算/置換フィールドを「保存値が空かつ動的計算で非空値が得られる」欄だけ補完し、
 * modifiedAt / modifiedAtUnixMs / modifiedBy を更新した新しいレコードを返す純粋関数。
 *
 * 補完対象が存在しない、または動的計算値が全て空だった場合は null を返す。
 * 書き戻し（upsertRecordInCache）や同期トリガは呼び出し側の責務。
 */

import {
  buildComputedFieldPathsById,
  buildLabelValueMapFromEntryData,
  evaluateAllComputedFields,
} from "../../core/computedFields.js";

const isEmptyValue = (value) => value === undefined || value === null || value === "";

export const buildBackfilledRecord = (schema, record, { now = Date.now(), userEmail = "" } = {}) => {
  const pathsById = buildComputedFieldPathsById(schema);
  const fieldIds = Object.keys(pathsById);
  if (fieldIds.length === 0) return null;

  const data = record?.data && typeof record.data === "object" ? record.data : {};
  const missing = fieldIds.filter((fid) => isEmptyValue(data[pathsById[fid]]));
  if (missing.length === 0) return null;

  const baseLabelValueMap = buildLabelValueMapFromEntryData(schema, data);
  const { computedValues } = evaluateAllComputedFields(schema, null, baseLabelValueMap);

  const nextData = { ...data };
  const nextOrder = Array.isArray(record?.order) ? [...record.order] : Object.keys(nextData);
  let changed = false;
  for (const fid of missing) {
    const path = pathsById[fid];
    const value = computedValues[fid];
    if (isEmptyValue(value)) continue;
    nextData[path] = String(value);
    if (!nextOrder.includes(path)) nextOrder.push(path);
    changed = true;
  }
  if (!changed) return null;

  return {
    ...record,
    data: nextData,
    order: nextOrder,
    modifiedAt: now,
    modifiedAtUnixMs: now,
    modifiedBy: userEmail || record?.modifiedBy || "",
  };
};

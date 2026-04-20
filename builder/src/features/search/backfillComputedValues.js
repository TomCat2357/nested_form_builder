/**
 * 単一レコードの計算/置換フィールドを「保存値が空かつ動的計算で非空値が得られる」欄だけ補完し、
 * modifiedAt / modifiedAtUnixMs / modifiedBy を更新した新しいレコードを返す純粋関数。
 *
 * 補完対象が存在しない、または動的計算値が全て空だった場合は null を返す。
 * 書き戻し（upsertRecordInCache）や同期トリガは呼び出し側の責務。
 */

import { backfillComputedFieldValues } from "../../core/computedFields.js";

export const buildBackfilledRecord = (schema, record, { now = Date.now(), userEmail = "" } = {}) => {
  const baseData = record?.data && typeof record.data === "object" ? record.data : {};
  const { data, changed, newPaths } = backfillComputedFieldValues(schema, baseData);
  if (!changed) return null;

  const nextOrder = Array.isArray(record?.order) ? [...record.order] : Object.keys(data);
  for (const path of newPaths) {
    if (!nextOrder.includes(path)) nextOrder.push(path);
  }

  return {
    ...record,
    data,
    order: nextOrder,
    modifiedAt: now,
    modifiedAtUnixMs: now,
    modifiedBy: userEmail || record?.modifiedBy || "",
  };
};

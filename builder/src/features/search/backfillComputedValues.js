/**
 * キャッシュ上の全レコードを走査し、計算/置換フィールドの保存値が空のものを
 * 動的計算で補完する。補完が発生したレコードは modifiedAt を現在時刻に更新し
 * キャッシュへ書き戻す。
 *
 * その後の差分同期（syncRecordsProxy）で buildUploadRecordsForSync が
 * modifiedAtUnixMs > baseServerReadAt のレコードをピックアップしてバックエンド
 * のスプレッドシートへ送信するため、この関数は送信そのものは行わない。
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

export const backfillComputedValuesInCache = async ({
  formId,
  schema,
  userEmail = "",
  getRecordsFromCache,
  upsertRecordInCache,
  now = Date.now(),
} = {}) => {
  if (!formId || !Array.isArray(schema) || schema.length === 0) {
    return { updatedCount: 0 };
  }
  const pathsById = buildComputedFieldPathsById(schema);
  if (Object.keys(pathsById).length === 0) {
    return { updatedCount: 0 };
  }

  const { entries, headerMatrix, schemaHash } = await getRecordsFromCache(formId);
  if (!Array.isArray(entries) || entries.length === 0) {
    return { updatedCount: 0 };
  }

  let updatedCount = 0;
  for (const entry of entries) {
    const next = buildBackfilledRecord(schema, entry, { now, userEmail });
    if (!next) continue;
    await upsertRecordInCache(formId, next, { headerMatrix, schemaHash });
    updatedCount += 1;
  }
  return { updatedCount };
};

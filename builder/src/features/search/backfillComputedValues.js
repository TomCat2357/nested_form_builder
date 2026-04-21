/**
 * backfillComputedFieldValues() の計算結果を受け取り、レコードのメタ情報
 * （modifiedAt / modifiedAtUnixMs / modifiedBy / order）を更新した
 * 新しいレコードを返す純粋関数。
 *
 * 計算結果が changed === false の場合（補完対象なし、または全て空）は null を返す。
 * 書き戻し（upsertRecordInCache）や同期トリガは呼び出し側の責務。
 */

export const buildBackfilledRecord = (record, backfillResult, { now = Date.now(), userEmail = "" } = {}) => {
  if (!backfillResult || !backfillResult.changed) return null;

  const { data, newPaths } = backfillResult;
  const nextOrder = Array.isArray(record?.order) ? [...record.order] : Object.keys(data);
  for (const path of newPaths || []) {
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

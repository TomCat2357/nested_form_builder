/**
 * backfillComputedFieldValues() の計算結果を受け取り、レコードのメタ情報
 * （modifiedAt / modifiedAtUnixMs / modifiedBy / order）を更新した
 * 新しいレコードを返す純粋関数。
 *
 * 計算結果が changed === false の場合（補完対象なし、または全て空）は null を返す。
 * 書き戻し（upsertRecordInCache）や同期トリガは呼び出し側の責務。
 */

import { ensureArray } from "../../utils/arrays.js";

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

// ---------------------------------------------------------------------------
// 置換再計算の書き戻し冪等化メモ。
//   子データ / full-query 依存の置換値は一覧表示のたびに再計算され、buildBackfilledRecord で
//   modifiedAt = now を打刻して書き戻される。これは「未アップロード」と数えられるため、同じ計算値を
//   毎サイクル打ち直すと（往復後の保存値が一致しないケースなどで）警告が永久に再武装する。
//   そこで「(recordId, path) → 直近に書き戻した計算値」をセッション内メモに保持し、同じ値なら
//   再打刻しない。push 機構（modifiedAt > lastServerReadAt）には干渉せず、再打刻だけを抑止する。
// memo は Map<string,string>。キーは recordId と path を空白で連結（recordId は ULID なので空白を含まず一意）。
// ---------------------------------------------------------------------------

const computedMemoKey = (recordId, path) => `${recordId} ${path}`;

// changedPaths のうち「まだ同じ値を書き戻していない」path だけを返す（= 今回書く価値がある path）。
export const selectFreshComputedWritePaths = (recordId, changedPaths, data, memo) =>
  (ensureArray(changedPaths)).filter(
    (path) => memo.get(computedMemoKey(recordId, path)) !== String(data?.[path]),
  );

// 書き戻した計算値をメモへ記録する（次サイクル以降の再打刻抑止に使う）。
export const rememberComputedWrites = (recordId, changedPaths, data, memo) => {
  for (const path of (ensureArray(changedPaths))) {
    memo.set(computedMemoKey(recordId, path), String(data?.[path]));
  }
};

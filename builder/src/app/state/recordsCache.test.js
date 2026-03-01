import test from "node:test";
import assert from "node:assert/strict";
import { MS_PER_DAY, SERIAL_EPOCH_UTC_MS, JST_OFFSET_MS } from "../../core/constants.js";
import { planRecordMerge } from "./recordsCache.js";

const serialToUnixMs = (serial) => (SERIAL_EPOCH_UTC_MS - JST_OFFSET_MS) + serial * MS_PER_DAY;

const cacheRecord = (entryId, modifiedAtUnixMs) => ({
  entryId,
  compoundId: `form::${entryId}`,
  modifiedAtUnixMs,
});

const incomingRecord = (id, modifiedAtUnixMs) => ({
  id,
  modifiedAtUnixMs,
});

test("共通IDはmodifiedAtが新しい側のみ更新対象になる（同値はスプレッドシート優先）", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("a", 46000), cacheRecord("b", 46005)],
    incomingRecords: [incomingRecord("a", 46001), incomingRecord("b", 46005)],
  });

  assert.deepEqual(plan.commonUpdateIds, ["a", "b"]);
  assert.deepEqual(plan.cacheOnlyDeleteIds, []);
  assert.deepEqual(plan.incomingOnlyAddIds, []);
});

test("tombstone方式: キャッシュのみに存在するIDはcacheOnlyDeleteIdsに入らない（allIds集合差分廃止）", () => {
  // 削除は deletedAt tombstone として差分に乗るため、欠落を根拠にした削除は行わない
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("cacheOnly", 46000)],
    incomingRecords: [incomingRecord("shared", 46002)],
    sheetLastUpdatedAt: 46010,
    lastFrontendMutationAt: 46005,
  });

  assert.deepEqual(plan.cacheOnlyDeleteIds, []);
});

test("incoming-only ID はスプレッドシート更新時刻がフロント更新時刻以上なら追加対象", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("cacheLatest", 46003)],
    incomingRecords: [incomingRecord("incomingOnly", 46004)],
    sheetLastUpdatedAt: 46010,
    lastFrontendMutationAt: 46005,
  });

  assert.deepEqual(plan.incomingOnlyAddIds, ["incomingOnly"]);
});

test("modifiedAtの単位がserialとunix msで混在しても比較できる", () => {
  const cacheSerial = 46000;
  const incomingMs = serialToUnixMs(46001);
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("mixed", cacheSerial)],
    incomingRecords: [incomingRecord("mixed", incomingMs)],
  });

  assert.deepEqual(plan.commonUpdateIds, ["mixed"]);
});

test("差分同期でキャッシュにないIDがincomingに存在しなくてもキャッシュを保持する", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("keep_1", 46000), cacheRecord("keep_2", 46005)],
    incomingRecords: [],
    sheetLastUpdatedAt: 46010,
    lastFrontendMutationAt: 46001,
  });

  assert.deepEqual(plan.cacheOnlyDeleteIds, []);
});

test("更新/追加レコードは反映し、差分にないキャッシュレコードは保持する", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("stable", 46000), cacheRecord("shared", 46001)],
    incomingRecords: [incomingRecord("shared", 46002), incomingRecord("new", 46003)],
    sheetLastUpdatedAt: 46010,
    lastFrontendMutationAt: 46001,
  });

  assert.deepEqual(plan.commonUpdateIds, ["shared"]);
  assert.deepEqual(plan.incomingOnlyAddIds, ["new"]);
  assert.deepEqual(plan.cacheOnlyDeleteIds, []);
});

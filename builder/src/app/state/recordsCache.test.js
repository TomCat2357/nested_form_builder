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
    allIds: ["a", "b"],
  });

  assert.deepEqual(plan.commonUpdateIds, ["a", "b"]);
  assert.deepEqual(plan.cacheOnlyDeleteIds, []);
  assert.deepEqual(plan.incomingOnlyAddIds, []);
});

test("cache-only ID はフロント更新時刻がスプレッドシート更新時刻より古い場合に削除対象", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("cacheOnly", 46000)],
    incomingRecords: [incomingRecord("shared", 46002)],
    allIds: ["shared"],
    sheetLastUpdatedAt: 46010,
    lastFrontendMutationAt: 46005,
  });

  assert.deepEqual(plan.cacheOnlyDeleteIds, ["cacheOnly"]);
});

test("incoming-only ID はスプレッドシート更新時刻がフロント更新時刻以上なら追加対象", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("cacheLatest", 46003)],
    incomingRecords: [incomingRecord("incomingOnly", 46004)],
    allIds: ["cacheLatest", "incomingOnly"],
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
    allIds: ["mixed"],
  });

  assert.deepEqual(plan.commonUpdateIds, ["mixed"]);
});

test("allIdsが未提供の差分は既存キャッシュを削除しない", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("keep_1", 46000), cacheRecord("keep_2", 46005)],
    incomingRecords: [],
    allIds: null,
    sheetLastUpdatedAt: 46010,
    lastFrontendMutationAt: 46001,
  });

  assert.deepEqual(plan.cacheOnlyDeleteIds, []);
});

test("allIds未提供でも更新/追加レコードは反映し、未更新レコードは保持する", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("stable", 46000), cacheRecord("shared", 46001)],
    incomingRecords: [incomingRecord("shared", 46002), incomingRecord("new", 46003)],
    allIds: null,
    sheetLastUpdatedAt: 46010,
    lastFrontendMutationAt: 46001,
  });

  assert.deepEqual(plan.commonUpdateIds, ["shared"]);
  assert.deepEqual(plan.incomingOnlyAddIds, ["new"]);
  assert.deepEqual(plan.cacheOnlyDeleteIds, []);
});

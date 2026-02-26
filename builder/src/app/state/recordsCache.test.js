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

test("共通IDはmodifiedAtが新しい側のみ更新対象になる（同値はキャッシュ優先）", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("a", 46000), cacheRecord("b", 46005)],
    incomingRecords: [incomingRecord("a", 46001), incomingRecord("b", 46005)],
    allIds: ["a", "b"],
  });

  assert.deepEqual(plan.commonUpdateIds, ["a"]);
  assert.deepEqual(plan.cacheOnlyDeleteIds, []);
  assert.deepEqual(plan.incomingOnlyAddIds, []);
});

test("cache-only ID は allIds に存在しない場合、相手側maxより古ければ削除対象になる", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("cacheOld", 46000), cacheRecord("cacheNew", 46010)],
    incomingRecords: [incomingRecord("shared", 46002)],
    allIds: ["shared"],
  });

  assert.deepEqual(plan.cacheOnlyDeleteIds, ["cacheOld"]);
});

test("incoming-only ID は cache 側maxより新しい場合のみ追加対象になる", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("cacheLatest", 46003)],
    incomingRecords: [incomingRecord("incomingOld", 46002), incomingRecord("incomingNew", 46004)],
    allIds: ["cacheLatest", "incomingOld", "incomingNew"],
  });

  assert.deepEqual(plan.incomingOnlyAddIds, ["incomingNew"]);
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

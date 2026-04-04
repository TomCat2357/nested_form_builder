import test from "node:test";
import assert from "node:assert/strict";
import { MS_PER_DAY, SERIAL_EPOCH_UTC_MS, JST_OFFSET_MS } from "../../core/constants.js";
import { getMaxRecordNoFromEntries, normalizeRecordForCache, planRecordMerge } from "./recordsCache.js";

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

test("共通IDはmodifiedAtが新しい側のみ更新対象になる（同値も更新対象に含む）", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("a", 46000), cacheRecord("b", 46005)],
    incomingRecords: [incomingRecord("a", 46001), incomingRecord("b", 46005)],
  });

  assert.deepEqual(plan.commonUpdateIds, ["a", "b"]);
  assert.deepEqual(plan.incomingOnlyAddIds, []);
});

test("incoming-only ID は片側欠落時に常に追加対象（存在側優先）", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("cacheLatest", 46003)],
    incomingRecords: [incomingRecord("incomingOnly", 46004)],
  });

  assert.deepEqual(plan.incomingOnlyAddIds, ["incomingOnly"]);
});

test("incoming-only ID は modifiedAt 未設定でも追加対象（存在側優先）", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("cacheLatest", 46003)],
    incomingRecords: [incomingRecord("incomingNoModifiedAt", 0)],
  });

  assert.deepEqual(plan.incomingOnlyAddIds, ["incomingNoModifiedAt"]);
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
  });

  assert.deepEqual(plan.commonUpdateIds, []);
  assert.deepEqual(plan.incomingOnlyAddIds, []);
});

test("更新/追加レコードは反映し、差分にないキャッシュレコードは保持する", () => {
  const plan = planRecordMerge({
    existingRecords: [cacheRecord("stable", 46000), cacheRecord("shared", 46001)],
    incomingRecords: [incomingRecord("shared", 46002), incomingRecord("new", 46003)],
  });

  assert.deepEqual(plan.commonUpdateIds, ["shared"]);
  assert.deepEqual(plan.incomingOnlyAddIds, ["new"]);
});

test("normalizeRecordForCache は固定列を補完して保持する", () => {
  const record = normalizeRecordForCache({
    id: "rec_1",
    data: { field_a: "value" },
  }, { formId: "form_1" });

  assert.equal(record.id, "rec_1");
  assert.equal(record.formId, "form_1");
  assert.equal(record["No."], "");
  assert.equal(record.createdAt, "");
  assert.equal(record.createdAtUnixMs, null);
  assert.equal(record.modifiedAt, "");
  assert.equal(record.modifiedAtUnixMs, null);
  assert.equal(record.deletedAt, null);
  assert.equal(record.deletedAtUnixMs, null);
  assert.equal(record.createdBy, "");
  assert.equal(record.modifiedBy, "");
  assert.equal(record.deletedBy, "");
  assert.equal(record.driveFolderUrl, "");
  assert.deepEqual(record.data, { field_a: "value" });
  assert.deepEqual(record.dataUnixMs, {});
  assert.deepEqual(record.order, ["field_a"]);
});

test("getMaxRecordNoFromEntries はフォーム全体の最大 No. を返す", () => {
  const maxNo = getMaxRecordNoFromEntries([
    { id: "rec_1", "No.": 1 },
    { id: "rec_2", "No.": 2 },
    { id: "rec_3", "No.": 7 },
  ]);

  assert.equal(maxNo, 7);
});

test("getMaxRecordNoFromEntries は削除済みレコードの No. も再利用しない前提で最大値に含める", () => {
  const maxNo = getMaxRecordNoFromEntries([
    { id: "rec_1", "No.": 2, deletedAt: null },
    { id: "rec_2", "No.": 5, deletedAt: 1700000000000 },
    { id: "rec_3", "No.": 4, deletedAt: null },
  ]);

  assert.equal(maxNo, 5);
});

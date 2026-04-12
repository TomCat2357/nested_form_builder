import test from "node:test";
import assert from "node:assert/strict";
import { getMaxRecordNoFromEntries, normalizeRecordForCache } from "./recordMerge.js";

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

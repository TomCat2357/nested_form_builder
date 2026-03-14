import assert from "node:assert/strict";
import test from "node:test";
import { buildUpsertEntryRecord } from "./dataStore.js";

test("既存レコード更新時は createdAt / createdBy / No. を保持して modifiedAt だけ更新する", () => {
  const existingEntry = {
    id: "rec_existing",
    formId: "form_1",
    "No.": 12,
    createdAt: 1700000000123,
    createdAtUnixMs: 1700000000123,
    modifiedAt: 1700000001123,
    modifiedAtUnixMs: 1700000001123,
    deletedAt: null,
    deletedAtUnixMs: null,
    createdBy: "creator@example.com",
    modifiedBy: "before@example.com",
    deletedBy: "",
    data: { field_a: "before" },
    dataUnixMs: {},
    order: ["field_a"],
  };
  const now = 1700000002222;

  const record = buildUpsertEntryRecord({
    formId: "form_1",
    payload: {
      id: "rec_existing",
      data: { field_a: "after" },
      order: ["field_a"],
      modifiedBy: "editor@example.com",
    },
    existingEntry,
    now,
  });

  assert.equal(record.id, "rec_existing");
  assert.equal(record["No."], 12);
  assert.equal(record.createdAt, 1700000000123);
  assert.equal(record.createdAtUnixMs, 1700000000123);
  assert.equal(record.createdBy, "creator@example.com");
  assert.equal(record.modifiedAt, now);
  assert.equal(record.modifiedAtUnixMs, now);
  assert.equal(record.modifiedBy, "editor@example.com");
  assert.deepEqual(record.data, { field_a: "after" });
  assert.deepEqual(record.order, ["field_a"]);
});

test("新規レコードは createdAt / createdAtUnixMs / createdBy をフロント側で埋める", () => {
  const now = 1700000003333;

  const record = buildUpsertEntryRecord({
    formId: "form_1",
    payload: {
      id: "rec_new",
      data: { field_a: "value" },
      order: ["field_a"],
      createdBy: "",
      modifiedBy: "editor@example.com",
    },
    now,
    nextRecordNo: 5,
  });

  assert.equal(record.id, "rec_new");
  assert.equal(record["No."], 5);
  assert.equal(record.createdAt, now);
  assert.equal(record.createdAtUnixMs, now);
  assert.equal(record.createdBy, "");
  assert.equal(record.modifiedAt, now);
  assert.equal(record.modifiedAtUnixMs, now);
  assert.equal(record.modifiedBy, "editor@example.com");
  assert.equal(record.deletedAt, null);
  assert.equal(record.deletedAtUnixMs, null);
});

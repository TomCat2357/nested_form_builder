import test from "node:test";
import assert from "node:assert/strict";
import { buildUploadRecordsForSync } from "./syncUploadPlan.js";

test("差分同期では lastServerReadAt を超える modifiedAt のみ送信する", () => {
  const records = buildUploadRecordsForSync({
    entries: [
      { id: "old", modifiedAtUnixMs: 1700000000100, createdAtUnixMs: 1700000000000 },
      { id: "new", modifiedAtUnixMs: 1700000002200, createdAtUnixMs: 1700000001200 },
    ],
    baseServerReadAt: 1700000001500,
    forceFullSync: false,
  });

  assert.deepEqual(records.map((record) => record.id), ["new"]);
  assert.equal(records[0].modifiedAt, 1700000002200);
});

test("full sync では削除済みを含むキャッシュ全件を送信する", () => {
  const records = buildUploadRecordsForSync({
    entries: [
      { id: "active", modifiedAtUnixMs: 1700000001000, createdAtUnixMs: 1700000000500, deletedAt: null },
      { id: "deleted", modifiedAtUnixMs: 1700000001200, createdAtUnixMs: 1700000000400, deletedAtUnixMs: 1700000001100, deletedAt: 1700000001100 },
      { id: "no_modified", modifiedAtUnixMs: null, modifiedAt: "", createdAtUnixMs: 1700000000300 },
    ],
    baseServerReadAt: 999999,
    forceFullSync: true,
  });

  assert.deepEqual(records.map((record) => record.id), ["active", "deleted", "no_modified"]);
  assert.equal(records.find((record) => record.id === "deleted")?.deletedAt, 1700000001100);
});

test("送信前に createdAt / modifiedAt / deletedAt の日時を正規化する", () => {
  const records = buildUploadRecordsForSync({
    entries: [
      {
        id: "string_ts",
        createdAt: "2026-03-02T00:00:00.000Z",
        modifiedAt: "2026-03-02T01:02:03.000Z",
        deletedAt: "",
      },
    ],
    forceFullSync: true,
  });

  assert.equal(records.length, 1);
  assert.equal(typeof records[0].createdAt, "number");
  assert.equal(typeof records[0].modifiedAt, "number");
  assert.equal(records[0].deletedAt, null);
});

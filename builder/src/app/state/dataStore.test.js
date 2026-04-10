import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGetEntryFallbackListEntriesOptions,
  buildListEntriesResult,
  buildUpsertEntryRecord,
  normalizeListEntriesOptions,
} from "./dataStore.js";
import { filterExpiredDeletedEntries } from "./dataStoreHelpers.js";

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

test("buildListEntriesResult は unchanged 同期でも削除済みレコードを保持する", () => {
  const deletedEntry = {
    id: "rec_deleted",
    deletedAt: 1700000004000,
    deletedAtUnixMs: 1700000004000,
  };

  const result = buildListEntriesResult({
    entries: [deletedEntry],
    unchanged: true,
    isDelta: true,
    fetchedCount: 0,
    lastSyncedAt: 1700000005000,
    lastSpreadsheetReadAt: 1700000005000,
    sheetLastUpdatedAt: 1700000005000,
  });

  assert.equal(result.unchanged, true);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, "rec_deleted");
  assert.equal(result.entries[0].deletedAtUnixMs, 1700000004000);
});

test("buildListEntriesResult は full sync 相当でも削除済みレコードを保持する", () => {
  const deletedEntry = {
    id: "rec_deleted_full_sync",
    deletedAt: 1700000006000,
    deletedAtUnixMs: 1700000006000,
  };

  const result = buildListEntriesResult({
    entries: [deletedEntry],
    unchanged: false,
    isDelta: false,
    fetchedCount: 1,
    lastSyncedAt: 1700000007000,
    lastSpreadsheetReadAt: 1700000007000,
    sheetLastUpdatedAt: 1700000007000,
  });

  assert.equal(result.unchanged, false);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, "rec_deleted_full_sync");
  assert.equal(result.entries[0].deletedAtUnixMs, 1700000006000);
});

test("filterExpiredDeletedEntries は保持期限を過ぎた削除済みレコードだけ除外する", () => {
  const now = 1700000000000;
  const retentionDays = 30;
  const recentDeletedAt = now - (retentionDays - 1) * 24 * 60 * 60 * 1000;
  const expiredDeletedAt = now - (retentionDays + 1) * 24 * 60 * 60 * 1000;
  const filtered = filterExpiredDeletedEntries([
    { id: "active", deletedAt: null, deletedAtUnixMs: null },
    { id: "deleted_recent", deletedAt: recentDeletedAt, deletedAtUnixMs: recentDeletedAt },
    { id: "deleted_expired", deletedAt: expiredDeletedAt, deletedAtUnixMs: expiredDeletedAt },
  ], retentionDays, now);

  assert.deepEqual(filtered.map((entry) => entry.id), ["active", "deleted_recent"]);
});

test("normalizeListEntriesOptions は listEntries の正式サポートキーだけを受け付ける", () => {
  const normalized = normalizeListEntriesOptions({
    forceFullSync: true,
    lastSyncedAt: 1700000000000,
    lastSpreadsheetReadAt: 1700000000000,
  });

  assert.deepEqual(normalized, {
    forceFullSync: true,
  });
});

test("getEntry フォールバックは listEntries に必要最小限のオプションだけを渡す", () => {
  const options = buildGetEntryFallbackListEntriesOptions();
  assert.deepEqual(options, {
    forceFullSync: false,
  });
  assert.equal("lastSyncedAt" in options, false);
  assert.equal("lastSpreadsheetReadAt" in options, false);
});

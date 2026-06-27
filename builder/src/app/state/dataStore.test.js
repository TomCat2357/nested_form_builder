import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGetEntryFallbackListEntriesOptions,
  buildListEntriesResult,
  buildUpsertEntryRecord,
  normalizeListEntriesOptions,
  filterExpiredDeletedEntries,
  spreadsheetTargetKey,
} from "./dataStoreHelpers.js";

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
  // Plan P4 γ: createdAt / modifiedAt は JST 文字列を canonical 表現に
  assert.equal(record.createdAt, "2023-11-15_07:13:20.123"); // = Unix ms 1700000000123 in JST
  assert.equal(record.createdAtUnixMs, 1700000000123);    // 過渡期シム
  assert.equal(record.createdBy, "creator@example.com");
  assert.equal(record.modifiedAt, "2023-11-15_07:13:22.222"); // = now (1700000002222) in JST
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
  // Plan P4 γ: createdAt / modifiedAt は JST 文字列に
  assert.equal(record.createdAt, "2023-11-15_07:13:23.333"); // = now (1700000003333) in JST
  assert.equal(record.createdAtUnixMs, now);
  assert.equal(record.createdBy, "");
  assert.equal(record.modifiedAt, "2023-11-15_07:13:23.333");
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

test("spreadsheetTargetKey は別シートへの張り替えでキーが変わる（再リンク検知）", () => {
  const a = spreadsheetTargetKey({ spreadsheetPath: "fldr/old", sheetName: "Data" });
  const b = spreadsheetTargetKey({ spreadsheetPath: "fldr/new", sheetName: "Data" });
  assert.notEqual(a, b);
});

test("spreadsheetTargetKey は path-wins なので id の空↔埋め戻しではキーが変わらない（誤検知しない）", () => {
  // 保存後に GAS が spreadsheetId を埋め戻し、次回 UI が排他制御で id を空にする見かけ上の差。
  const beforeSave = spreadsheetTargetKey({ spreadsheetPath: "fldr/x", spreadsheetId: "" });
  const afterSave = spreadsheetTargetKey({ spreadsheetPath: "fldr/x", spreadsheetId: "SHEET_ID_123" });
  assert.equal(beforeSave, afterSave);
});

test("spreadsheetTargetKey は sheetName 未指定を DEFAULT_SHEET_NAME と同一視する", () => {
  const explicit = spreadsheetTargetKey({ spreadsheetPath: "fldr/x", sheetName: "Data" });
  const omitted = spreadsheetTargetKey({ spreadsheetPath: "fldr/x" });
  assert.equal(explicit, omitted);
});

test("spreadsheetTargetKey はタブ（sheetName）変更でキーが変わる", () => {
  const a = spreadsheetTargetKey({ spreadsheetPath: "fldr/x", sheetName: "Data" });
  const b = spreadsheetTargetKey({ spreadsheetPath: "fldr/x", sheetName: "Sheet2" });
  assert.notEqual(a, b);
});

test("spreadsheetTargetKey はアンリンク（path/id 両方空へ）でキーが変わる", () => {
  const linked = spreadsheetTargetKey({ spreadsheetPath: "fldr/x" });
  const unlinked = spreadsheetTargetKey({ spreadsheetPath: "", spreadsheetId: "" });
  assert.notEqual(linked, unlinked);
});

test("spreadsheetTargetKey は id だけのフォームを別 id へ張り替えるとキーが変わる", () => {
  const a = spreadsheetTargetKey({ spreadsheetId: "OLD_ID" });
  const b = spreadsheetTargetKey({ spreadsheetId: "NEW_ID" });
  assert.notEqual(a, b);
});

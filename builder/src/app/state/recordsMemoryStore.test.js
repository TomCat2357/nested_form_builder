import test from "node:test";
import assert from "node:assert/strict";
import {
  saveRecordsToCache,
  getRecordsFromCache,
  upsertRecordInCache,
  deleteRecordFromCache,
  deleteRecordsFromCache,
  getCachedEntryWithIndex,
  getMaxRecordNo,
  applySyncResultToCache,
  updateRecordsMeta,
  updateEntryIndex,
  normalizeRecordForCache,
  getMaxRecordNoFromEntries,
  __resetMemoryStoreForTests,
} from "./recordsMemoryStore.js";

const FORM_ID = "form_a";
const OTHER_FORM_ID = "form_b";

const sampleRecord = (id, overrides = {}) => ({
  id,
  "No.": overrides["No."] ?? 0,
  data: { field_a: "v" },
  modifiedAtUnixMs: overrides.modifiedAtUnixMs ?? null,
  ...overrides,
});

test("re-exports preserve compat with recordsCache contract", () => {
  const record = normalizeRecordForCache({
    id: "rec_1",
    data: { field_a: "value" },
  }, { formId: FORM_ID });

  assert.equal(record.id, "rec_1");
  assert.equal(record.formId, FORM_ID);
  assert.equal(record["No."], "");
  assert.equal(record.deletedAt, null);
  assert.deepEqual(record.data, { field_a: "value" });

  const maxNo = getMaxRecordNoFromEntries([
    { id: "rec_1", "No.": 1 },
    { id: "rec_2", "No.": 7 },
  ]);
  assert.equal(maxNo, 7);
});

test("saveRecordsToCache stores records and headerMatrix per form", async () => {
  __resetMemoryStoreForTests();
  const records = [
    sampleRecord("rec_1", { "No.": 1 }),
    sampleRecord("rec_2", { "No.": 2 }),
  ];
  const headerMatrix = [["a", "b"]];
  await saveRecordsToCache(FORM_ID, records, headerMatrix, {
    schemaHash: "hash1",
    sheetLastUpdatedAt: 12345,
    serverCommitToken: 9,
    serverModifiedAt: 8,
    lastServerReadAt: 7,
  });

  const result = await getRecordsFromCache(FORM_ID);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map((e) => e.id), ["rec_1", "rec_2"]);
  assert.deepEqual(result.headerMatrix, headerMatrix);
  assert.equal(result.schemaHash, "hash1");
  assert.equal(result.serverCommitToken, 9);
  assert.equal(result.serverModifiedAt, 8);
  assert.equal(result.lastServerReadAt, 7);
  assert.deepEqual(result.entryIndexMap, { rec_1: 0, rec_2: 1 });
});

test("saveRecordsToCache replaces previous records for the same form", async () => {
  __resetMemoryStoreForTests();
  await saveRecordsToCache(FORM_ID, [sampleRecord("rec_1")]);
  await saveRecordsToCache(FORM_ID, [sampleRecord("rec_2"), sampleRecord("rec_3")]);

  const { entries } = await getRecordsFromCache(FORM_ID);
  assert.deepEqual(entries.map((e) => e.id), ["rec_2", "rec_3"]);
});

test("saveRecordsToCache isolates records by formId", async () => {
  __resetMemoryStoreForTests();
  await saveRecordsToCache(FORM_ID, [sampleRecord("rec_1")]);
  await saveRecordsToCache(OTHER_FORM_ID, [sampleRecord("rec_99")]);

  const a = await getRecordsFromCache(FORM_ID);
  const b = await getRecordsFromCache(OTHER_FORM_ID);
  assert.deepEqual(a.entries.map((e) => e.id), ["rec_1"]);
  assert.deepEqual(b.entries.map((e) => e.id), ["rec_99"]);
});

test("getRecordsFromCache returns empty defaults for unknown form", async () => {
  __resetMemoryStoreForTests();
  const result = await getRecordsFromCache("missing_form");
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.headerMatrix, []);
  assert.equal(result.schemaHash, null);
  assert.equal(result.lastSyncedAt, null);
});

test("upsertRecordInCache inserts a new record and updates index map", async () => {
  __resetMemoryStoreForTests();
  await saveRecordsToCache(FORM_ID, [sampleRecord("rec_1", { "No.": 1 })]);
  await upsertRecordInCache(FORM_ID, sampleRecord("rec_2", { "No.": 2 }), { rowIndex: 5 });

  const { entries, entryIndexMap } = await getRecordsFromCache(FORM_ID);
  assert.deepEqual(entries.map((e) => e.id), ["rec_1", "rec_2"]);
  assert.equal(entryIndexMap.rec_2, 5);
});

test("upsertRecordInCache overwrites an existing record", async () => {
  __resetMemoryStoreForTests();
  await saveRecordsToCache(FORM_ID, [sampleRecord("rec_1", { data: { field_a: "old" } })]);
  await upsertRecordInCache(FORM_ID, sampleRecord("rec_1", { data: { field_a: "new" } }));

  const { entries } = await getRecordsFromCache(FORM_ID);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].data.field_a, "new");
});

test("upsertRecordInCache respects syncStartedAt protection", async () => {
  __resetMemoryStoreForTests();
  await upsertRecordInCache(FORM_ID, sampleRecord("rec_1", { data: { field_a: "local" } }));
  // Simulate a background sync that started BEFORE the local write.
  const ancientSyncStart = Date.now() - 1000 * 60 * 60;
  await upsertRecordInCache(FORM_ID, sampleRecord("rec_1", { data: { field_a: "stale-from-server" } }), {
    syncStartedAt: ancientSyncStart,
  });

  const { entries } = await getRecordsFromCache(FORM_ID);
  assert.equal(entries[0].data.field_a, "local", "local edits made after the sync start should win");
});

test("deleteRecordFromCache removes the record and clears the index", async () => {
  __resetMemoryStoreForTests();
  await saveRecordsToCache(FORM_ID, [
    sampleRecord("rec_1"),
    sampleRecord("rec_2"),
  ]);
  await deleteRecordFromCache(FORM_ID, "rec_1");

  const { entries, entryIndexMap } = await getRecordsFromCache(FORM_ID);
  assert.deepEqual(entries.map((e) => e.id), ["rec_2"]);
  assert.equal(entryIndexMap.rec_1, undefined);
  assert.equal(entryIndexMap.rec_2, 1);
});

test("deleteRecordsFromCache removes multiple records at once", async () => {
  __resetMemoryStoreForTests();
  await saveRecordsToCache(FORM_ID, [
    sampleRecord("rec_1"),
    sampleRecord("rec_2"),
    sampleRecord("rec_3"),
  ]);
  await deleteRecordsFromCache(FORM_ID, ["rec_1", "rec_3"]);

  const { entries } = await getRecordsFromCache(FORM_ID);
  assert.deepEqual(entries.map((e) => e.id), ["rec_2"]);
});

test("getCachedEntryWithIndex finds a record by id", async () => {
  __resetMemoryStoreForTests();
  await saveRecordsToCache(FORM_ID, [
    sampleRecord("rec_1", { "No.": 1 }),
    sampleRecord("rec_2", { "No.": 2 }),
  ]);

  const found = await getCachedEntryWithIndex(FORM_ID, "rec_2");
  assert.equal(found.entry.id, "rec_2");
  assert.equal(found.rowIndex, 1);

  const missing = await getCachedEntryWithIndex(FORM_ID, "rec_999");
  assert.equal(missing.entry, null);
});

test("getMaxRecordNo returns the largest No. across all records", async () => {
  __resetMemoryStoreForTests();
  await saveRecordsToCache(FORM_ID, [
    sampleRecord("rec_1", { "No.": 3 }),
    sampleRecord("rec_2", { "No.": 7 }),
    sampleRecord("rec_3", { "No.": 5 }),
  ]);

  assert.equal(await getMaxRecordNo(FORM_ID), 7);
});

test("getMaxRecordNo returns 0 for an unknown form", async () => {
  __resetMemoryStoreForTests();
  assert.equal(await getMaxRecordNo("missing_form"), 0);
});

test("applySyncResultToCache merges newer records by modifiedAt", async () => {
  __resetMemoryStoreForTests();
  const t0 = 1_700_000_000_000;
  await saveRecordsToCache(FORM_ID, [
    sampleRecord("rec_1", { data: { field_a: "old" }, modifiedAtUnixMs: t0 }),
  ]);

  await applySyncResultToCache(FORM_ID, [
    sampleRecord("rec_1", { data: { field_a: "newer" }, modifiedAtUnixMs: t0 + 2_000 }),
    sampleRecord("rec_2", { data: { field_a: "fresh" }, modifiedAtUnixMs: t0 + 1_000 }),
  ], [["h1"]], { serverCommitToken: 11, serverModifiedAt: 22, lastServerReadAt: 33 });

  const { entries, headerMatrix, serverCommitToken, serverModifiedAt, lastServerReadAt } = await getRecordsFromCache(FORM_ID);
  assert.deepEqual(entries.map((e) => e.id), ["rec_1", "rec_2"]);
  assert.equal(entries.find((e) => e.id === "rec_1").data.field_a, "newer");
  assert.deepEqual(headerMatrix, [["h1"]]);
  assert.equal(serverCommitToken, 11);
  assert.equal(serverModifiedAt, 22);
  assert.equal(lastServerReadAt, 33);
});

test("applySyncResultToCache preserves a locally newer record over older server version", async () => {
  __resetMemoryStoreForTests();
  const t0 = 1_700_000_000_000;
  await saveRecordsToCache(FORM_ID, [
    sampleRecord("rec_1", { data: { field_a: "fresh-local" }, modifiedAtUnixMs: t0 + 5_000 }),
  ]);

  await applySyncResultToCache(FORM_ID, [
    sampleRecord("rec_1", { data: { field_a: "older-server" }, modifiedAtUnixMs: t0 + 1_000 }),
  ], []);

  const { entries } = await getRecordsFromCache(FORM_ID);
  assert.equal(entries[0].data.field_a, "fresh-local");
});

test("applySyncResultToCache protects a record edited after the sync started (syncStartedAt guard)", async () => {
  __resetMemoryStoreForTests();
  const t0 = 1_700_000_000_000;
  await saveRecordsToCache(FORM_ID, [
    sampleRecord("rec_1", { data: { field_a: "base" }, modifiedAtUnixMs: t0 }),
  ]);

  // 同期はローカル編集より前に開始した。
  const syncStartedAt = Date.now() - 1000 * 60 * 60;
  // 同期往復の最中にローカルで特勤フラグを付けた（lastSyncedAt = 現在 > syncStartedAt）。
  await upsertRecordInCache(FORM_ID, sampleRecord("rec_1", {
    data: { field_a: "base", 特勤: true },
    modifiedAtUnixMs: t0 + 1_000,
  }));

  // サーバーは modifiedAt がより新しいが特勤を含まない（アップロード前のスナップショット）応答を返す。
  await applySyncResultToCache(FORM_ID, [
    sampleRecord("rec_1", { data: { field_a: "base" }, modifiedAtUnixMs: t0 + 9_000 }),
  ], [], { syncStartedAt });

  const { entries } = await getRecordsFromCache(FORM_ID);
  assert.equal(entries[0].data.特勤, true, "同期開始後に付けた特勤は、古いサーバー応答で消えてはならない");
});

test("applySyncResultToCache overwrites with a newer server record when no local edit raced the sync", async () => {
  __resetMemoryStoreForTests();
  const t0 = 1_700_000_000_000;
  await saveRecordsToCache(FORM_ID, [
    sampleRecord("rec_1", { data: { field_a: "base" }, modifiedAtUnixMs: t0 }),
  ]);

  // 同期はローカルの最終更新より後に開始（= レース無し）。サーバーの新しい版が正しく勝つ。
  const syncStartedAt = Date.now() + 1000 * 60 * 60;
  await applySyncResultToCache(FORM_ID, [
    sampleRecord("rec_1", { data: { field_a: "from-server" }, modifiedAtUnixMs: t0 + 5_000 }),
  ], [], { syncStartedAt });

  const { entries } = await getRecordsFromCache(FORM_ID);
  assert.equal(entries[0].data.field_a, "from-server");
});

test("updateRecordsMeta merges metadata fields without losing entries", async () => {
  __resetMemoryStoreForTests();
  await saveRecordsToCache(FORM_ID, [sampleRecord("rec_1")]);

  await updateRecordsMeta(FORM_ID, {
    schemaHash: "hash2",
    headerMatrix: [["x"]],
    lastReloadedAt: 9999,
    lastServerReadAt: 8888,
    serverCommitToken: 4,
    serverModifiedAt: 5,
  });

  const result = await getRecordsFromCache(FORM_ID);
  assert.equal(result.schemaHash, "hash2");
  assert.deepEqual(result.headerMatrix, [["x"]]);
  assert.equal(result.lastSyncedAt, 9999);
  assert.equal(result.lastSpreadsheetReadAt, 9999);
  assert.equal(result.lastServerReadAt, 8888);
  assert.equal(result.serverCommitToken, 4);
  assert.equal(result.serverModifiedAt, 5);
  assert.equal(result.entries.length, 1);
});

test("updateEntryIndex updates the index map for one entry", async () => {
  __resetMemoryStoreForTests();
  await saveRecordsToCache(FORM_ID, [sampleRecord("rec_1")]);

  await updateEntryIndex(FORM_ID, "rec_1", 42);

  const { entryIndexMap } = await getRecordsFromCache(FORM_ID);
  assert.equal(entryIndexMap.rec_1, 42);

  const found = await getCachedEntryWithIndex(FORM_ID, "rec_1");
  assert.equal(found.rowIndex, 42);
});

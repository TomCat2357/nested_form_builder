import test from "node:test";
import assert from "node:assert/strict";
import {
  childCacheKey,
  getChildRecordsFromCache,
  saveChildDataToCache,
  saveChildCountToCache,
  invalidateChildForm,
  invalidateChildRecords,
  __resetChildRecordsCacheForTests,
} from "./childRecordsMemoryStore.js";
import { evaluateCacheForRecords } from "./cachePolicy.js";
import {
  RECORD_CACHE_MAX_AGE_MS,
  RECORD_CACHE_BACKGROUND_REFRESH_MS,
} from "../../core/constants.js";

const CHILD = "child_form_1";
const OTHER_CHILD = "child_form_2";
const PID = "parent_rec_1";

const sampleChildData = (overrides = {}) => ({
  childFormId: CHILD,
  childFormName: "フォルダ/子",
  childFormUrl: "https://app?form=child_form_1&pid=parent_rec_1",
  count: 3,
  records: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
  ...overrides,
});

test("childCacheKey trims and joins with ::", () => {
  assert.equal(childCacheKey(" a ", " b "), "a::b");
  assert.equal(childCacheKey("", ""), "::");
});

test("empty store read returns no data", async () => {
  __resetChildRecordsCacheForTests();
  const r = await getChildRecordsFromCache(CHILD, PID, { kind: "detail" });
  assert.deepEqual(r, { hasData: false, childData: null, count: null, lastSyncedAt: null });
});

test("saveChildDataToCache satisfies both detail and count reads", async () => {
  __resetChildRecordsCacheForTests();
  const data = sampleChildData();
  await saveChildDataToCache(CHILD, PID, data);

  const detail = await getChildRecordsFromCache(CHILD, PID, { kind: "detail" });
  assert.equal(detail.hasData, true);
  assert.deepEqual(detail.childData, data);
  assert.equal(detail.count, data.count);

  const count = await getChildRecordsFromCache(CHILD, PID, { kind: "count" });
  assert.equal(count.hasData, true);
  assert.equal(count.count, 3);
});

test("saveChildCountToCache satisfies count but not detail", async () => {
  __resetChildRecordsCacheForTests();
  await saveChildCountToCache(CHILD, PID, 5);

  const count = await getChildRecordsFromCache(CHILD, PID, { kind: "count" });
  assert.equal(count.hasData, true);
  assert.equal(count.count, 5);

  const detail = await getChildRecordsFromCache(CHILD, PID, { kind: "detail" });
  assert.equal(detail.hasData, false);
  assert.equal(detail.childData, null);
});

test("count zero is treated as present data", async () => {
  __resetChildRecordsCacheForTests();
  await saveChildCountToCache(CHILD, PID, 0);
  const count = await getChildRecordsFromCache(CHILD, PID, { kind: "count" });
  assert.equal(count.hasData, true);
  assert.equal(count.count, 0);
});

test("keys are isolated by pid and childFormId", async () => {
  __resetChildRecordsCacheForTests();
  await saveChildCountToCache(CHILD, PID, 1);
  await saveChildCountToCache(CHILD, "other_pid", 2);
  await saveChildCountToCache(OTHER_CHILD, PID, 9);

  assert.equal((await getChildRecordsFromCache(CHILD, PID, { kind: "count" })).count, 1);
  assert.equal((await getChildRecordsFromCache(CHILD, "other_pid", { kind: "count" })).count, 2);
  assert.equal((await getChildRecordsFromCache(OTHER_CHILD, PID, { kind: "count" })).count, 9);
});

test("invalidateChildForm drops all pids for that form only", async () => {
  __resetChildRecordsCacheForTests();
  await saveChildCountToCache(CHILD, PID, 1);
  await saveChildCountToCache(CHILD, "other_pid", 2);
  await saveChildCountToCache(OTHER_CHILD, PID, 9);

  await invalidateChildForm(CHILD);

  assert.equal((await getChildRecordsFromCache(CHILD, PID, { kind: "count" })).hasData, false);
  assert.equal((await getChildRecordsFromCache(CHILD, "other_pid", { kind: "count" })).hasData, false);
  // 他フォームは残る
  assert.equal((await getChildRecordsFromCache(OTHER_CHILD, PID, { kind: "count" })).count, 9);
});

test("invalidateChildRecords drops only the single key", async () => {
  __resetChildRecordsCacheForTests();
  await saveChildCountToCache(CHILD, PID, 1);
  await saveChildCountToCache(CHILD, "other_pid", 2);

  await invalidateChildRecords(CHILD, PID);

  assert.equal((await getChildRecordsFromCache(CHILD, PID, { kind: "count" })).hasData, false);
  assert.equal((await getChildRecordsFromCache(CHILD, "other_pid", { kind: "count" })).count, 2);
});

test("truncated childData round-trips (count and truncated preserved)", async () => {
  __resetChildRecordsCacheForTests();
  const data = sampleChildData({ count: 250, truncated: true, records: new Array(200).fill({ id: "x" }) });
  await saveChildDataToCache(CHILD, PID, data);

  const r = await getChildRecordsFromCache(CHILD, PID, { kind: "detail" });
  assert.equal(r.childData.count, 250);
  assert.equal(r.childData.truncated, true);
  assert.equal(r.childData.records.length, 200);
  assert.equal(r.count, 250);
});

test("lastSyncedAt drives SWR evaluation via cachePolicy", async () => {
  __resetChildRecordsCacheForTests();
  await saveChildCountToCache(CHILD, PID, 1);
  const fresh = await getChildRecordsFromCache(CHILD, PID, { kind: "count" });
  assert.equal(typeof fresh.lastSyncedAt, "number");

  // 直近の書き込みは fresh（再取得不要）
  const evalFresh = evaluateCacheForRecords({ lastSyncedAt: fresh.lastSyncedAt, hasData: fresh.hasData, forceSync: false });
  assert.equal(evalFresh.isFresh, true);
  assert.equal(evalFresh.shouldSync, false);

  // background しきい値超 → 裏更新
  const bgAge = Date.now() - (RECORD_CACHE_BACKGROUND_REFRESH_MS + 1000);
  const evalBg = evaluateCacheForRecords({ lastSyncedAt: bgAge, hasData: true, forceSync: false });
  assert.equal(evalBg.shouldBackground, true);
  assert.equal(evalBg.shouldSync, false);

  // max age 超 → ハード再取得
  const oldAge = Date.now() - (RECORD_CACHE_MAX_AGE_MS + 1000);
  const evalSync = evaluateCacheForRecords({ lastSyncedAt: oldAge, hasData: true, forceSync: false });
  assert.equal(evalSync.shouldSync, true);
});

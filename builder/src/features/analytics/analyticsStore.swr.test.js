import test from "node:test";
import assert from "node:assert/strict";
import { makeEntityStore } from "./analyticsStore.js";

const HOUR = 60 * 60 * 1000;

// listSWR の鮮度判定（evaluateCacheForAnalytics: 1 時間 fresh / 24 時間で再取得）を、
// IndexedDB と GAS をメモリモックに差し替えて検証する。
function makeMockCache(initialItems, lastSyncedAt) {
  let items = (initialItems || []).slice();
  let meta = { lastSyncedAt: lastSyncedAt ?? null };
  const saveAllCalls = [];
  return {
    saveAllCalls,
    async getAll() { return items.slice(); },
    async getMeta() { return { lastSyncedAt: meta.lastSyncedAt }; },
    async saveAll(next, { stampSyncTime = false } = {}) {
      items = next.slice();
      if (stampSyncTime) meta.lastSyncedAt = Date.now();
      saveAllCalls.push({ stampSyncTime, count: next.length });
    },
    async upsert(item) { items = items.filter((i) => i.id !== item.id).concat(item); },
    async remove(id) { items = items.filter((i) => i.id !== id); },
  };
}

function makeMockGas(serverItems) {
  let listCalls = 0;
  return {
    get listCalls() { return listCalls; },
    async listItems() { listCalls += 1; return { items: serverItems.slice() }; },
  };
}

function makeStore({ cacheItems = [], lastSyncedAt = null, serverItems = [] } = {}) {
  const cache = makeMockCache(cacheItems, lastSyncedAt);
  const gas = makeMockGas(serverItems);
  const store = makeEntityStore({ one: "item", many: "items", cache, gas });
  return { store, cache, gas };
}

test("1 時間以内は fresh: キャッシュ即返し・GAS は呼ばない", async () => {
  const { store, gas } = makeStore({
    cacheItems: [{ id: "a" }],
    lastSyncedAt: Date.now() - 30 * 60 * 1000,
  });
  const res = await store.listSWR({ includeArchived: true });
  assert.deepEqual(res.items, [{ id: "a" }]);
  assert.equal(res.blocking, false);
  assert.equal(res.sync, null);
  assert.equal(gas.listCalls, 0);
});

test("1〜24 時間は background: キャッシュ返し＋裏更新で最新化", async () => {
  const { store, gas, cache } = makeStore({
    cacheItems: [{ id: "old" }],
    lastSyncedAt: Date.now() - 3 * HOUR,
    serverItems: [{ id: "fresh" }],
  });
  const res = await store.listSWR({ includeArchived: true });
  assert.deepEqual(res.items, [{ id: "old" }]);
  assert.equal(res.blocking, false);
  assert.notEqual(res.sync, null);

  const fresh = await res.sync;
  assert.deepEqual(fresh, [{ id: "fresh" }]);
  assert.equal(gas.listCalls, 1);
  assert.equal(cache.saveAllCalls.at(-1).stampSyncTime, true);
});

test("24 時間超は blocking: キャッシュを信用せず取得を待つ", async () => {
  const { store } = makeStore({
    cacheItems: [{ id: "stale" }],
    lastSyncedAt: Date.now() - 25 * HOUR,
    serverItems: [{ id: "fresh" }],
  });
  const res = await store.listSWR({ includeArchived: true });
  assert.equal(res.blocking, true);
  assert.notEqual(res.sync, null);
  assert.deepEqual(await res.sync, [{ id: "fresh" }]);
});

test("キャッシュ無しは blocking", async () => {
  const { store } = makeStore({ cacheItems: [], lastSyncedAt: null, serverItems: [{ id: "x" }] });
  const res = await store.listSWR({});
  assert.equal(res.blocking, true);
  assert.notEqual(res.sync, null);
});

test("手動 forceRefresh は fresh でも取り直すが blocking にしない", async () => {
  const { store, gas } = makeStore({
    cacheItems: [{ id: "a" }],
    lastSyncedAt: Date.now(),
    serverItems: [{ id: "b" }],
  });
  const res = await store.listSWR({ includeArchived: true, forceRefresh: true });
  assert.equal(res.blocking, false);
  assert.notEqual(res.sync, null);
  assert.deepEqual(await res.sync, [{ id: "b" }]);
  assert.equal(gas.listCalls, 1);
});

test("includeArchived=false はアーカイブ済みを除外", async () => {
  const { store } = makeStore({
    cacheItems: [{ id: "a" }, { id: "b", archived: true }],
    lastSyncedAt: Date.now() - 10 * 60 * 1000,
  });
  const res = await store.listSWR({ includeArchived: false });
  assert.deepEqual(res.items, [{ id: "a" }]);
});

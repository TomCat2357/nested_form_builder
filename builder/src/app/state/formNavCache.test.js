import test from "node:test";
import assert from "node:assert/strict";

// formNavCache は IndexedDB を触るため、registryStore.test.js と同じ自前の
// in-memory IndexedDB モックを注入して検証する（リポジトリは fake-indexeddb 未導入）。
function installMockIndexedDB() {
  const databases = new Map();

  function makeRequest(resultFn) {
    const req = { onsuccess: null, onerror: null, result: undefined };
    setTimeout(() => {
      try {
        req.result = resultFn();
        if (req.onsuccess) req.onsuccess({ target: req });
      } catch (err) {
        req.error = err;
        if (req.onerror) req.onerror({ target: req });
      }
    }, 0);
    return req;
  }

  function makeStore(dataMap, keyPath) {
    return {
      put: (item) => makeRequest(() => { dataMap.set(item[keyPath], item); return item[keyPath]; }),
      get: (key) => makeRequest(() => dataMap.get(key)),
      getAll: () => makeRequest(() => Array.from(dataMap.values())),
      delete: (key) => makeRequest(() => { dataMap.delete(key); return undefined; }),
      clear: () => makeRequest(() => { dataMap.clear(); return undefined; }),
      createIndex: () => {},
    };
  }

  globalThis.indexedDB = {
    open(name, version) {
      const req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: undefined };
      setTimeout(() => {
        let db = databases.get(name);
        const oldVersion = db ? db.version : 0;
        if (!db) {
          db = { version: 0, stores: new Map(), keyPaths: new Map() };
          databases.set(name, db);
        }
        const dbHandle = {
          objectStoreNames: { contains: (n) => db.stores.has(n) },
          createObjectStore(storeName, opts) {
            db.stores.set(storeName, new Map());
            db.keyPaths.set(storeName, opts.keyPath);
            return makeStore(db.stores.get(storeName), opts.keyPath);
          },
          transaction(names, _mode) {
            const tx = { oncomplete: null, onerror: null, onabort: null };
            tx.objectStore = (n) => makeStore(db.stores.get(n), db.keyPaths.get(n));
            let completeHandler = null;
            Object.defineProperty(tx, "oncomplete", {
              get: () => completeHandler,
              set: (fn) => { completeHandler = fn; if (fn) setTimeout(() => fn({ target: tx }), 0); },
            });
            return tx;
          },
          close() {},
        };
        if (version > oldVersion) {
          db.version = version;
          req.result = dbHandle;
          if (req.onupgradeneeded) req.onupgradeneeded({ target: req, oldVersion, transaction: { objectStore: dbHandle.transaction(null).objectStore } });
        }
        req.result = dbHandle;
        if (req.onsuccess) req.onsuccess({ target: req });
      }, 0);
      return req;
    },
  };
  return {
    cleanup: () => { delete globalThis.indexedDB; databases.clear(); },
    seedDb: (name, version, stores) => {
      const storeMap = new Map();
      const keyPaths = new Map();
      for (const [storeName, { keyPath, rows = [] }] of Object.entries(stores)) {
        const data = new Map();
        for (const row of rows) data.set(row[keyPath], row);
        storeMap.set(storeName, data);
        keyPaths.set(storeName, keyPath);
      }
      databases.set(name, { version, stores: storeMap, keyPaths });
    },
    databases,
  };
}

async function freshModule() {
  const { cleanup } = installMockIndexedDB();
  const mod = await import("./formNavCache.js");
  return { ...mod, cleanup };
}

const SAMPLE_ITEMS = [
  { id: "q1", depth: 0, indexLabel: "1.", label: "親", children: [
    { id: "q1c", depth: 1, indexLabel: "1.1.", label: "子", children: [] },
  ] },
  { id: "q2", depth: 0, indexLabel: "2.", label: "次", children: [] },
];

test("saveFormNavToCache/getFormNavFromCache: 目次ツリーを往復できる", async () => {
  const { saveFormNavToCache, getFormNavFromCache, cleanup } = await freshModule();
  try {
    await saveFormNavToCache("F1", SAMPLE_ITEMS);
    const got = await getFormNavFromCache("F1");
    assert.deepEqual(got.items, SAMPLE_ITEMS);
    assert.ok(got.savedAt > 0, "savedAt を打刻");
  } finally { cleanup(); }
});

test("getFormNavFromCache: 未保存は null", async () => {
  const { getFormNavFromCache, cleanup } = await freshModule();
  try {
    assert.equal(await getFormNavFromCache("missing"), null);
  } finally { cleanup(); }
});

test("saveFormNavToCache: formId 無し / items 非配列は no-op", async () => {
  const { saveFormNavToCache, getFormNavFromCache, cleanup } = await freshModule();
  try {
    await saveFormNavToCache("", SAMPLE_ITEMS);
    await saveFormNavToCache("F2", null);
    assert.equal(await getFormNavFromCache("F2"), null);
  } finally { cleanup(); }
});

test("saveFormNavToCache: 同じ formId は上書き（冪等）", async () => {
  const { saveFormNavToCache, getFormNavFromCache, cleanup } = await freshModule();
  try {
    await saveFormNavToCache("F1", SAMPLE_ITEMS);
    await saveFormNavToCache("F1", [{ id: "only", depth: 0, indexLabel: "1.", label: "新", children: [] }]);
    const got = await getFormNavFromCache("F1");
    assert.equal(got.items.length, 1);
    assert.equal(got.items[0].id, "only");
  } finally { cleanup(); }
});

test("deleteFormNavFromCache: 1 件削除できる", async () => {
  const { saveFormNavToCache, getFormNavFromCache, deleteFormNavFromCache, cleanup } = await freshModule();
  try {
    await saveFormNavToCache("F1", SAMPLE_ITEMS);
    await deleteFormNavFromCache("F1");
    assert.equal(await getFormNavFromCache("F1"), null);
  } finally { cleanup(); }
});

test("dbHelpers v10→v11 upgrade: 既存ストアを温存し formNavCache を加算する（非破壊）", async () => {
  const { cleanup, seedDb, databases } = installMockIndexedDB();
  try {
    const { DB_NAME, STORE_NAMES } = await import("../../core/constants.js");
    seedDb(DB_NAME, 10, {
      [STORE_NAMES.forms]: { keyPath: "id", rows: [{ id: "F1", name: "既存フォーム" }] },
      [STORE_NAMES.registry]: { keyPath: "id", rows: [{ id: "F1", kind: "forms" }] },
    });

    const { openDB } = await import("./dbHelpers.js");
    const db = await openDB();
    db.close();

    const seeded = databases.get(DB_NAME);
    assert.equal(seeded.version, 11, "v11 へ上がる");
    assert.equal(seeded.stores.has(STORE_NAMES.formNav), true, "formNavCache を加算");
    assert.equal(seeded.stores.get(STORE_NAMES.forms).get("F1").name, "既存フォーム", "既存データ温存");
    assert.equal(seeded.stores.has(STORE_NAMES.registry), true);
  } finally { cleanup(); }
});

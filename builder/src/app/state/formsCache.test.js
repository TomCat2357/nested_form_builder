import test from "node:test";
import assert from "node:assert/strict";

// formsCache は IndexedDB（makeListCache 経由）を触るため、formNavCache.test.js /
// registryStore.test.js と同じ自前の in-memory IndexedDB モックを注入して検証する。
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
  return { cleanup: () => { delete globalThis.indexedDB; databases.clear(); } };
}

async function freshModule() {
  const { cleanup } = installMockIndexedDB();
  const mod = await import("./formsCache.js");
  return { ...mod, cleanup };
}

const SAMPLE_FORMS = [
  { id: "f1", settings: { formTitle: "申請書" }, folder: "" },
  { id: "f2", settings: { formTitle: "報告書" }, folder: "A" },
];

test("saveFormsToCache/getFormsFromCache: forms と META(failures/propertyStoreMode/folders) を往復できる", async () => {
  const { saveFormsToCache, getFormsFromCache, cleanup } = await freshModule();
  try {
    await saveFormsToCache(SAMPLE_FORMS, [{ id: "f3", reason: "x" }], "script", { stampSyncTime: true, folders: ["A", "B"] });
    const got = await getFormsFromCache();
    assert.deepEqual(got.forms, SAMPLE_FORMS);
    assert.deepEqual(got.loadFailures, [{ id: "f3", reason: "x" }]);
    assert.equal(got.propertyStoreMode, "script");
    assert.deepEqual(got.folders, ["A", "B"]);
    assert.ok(got.lastSyncedAt > 0, "stampSyncTime=true で lastSyncedAt を打刻");
  } finally { cleanup(); }
});

test("getFormsFromCache: 未保存は空配列とゼロ値", async () => {
  const { getFormsFromCache, cleanup } = await freshModule();
  try {
    const got = await getFormsFromCache();
    assert.deepEqual(got.forms, []);
    assert.deepEqual(got.loadFailures, []);
    assert.equal(got.propertyStoreMode, "");
    assert.deepEqual(got.folders, []);
    assert.equal(got.lastSyncedAt, null);
  } finally { cleanup(); }
});

test("saveFormsToCache: folders 未指定なら既存 folders を据え置く", async () => {
  const { saveFormsToCache, getFormsFromCache, cleanup } = await freshModule();
  try {
    await saveFormsToCache(SAMPLE_FORMS, [], "", { stampSyncTime: true, folders: ["X"] });
    // 楽観的更新（folders 省略）: folders は据え置き。
    await saveFormsToCache(SAMPLE_FORMS.slice(0, 1), [], "");
    const got = await getFormsFromCache();
    assert.deepEqual(got.folders, ["X"]);
    assert.equal(got.forms.length, 1);
  } finally { cleanup(); }
});

test("saveFormsToCache: stampSyncTime 省略時は lastSyncedAt を延長しない", async () => {
  const { saveFormsToCache, getFormsFromCache, cleanup } = await freshModule();
  try {
    await saveFormsToCache(SAMPLE_FORMS, [], "", { stampSyncTime: true, folders: [] });
    const first = (await getFormsFromCache()).lastSyncedAt;
    await saveFormsToCache(SAMPLE_FORMS, [], "");
    const second = (await getFormsFromCache()).lastSyncedAt;
    assert.equal(first, second, "楽観的更新では lastSyncedAt 据え置き");
  } finally { cleanup(); }
});

test("getFormsFromCache: form 行に内部 META(lastSyncedAt)が漏れない", async () => {
  const { saveFormsToCache, getFormsFromCache, cleanup } = await freshModule();
  try {
    await saveFormsToCache(SAMPLE_FORMS, [], "", { stampSyncTime: true, folders: [] });
    const got = await getFormsFromCache();
    for (const form of got.forms) {
      assert.equal("lastSyncedAt" in form, false, "form 行に lastSyncedAt を付与しない");
    }
  } finally { cleanup(); }
});

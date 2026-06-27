import test from "node:test";
import assert from "node:assert/strict";

// registryStore は IndexedDB を触るため、依存を最小化した in-memory IndexedDB モックを
// globalThis.indexedDB に注入して検証する（リポジトリは fake-indexeddb を導入していないため自前）。
// 対応 API は openDB / withTransaction / waitForRequest が使う最小サブセット:
//   indexedDB.open(name, version) → {onupgradeneeded, onsuccess, onerror}
//   db.objectStoreNames.contains / db.createObjectStore({keyPath}) / store.createIndex
//   db.transaction(names, mode) → tx.objectStore(name) / tx.oncomplete
//   store.put / get / getAll / delete / clear（各 IDBRequest 風・onsuccess を非同期発火）
function installMockIndexedDB() {
  const databases = new Map(); // name -> { version, stores: Map<storeName, Map<key,value>>, keyPaths }

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
            // callback が await し終えた後に oncomplete が代入される。代入時に非同期発火する。
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
    // 既存 DB を任意バージョン・任意ストア/データで事前投入する（upgrade テスト用）。
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

async function freshStore() {
  const { cleanup } = installMockIndexedDB();
  // import を毎回新しく評価する必要は無い（モジュールは indexedDB をクロージャに閉じ込めず都度参照する）。
  const { registryStore } = await import("./registryStore.js");
  await registryStore.clear();
  return { registryStore, cleanup };
}

test("registryStore.upsert/get: title→name 派生・fileId を key にして 1 件保存できる", async () => {
  const { registryStore, cleanup } = await freshStore();
  try {
    await registryStore.upsert({ fileId: "F1", title: "親フォーム", folder: "01_forms/x", driveFileUrl: "u1" }, "forms");
    const got = await registryStore.get("F1");
    assert.equal(got.id, "F1");
    assert.equal(got.fileId, "F1");
    assert.equal(got.kind, "forms");
    assert.equal(got.name, "親フォーム", "forms の title は name へ正規化");
    assert.equal(got.folder, "01_forms/x");
    assert.equal(got.driveFileUrl, "u1");
  } finally { cleanup(); }
});

test("registryStore.upsert: fileId が無い項目は登録しない", async () => {
  const { registryStore, cleanup } = await freshStore();
  try {
    const res = await registryStore.upsert({ title: "no id" }, "forms");
    assert.equal(res, null);
    assert.deepEqual(await registryStore.loadAll(), []);
  } finally { cleanup(); }
});

test("registryStore.fillFromList + loadAll(kind): kind ごとに絞り込める", async () => {
  const { registryStore, cleanup } = await freshStore();
  try {
    await registryStore.fillFromList("forms", [{ id: "F1", title: "A" }, { id: "F2", title: "B" }], { stampSyncTime: true });
    await registryStore.fillFromList("questions", [{ id: "Q1", name: "集計" }], { stampSyncTime: true });
    const forms = await registryStore.loadAll("forms");
    const questions = await registryStore.loadAll("questions");
    assert.deepEqual(forms.map((e) => e.id).sort(), ["F1", "F2"]);
    assert.deepEqual(questions.map((e) => e.id), ["Q1"]);
    assert.equal((await registryStore.loadAll()).length, 3, "全 kind 合算");
    assert.ok((await registryStore.lastSyncedAt("forms")) > 0, "サーバ取得で lastSyncedAt を打刻");
  } finally { cleanup(); }
});

test("registryStore.fillFromList(stampSyncTime): その kind の消えた項目を反映（削除）", async () => {
  const { registryStore, cleanup } = await freshStore();
  try {
    await registryStore.fillFromList("forms", [{ id: "F1", title: "A" }, { id: "F2", title: "B" }], { stampSyncTime: true });
    // F2 が消えたサーバ一覧で再充填 → F2 が registry からも消える。
    await registryStore.fillFromList("forms", [{ id: "F1", title: "A2" }], { stampSyncTime: true });
    const forms = await registryStore.loadAll("forms");
    assert.deepEqual(forms.map((e) => e.id), ["F1"]);
    assert.equal(forms[0].name, "A2", "残った項目は最新値へ更新");
  } finally { cleanup(); }
});

test("registryStore.clear / isEmpty: 喪失検出 → list から再構成できる", async () => {
  const { registryStore, cleanup } = await freshStore();
  try {
    await registryStore.fillFromList("dashboards", [{ id: "D1", name: "ダッシュ" }], { stampSyncTime: true });
    assert.equal(await registryStore.isEmpty(), false);
    await registryStore.clear();
    assert.equal(await registryStore.isEmpty(), true, "clear 後は空（喪失）");
    // 再構成: list API から再充填。
    await registryStore.fillFromList("dashboards", [{ id: "D1", name: "ダッシュ" }], { stampSyncTime: true });
    assert.equal(await registryStore.isEmpty("dashboards"), false);
    assert.equal((await registryStore.get("D1")).name, "ダッシュ");
  } finally { cleanup(); }
});

test("registryStore.remove: 1 件削除できる", async () => {
  const { registryStore, cleanup } = await freshStore();
  try {
    await registryStore.upsert({ fileId: "Q1", name: "集計", kind: "questions" });
    await registryStore.remove("Q1");
    assert.equal(await registryStore.get("Q1"), null);
  } finally { cleanup(); }
});

test("dbHelpers v9→最新 upgrade: 既存 formsCache 等を温存し registry を加算する（非破壊）", async () => {
  const { cleanup, seedDb, databases } = installMockIndexedDB();
  try {
    const { DB_NAME, STORE_NAMES } = await import("../../core/constants.js");
    // 既存 v9 DB を投入（formsCache にデータ + settingsStore）。registry はまだ無い。
    seedDb(DB_NAME, 9, {
      [STORE_NAMES.forms]: { keyPath: "id", rows: [{ id: "F1", name: "既存フォーム" }] },
      [STORE_NAMES.settings]: { keyPath: "key", rows: [{ key: "theme", value: "dark" }] },
      [STORE_NAMES.analyticsQuestions]: { keyPath: "id", rows: [{ id: "Q1" }] },
    });

    const { openDB } = await import("./dbHelpers.js");
    const { DB_VERSION } = await import("../../core/constants.js");
    const db = await openDB();
    db.close();

    const seeded = databases.get(DB_NAME);
    assert.equal(seeded.version, DB_VERSION, "最新バージョンへ上がる");
    assert.equal(seeded.stores.has(STORE_NAMES.registry), true, "registry を加算");
    // 既存ストア・データは温存（非破壊）。
    assert.equal(seeded.stores.get(STORE_NAMES.forms).get("F1").name, "既存フォーム");
    assert.equal(seeded.stores.get(STORE_NAMES.settings).get("theme").value, "dark");
    assert.equal(seeded.stores.has(STORE_NAMES.analyticsQuestions), true);
  } finally { cleanup(); }
});

/**
 * Shared IndexedDB helpers for formsCache, settingsStore, analyticsQuestions/Dashboards
 *
 * records / recordsMeta / analyticsSnapshots / analyticsSnapshotsMeta は v6 で廃止
 * (メモリ常駐ストアへ移行)。既存ユーザーは onupgradeneeded で旧ストアを削除する。
 */

import { DB_NAME, DB_VERSION, STORE_NAMES, LEGACY_STORE_NAMES_V5 } from "../../core/constants.js";
export { STORE_NAMES };

/**
 * Open IndexedDB connection with all required stores
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion || 0;

      if (!db.objectStoreNames.contains(STORE_NAMES.forms)) {
        const store = db.createObjectStore(STORE_NAMES.forms, { keyPath: 'id' });
        store.createIndex('archived', 'archived', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_NAMES.settings)) {
        db.createObjectStore(STORE_NAMES.settings, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(STORE_NAMES.analyticsQuestions)) {
        db.createObjectStore(STORE_NAMES.analyticsQuestions, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.analyticsDashboards)) {
        db.createObjectStore(STORE_NAMES.analyticsDashboards, { keyPath: 'id' });
      }

      // v8: オフラインファースト保存の永続アップロードキュー。
      // 1 件 = 1 アップロードジョブ。リロードを跨いで残り、起動時に再開する。
      if (!db.objectStoreNames.contains(STORE_NAMES.uploadQueue)) {
        const queueStore = db.createObjectStore(STORE_NAMES.uploadQueue, { keyPath: 'jobId' });
        queueStore.createIndex('status', 'status', { unique: false });
        queueStore.createIndex('entityType', 'entityType', { unique: false });
        queueStore.createIndex('localId', 'localId', { unique: false });
      }

      // v9: 開いたフォーム/ダッシュボードの履歴。1 件 = 1 エンティティ
      // （key = "<entityType>:<entityId>"）。件数が小さいためインデックスは作らず
      // JS 側でスコア順にソートする（openHistoryStore.rankOpenHistory）。
      if (!db.objectStoreNames.contains(STORE_NAMES.openHistory)) {
        db.createObjectStore(STORE_NAMES.openHistory, { keyPath: 'key' });
      }

      // v10: registry（フロントの作業キャッシュ）。1 件 = 1 エンティティ
      // （key = fileId）。{ id(=fileId), kind, fileId, folder, name, driveFileUrl }。
      // 加算のみ・既存ストア非破壊。喪失時は list API / GAS 再構成 API で再生成する。
      if (!db.objectStoreNames.contains(STORE_NAMES.registry)) {
        const registryStore = db.createObjectStore(STORE_NAMES.registry, { keyPath: 'id' });
        registryStore.createIndex('kind', 'kind', { unique: false });
      }

      // v11: formNavCache（目次ツリーの軽量キャッシュ）。1 件 = 1 フォーム
      // （key = formId）。{ id(=formId), items(目次ツリー), savedAt }。
      // 加算のみ・既存ストア非破壊。喪失時はフォーム本体ロード後に再生成する。
      if (!db.objectStoreNames.contains(STORE_NAMES.formNav)) {
        db.createObjectStore(STORE_NAMES.formNav, { keyPath: 'id' });
      }

      if (oldVersion < 6) {
        for (const legacyName of LEGACY_STORE_NAMES_V5) {
          if (db.objectStoreNames.contains(legacyName)) {
            db.deleteObjectStore(legacyName);
          }
        }
      }

      // v7: Dashboard を Metabase 風自由配置スキーマ (v2) に切り替えたため
      // 既存の v1 形式 dashboard キャッシュを破棄する。
      if (oldVersion < 7 && oldVersion >= 1) {
        if (db.objectStoreNames.contains(STORE_NAMES.analyticsDashboards)) {
          const tx = event.target.transaction;
          if (tx) {
            try {
              tx.objectStore(STORE_NAMES.analyticsDashboards).clear();
            } catch (_e) { /* noop */ }
          }
        }
      }
    };
  });
}

/**
 * Promisify IDBRequest so we can await operations
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
export const waitForRequest = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/**
 * Wait for a transaction to complete
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
export const waitForTransaction = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/**
 * DBトランザクションのボイラープレートを隠蔽するラッパー
 */
export async function withTransaction(storeNames, mode, callback) {
  const db = await openDB();
  const tx = db.transaction(storeNames, mode);
  try {
    const stores = Array.isArray(storeNames)
      ? storeNames.map(name => tx.objectStore(name))
      : tx.objectStore(storeNames);
    const result = await callback(stores, tx);
    await waitForTransaction(tx);
    return result;
  } finally {
    db.close();
  }
}

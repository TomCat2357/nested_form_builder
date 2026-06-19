import { ensureArray } from "../../utils/arrays.js";
import { withTransaction, waitForRequest, STORE_NAMES } from './dbHelpers.js';

const META_KEY = '__metadata__';

// フォーム一覧キャッシュ用のメタ（lastSyncedAt / failures / propertyStoreMode / folders）。
// レコード同期用の recordsMemoryStore.js のメタとは別ドメインなので共通化しない。
// lastSyncedAt は「最後にサーバから一覧をフル取得した時刻」を表す。
// stampSyncTime=true はサーバ取得経路（refreshForms）のみが渡す。ローカルの楽観的更新
// では既存メタの値を据え置き、SWR の再同期タイマーを延長しない。
export async function saveFormsToCache(forms, loadFailures = [], propertyStoreMode = "", { stampSyncTime = false, folders } = {}) {
  await withTransaction(STORE_NAMES.forms, 'readwrite', async (store) => {
    let lastSyncedAt;
    let prevFolders = [];
    const existingMeta = await waitForRequest(store.get(META_KEY));
    if (stampSyncTime) {
      lastSyncedAt = Date.now();
    } else {
      lastSyncedAt = existingMeta?.lastSyncedAt ?? null;
    }
    prevFolders = Array.isArray(existingMeta?.folders) ? existingMeta.folders : [];
    // folders 未指定（楽観的更新など）は既存値を据え置く。
    const nextFolders = Array.isArray(folders) ? folders : prevFolders;
    await waitForRequest(store.clear());
    for (const form of forms) await waitForRequest(store.put({ ...form, lastSyncedAt }));
    await waitForRequest(store.put({ id: META_KEY, lastSyncedAt, failures: loadFailures, propertyStoreMode, folders: nextFolders }));
  });
}

export async function getFormsFromCache() {
  return await withTransaction(STORE_NAMES.forms, 'readonly', async (store) => {
    const allRecords = (await waitForRequest(store.getAll())) || [];
    const forms = [];
    let loadFailures = [], lastSyncedAt = null, propertyStoreMode = "", folders = [];
    for (const record of allRecords) {
      if (record.id === META_KEY) {
        loadFailures = record.failures || [];
        lastSyncedAt = record.lastSyncedAt || null;
        propertyStoreMode = record.propertyStoreMode || "";
        folders = ensureArray(record.folders);
      } else if (record.id !== undefined) {
        const { lastSyncedAt: _, ...form } = record;
        forms.push(form);
      }
    }
    return { forms, loadFailures, lastSyncedAt, propertyStoreMode, folders };
  });
}

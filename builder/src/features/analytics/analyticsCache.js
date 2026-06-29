/**
 * Analytics 用 IndexedDB キャッシュ層 (Question/Dashboard 定義のみ)
 *
 * Snapshot キャッシュは廃止された (PR-7 alasql 全面移行)。
 * 集計データは dataStore.listEntries 経由でメモリ常駐 records から取り出す。
 */

import { STORE_NAMES } from "../../core/constants.js";
import { withTransaction, waitForRequest } from "../../app/state/dbHelpers.js";

// formsCache.js と同じ方式で、エンティティ行と同居する keyPath:"id" のメタ行を
// 1 件だけ持つ。lastSyncedAt は「最後にサーバから一覧をフル取得した時刻」。
// IndexedDB スキーマ自体は変わらない（既存ストアに 1 行増えるだけ）ので DB バージョン据え置き。
const META_KEY = "__metadata__";

/**
 * keyPath: "id" の単純なリストストア用の CRUD ヘルパーを生成する。
 * Question / Dashboard / CrossSearch に加え、forms 一覧キャッシュ（formsCache.js）も
 * これを共有する。forms は META へ failures / propertyStoreMode / folders を載せたいので、
 * saveAll は任意の extraMeta を、getMeta はその全フィールドを返す（既定利用は lastSyncedAt のみ）。
 * @param {string} storeName
 * @returns {{ saveAll, getAll, getMeta, upsert, remove, resetSyncTime }}
 */
export function makeListCache(storeName) {
  return {
    // stampSyncTime=true はサーバ取得経路のみが渡す。ローカルの楽観的更新（upsert/remove）
    // では lastSyncedAt を据え置き、SWR の再同期タイマーを延長しない。
    // extraMeta は META 行へ併記する任意フィールド（forms の failures/propertyStoreMode/folders）。
    async saveAll(items, { stampSyncTime = false, extraMeta } = {}) {
      await withTransaction(storeName, "readwrite", async (store) => {
        const existingMeta = await waitForRequest(store.get(META_KEY));
        const lastSyncedAt = stampSyncTime ? Date.now() : (existingMeta?.lastSyncedAt ?? null);
        await waitForRequest(store.clear());
        for (const item of items) {
          await waitForRequest(store.put(item));
        }
        await waitForRequest(store.put({ ...(extraMeta || {}), id: META_KEY, lastSyncedAt }));
      });
    },
    async getAll() {
      return await withTransaction(storeName, "readonly", async (store) => {
        const all = (await waitForRequest(store.getAll())) || [];
        return all.filter((record) => record?.id !== META_KEY);
      });
    },
    async getMeta() {
      return await withTransaction(storeName, "readonly", async (store) => {
        const meta = await waitForRequest(store.get(META_KEY));
        if (!meta) return { lastSyncedAt: null };
        const { id: _id, ...rest } = meta;
        return { ...rest, lastSyncedAt: meta.lastSyncedAt ?? null };
      });
    },
    async upsert(item) {
      await withTransaction(storeName, "readwrite", async (store) => {
        await waitForRequest(store.put(item));
      });
    },
    async remove(id) {
      await withTransaction(storeName, "readwrite", async (store) => {
        await waitForRequest(store.delete(id));
      });
    },
    // 移動・名前変更などサーバ側でフォルダ構造が変わった後に呼ぶ。
    // lastSyncedAt を null にして次回 listSWR が GAS から再取得するよう強制失効させる。
    async resetSyncTime() {
      await withTransaction(storeName, "readwrite", async (store) => {
        const meta = await waitForRequest(store.get(META_KEY));
        await waitForRequest(store.put({ ...(meta || {}), id: META_KEY, lastSyncedAt: null }));
      });
    },
  };
}

export const questionCache = makeListCache(STORE_NAMES.analyticsQuestions);
export const dashboardCache = makeListCache(STORE_NAMES.analyticsDashboards);
// 串刺しフォーム検索（cross-form search）= 第 3 のメタエンティティ。Question/Dashboard と同形のリストキャッシュ。
export const crossSearchCache = makeListCache(STORE_NAMES.analyticsCrossSearches);

// Question / Dashboard キャッシュがローカルで変化したことを一覧へ通知するための軽量イベント。
// オフライン保存の楽観的 upsert やバックグラウンドアップロード成功後の付け替えで発火し、
// useAnalyticsList が購読して再読込する（サーバ強制取得ではなくキャッシュ優先の再評価）。
const analyticsCacheListeners = new Set();
export const subscribeAnalyticsCache = (fn) => {
  analyticsCacheListeners.add(fn);
  return () => analyticsCacheListeners.delete(fn);
};
export const emitAnalyticsCacheChanged = (entityType) => {
  analyticsCacheListeners.forEach((fn) => {
    try { fn(entityType); } catch (_e) { /* noop */ }
  });
};

// フォルダ登録簿（Question/Dashboard）の変化を一覧へ通知する軽量イベント。
// 楽観的なフォルダ操作（移動/名前変更/削除）の即時反映や、バックグラウンド op ジョブ成功後の
// サーバ確定 folders 採用で発火する。一覧ページが購読して registeredFolders を更新する。
const analyticsFolderListeners = new Set();
export const subscribeAnalyticsFolders = (fn) => {
  analyticsFolderListeners.add(fn);
  return () => analyticsFolderListeners.delete(fn);
};
export const emitAnalyticsFoldersChanged = (entityType, folders) => {
  analyticsFolderListeners.forEach((fn) => {
    try { fn(entityType, folders); } catch (_e) { /* noop */ }
  });
};

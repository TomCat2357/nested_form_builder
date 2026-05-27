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
 * @param {string} storeName
 * @returns {{ saveAll, getAll, getMeta, upsert, remove }}
 */
function makeListCache(storeName) {
  return {
    // stampSyncTime=true はサーバ取得経路のみが渡す。ローカルの楽観的更新（upsert/remove）
    // では lastSyncedAt を据え置き、SWR の再同期タイマーを延長しない。
    async saveAll(items, { stampSyncTime = false } = {}) {
      await withTransaction(storeName, "readwrite", async (store) => {
        const existingMeta = await waitForRequest(store.get(META_KEY));
        const lastSyncedAt = stampSyncTime ? Date.now() : (existingMeta?.lastSyncedAt ?? null);
        await waitForRequest(store.clear());
        for (const item of items) {
          await waitForRequest(store.put(item));
        }
        await waitForRequest(store.put({ id: META_KEY, lastSyncedAt }));
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
        return { lastSyncedAt: meta?.lastSyncedAt ?? null };
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
  };
}

export const questionCache = makeListCache(STORE_NAMES.analyticsQuestions);
export const dashboardCache = makeListCache(STORE_NAMES.analyticsDashboards);

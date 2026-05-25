/**
 * Analytics 用 IndexedDB キャッシュ層 (Question/Dashboard 定義のみ)
 *
 * Snapshot キャッシュは廃止された (PR-7 alasql 全面移行)。
 * 集計データは dataStore.listEntries 経由でメモリ常駐 records から取り出す。
 */

import { STORE_NAMES } from "../../core/constants.js";
import { withTransaction, waitForRequest } from "../../app/state/dbHelpers.js";

/**
 * keyPath: "id" の単純なリストストア用の CRUD ヘルパーを生成する。
 * @param {string} storeName
 * @returns {{ saveAll, getAll, upsert, remove }}
 */
function makeListCache(storeName) {
  return {
    async saveAll(items) {
      await withTransaction(storeName, "readwrite", async (store) => {
        await waitForRequest(store.clear());
        for (const item of items) {
          await waitForRequest(store.put(item));
        }
      });
    },
    async getAll() {
      return await withTransaction(storeName, "readonly", async (store) =>
        (await waitForRequest(store.getAll())) || []
      );
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

import { withTransaction, waitForRequest, STORE_NAMES } from "./dbHelpers.js";

const META_KEY = "__metadata__";

export async function saveDashboardsToCache(dashboards, loadFailures = [], propertyStoreMode = "") {
  await withTransaction(STORE_NAMES.dashboards, "readwrite", async (store) => {
    await waitForRequest(store.clear());
    const lastSyncedAt = Date.now();
    for (const dashboard of dashboards) await waitForRequest(store.put({ ...dashboard, lastSyncedAt }));
    await waitForRequest(store.put({ id: META_KEY, lastSyncedAt, failures: loadFailures, propertyStoreMode }));
  });
}

export async function getDashboardsFromCache() {
  return await withTransaction(STORE_NAMES.dashboards, "readonly", async (store) => {
    const allRecords = (await waitForRequest(store.getAll())) || [];
    const dashboards = [];
    let loadFailures = [];
    let lastSyncedAt = null;
    let propertyStoreMode = "";
    for (const record of allRecords) {
      if (record.id === META_KEY) {
        loadFailures = record.failures || [];
        lastSyncedAt = record.lastSyncedAt || null;
        propertyStoreMode = record.propertyStoreMode || "";
      } else if (record.id !== undefined) {
        const { lastSyncedAt: _ignored, ...dashboard } = record;
        dashboards.push(dashboard);
      }
    }
    return { dashboards, loadFailures, lastSyncedAt, propertyStoreMode };
  });
}

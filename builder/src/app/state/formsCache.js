import { withTransaction, waitForRequest, STORE_NAMES } from './dbHelpers.js';

const META_KEY = '__metadata__';

export async function saveFormsToCache(forms, loadFailures = [], propertyStoreMode = "") {
  await withTransaction(STORE_NAMES.forms, 'readwrite', async (store) => {
    await waitForRequest(store.clear());
    const lastSyncedAt = Date.now();
    for (const form of forms) await waitForRequest(store.put({ ...form, lastSyncedAt }));
    await waitForRequest(store.put({ id: META_KEY, lastSyncedAt, failures: loadFailures, propertyStoreMode }));
  });
  console.log('[formsCache] Saved', forms.length, 'forms and', loadFailures.length, 'failures to cache');
}

export async function getFormsFromCache() {
  return await withTransaction(STORE_NAMES.forms, 'readonly', async (store) => {
    const allRecords = (await waitForRequest(store.getAll())) || [];
    const forms = [];
    let loadFailures = [], lastSyncedAt = null, propertyStoreMode = "";
    for (const record of allRecords) {
      if (record.id === META_KEY) {
        loadFailures = record.failures || [];
        lastSyncedAt = record.lastSyncedAt || null;
        propertyStoreMode = record.propertyStoreMode || "";
      } else if (record.id !== undefined) {
        const { lastSyncedAt: _, ...form } = record;
        forms.push(form);
      }
    }
    return { forms, loadFailures, lastSyncedAt, propertyStoreMode };
  });
}

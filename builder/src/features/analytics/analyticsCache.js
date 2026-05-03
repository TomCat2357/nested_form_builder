/**
 * Analytics 用 IndexedDB キャッシュ層
 * recordsCache.js のパターン踏襲
 */

import { STORE_NAMES } from "../../core/constants.js";
import { openDB, waitForRequest, waitForTransaction } from "../../app/state/dbHelpers.js";

// バージョンチェックをスキップする期間（5 分）
const VERSION_CHECK_SKIP_MS = 5 * 60 * 1000;

// ---- Snapshot Cache ----

export async function saveSnapshotToCache(snapshot) {
  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.analyticsSnapshots, STORE_NAMES.analyticsSnapshotsMeta], "readwrite");
  try {
    const snapStore = tx.objectStore(STORE_NAMES.analyticsSnapshots);
    const metaStore = tx.objectStore(STORE_NAMES.analyticsSnapshotsMeta);

    await waitForRequest(snapStore.put({
      formId: snapshot.formId,
      snapshotVersion: snapshot.snapshotVersion,
      rowCount: snapshot.rowCount,
      columns: snapshot.columns,
      headerMatrix: snapshot.headerMatrix,
      cachedAt: Date.now(),
    }));

    await waitForRequest(metaStore.put({
      formId: snapshot.formId,
      snapshotVersion: snapshot.snapshotVersion,
      rowCount: snapshot.rowCount,
      lastCheckedAt: Date.now(),
    }));

    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

export async function getSnapshotFromCache(formId) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.analyticsSnapshots, "readonly");
  try {
    const store = tx.objectStore(STORE_NAMES.analyticsSnapshots);
    return await waitForRequest(store.get(formId));
  } finally {
    db.close();
  }
}

export async function getSnapshotMeta(formId) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.analyticsSnapshotsMeta, "readonly");
  try {
    const store = tx.objectStore(STORE_NAMES.analyticsSnapshotsMeta);
    return await waitForRequest(store.get(formId));
  } finally {
    db.close();
  }
}

export async function updateSnapshotMetaCheckedAt(formId) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.analyticsSnapshotsMeta, "readwrite");
  try {
    const store = tx.objectStore(STORE_NAMES.analyticsSnapshotsMeta);
    const existing = await waitForRequest(store.get(formId));
    if (existing) {
      existing.lastCheckedAt = Date.now();
      await waitForRequest(store.put(existing));
    }
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

export function shouldSkipVersionCheck(meta) {
  if (!meta || !meta.lastCheckedAt) return false;
  return Date.now() - meta.lastCheckedAt < VERSION_CHECK_SKIP_MS;
}

// ---- Question Cache ----

export async function saveQuestionsToCache(questions) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.analyticsQuestions, "readwrite");
  try {
    const store = tx.objectStore(STORE_NAMES.analyticsQuestions);
    await waitForRequest(store.clear());
    for (const q of questions) {
      await waitForRequest(store.put(q));
    }
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

export async function getQuestionsFromCache() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.analyticsQuestions, "readonly");
  try {
    const store = tx.objectStore(STORE_NAMES.analyticsQuestions);
    return (await waitForRequest(store.getAll())) || [];
  } finally {
    db.close();
  }
}

export async function upsertQuestionInCache(question) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.analyticsQuestions, "readwrite");
  try {
    await waitForRequest(tx.objectStore(STORE_NAMES.analyticsQuestions).put(question));
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

export async function deleteQuestionFromCache(questionId) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.analyticsQuestions, "readwrite");
  try {
    await waitForRequest(tx.objectStore(STORE_NAMES.analyticsQuestions).delete(questionId));
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

// ---- Dashboard Cache ----

export async function saveDashboardsToCache(dashboards) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.analyticsDashboards, "readwrite");
  try {
    const store = tx.objectStore(STORE_NAMES.analyticsDashboards);
    await waitForRequest(store.clear());
    for (const d of dashboards) {
      await waitForRequest(store.put(d));
    }
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

export async function getDashboardsFromCache() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.analyticsDashboards, "readonly");
  try {
    const store = tx.objectStore(STORE_NAMES.analyticsDashboards);
    return (await waitForRequest(store.getAll())) || [];
  } finally {
    db.close();
  }
}

export async function upsertDashboardInCache(dashboard) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.analyticsDashboards, "readwrite");
  try {
    await waitForRequest(tx.objectStore(STORE_NAMES.analyticsDashboards).put(dashboard));
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

export async function deleteDashboardFromCache(dashboardId) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.analyticsDashboards, "readwrite");
  try {
    await waitForRequest(tx.objectStore(STORE_NAMES.analyticsDashboards).delete(dashboardId));
    await waitForTransaction(tx);
  } finally {
    db.close();
  }
}

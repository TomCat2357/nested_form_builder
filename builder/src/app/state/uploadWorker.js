/**
 * オフラインファースト保存のバックグラウンドアップロードワーカー。
 *
 * uploadQueue に積まれたジョブを「単一 in-flight・逐次」で処理する（GAS の LockService 競合を避ける）。
 *   - 依存順: form → question → dashboard（参照先が先にアップロードされ実 fileId を得てから依存を送る）
 *   - 成功: 仮 ID(local_…) → 実 fileId へ付け替え、参照（Question→Form / Dashboard→Question）を再リンク、ジョブ削除
 *   - 失敗: 指数バックオフで自動リトライ。手動「再試行」(retryNow) でバックオフを解除して即再開
 *
 * フォームの React 状態反映は AppDataProvider が registerFormReconciler で登録するコールバックに委ねる
 * （未登録時は formsCache を直接更新）。Question/Dashboard は IndexedDB キャッシュを直接更新し、
 * 一覧へは analyticsCache のイベントで再描画を促す。
 */

import { UPLOAD_RETRY_BASE_MS, UPLOAD_RETRY_MAX_MS } from "../../core/constants.js";
import { isLocalId } from "../../core/ids.js";
import { saveForm } from "../../services/gasClient.js";
import { analyticsGasClient } from "../../features/analytics/analyticsGasClient.js";
import { saveFormsToCache, getFormsFromCache } from "./formsCache.js";
import {
  questionCache,
  dashboardCache,
  emitAnalyticsCacheChanged,
} from "../../features/analytics/analyticsCache.js";
import {
  getAllJobs,
  updateJob,
  deleteJob,
  countPendingByType,
  remapLocalIdInJobs,
  toUploadPayload,
  applyRefRemapToPayload,
} from "./uploadQueue.js";
import {
  setUploadUploading,
  setUploadPending,
  setUploadLastError,
} from "../../features/search/globalSyncState.js";

// ---------------------------------------------------------------------------
// フォーム reconcile コールバック（AppDataProvider が登録）
// ---------------------------------------------------------------------------
let formReconciler = null;
export const registerFormReconciler = (fn) => {
  formReconciler = typeof fn === "function" ? fn : null;
};

// ---------------------------------------------------------------------------
// tempId → realId 解決イベント（useTempIdRedirect 用）
// ---------------------------------------------------------------------------
const resolvedTempIds = new Map(); // tempId -> realId
const tempIdListeners = new Set();
export const subscribeTempIdResolved = (fn) => {
  tempIdListeners.add(fn);
  return () => tempIdListeners.delete(fn);
};
export const getResolvedRealId = (tempId) => resolvedTempIds.get(tempId) || null;
const emitTempIdResolved = (tempId, realId) => {
  resolvedTempIds.set(tempId, realId);
  tempIdListeners.forEach((fn) => {
    try { fn(tempId, realId); } catch (_e) { /* noop */ }
  });
};

// ---------------------------------------------------------------------------
// ワーカー本体
// ---------------------------------------------------------------------------
let processing = false;
let started = false;
let backoffTimer = null;

const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

const publishPending = async () => {
  try {
    setUploadPending(await countPendingByType());
  } catch (_e) { /* noop */ }
};

const computeBackoffMs = (attempt) => {
  const exp = Math.min(UPLOAD_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1), UPLOAD_RETRY_MAX_MS);
  return exp + Math.floor(Math.random() * 1000);
};

const TYPE_ORDER = { form: 0, question: 1, dashboard: 2 };

const pickRunnableJob = async () => {
  if (!isOnline()) return null;
  const all = await getAllJobs();
  const now = Date.now();
  const runnable = all.filter((job) => {
    if (Array.isArray(job.dependsOnLocalIds) && job.dependsOnLocalIds.length > 0) return false;
    if (job.status === "uploading") return false;
    if (job.status === "error") return !job.nextAttemptAt || job.nextAttemptAt <= now;
    return job.status === "pending";
  });
  runnable.sort((a, b) => {
    const ta = TYPE_ORDER[a.entityType] ?? 9;
    const tb = TYPE_ORDER[b.entityType] ?? 9;
    if (ta !== tb) return ta - tb;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  return runnable[0] || null;
};

const uploadByType = async (job) => {
  const payload = toUploadPayload(job);
  if (job.entityType === "form") return saveForm(payload, "auto");
  if (job.entityType === "question") return analyticsGasClient.saveQuestion(payload);
  if (job.entityType === "dashboard") return analyticsGasClient.saveDashboard(payload);
  throw new Error(`unknown entityType: ${job.entityType}`);
};

// 成功したエンティティ自身のキャッシュ/状態を実 ID へ確定する。
const reconcileEntityCache = async (entityType, tempId, savedEntity) => {
  if (!savedEntity) return;
  if (entityType === "form") {
    if (formReconciler) {
      await formReconciler(tempId, savedEntity);
      return;
    }
    // フォールバック: provider 未登録（テスト等）なら formsCache を直接更新。
    try {
      const { forms = [], loadFailures = [], propertyStoreMode = "", folders = [] } = await getFormsFromCache();
      const next = forms.filter((f) => f.id !== tempId && f.id !== savedEntity.id);
      next.unshift({ ...savedEntity, pendingUpload: false });
      await saveFormsToCache(next, loadFailures, propertyStoreMode, { folders });
    } catch (_e) { /* noop */ }
    return;
  }
  const cache = entityType === "question" ? questionCache : dashboardCache;
  if (tempId !== savedEntity.id) await cache.remove(tempId);
  await cache.upsert({ ...savedEntity, pendingUpload: false });
  emitAnalyticsCacheChanged(entityType);
};

// 子エンティティのキャッシュ内参照を tempId → realId へ書き換える。
const rewriteChildRefsInCaches = async (entityType, tempId, realId) => {
  const remap = { [tempId]: realId };
  if (entityType === "form") {
    const questions = await questionCache.getAll();
    for (const q of questions) {
      if (applyRefRemapToPayload("question", q, remap)) await questionCache.upsert(q);
    }
    emitAnalyticsCacheChanged("question");
  } else if (entityType === "question") {
    const dashboards = await dashboardCache.getAll();
    for (const d of dashboards) {
      if (applyRefRemapToPayload("dashboard", d, remap)) await dashboardCache.upsert(d);
    }
    emitAnalyticsCacheChanged("dashboard");
  }
};

// サーバ側 alignReferencesOnSave_ が返す remap（実 ID → 実 ID）をローカル全体へ反映する。
const applyServerRemap = async (remap) => {
  if (!remap || Object.keys(remap).length === 0) return;
  const questions = await questionCache.getAll();
  for (const q of questions) {
    if (applyRefRemapToPayload("question", q, remap)) await questionCache.upsert(q);
  }
  const dashboards = await dashboardCache.getAll();
  for (const d of dashboards) {
    if (applyRefRemapToPayload("dashboard", d, remap)) await dashboardCache.upsert(d);
  }
  for (const [oldId, newId] of Object.entries(remap)) {
    await remapLocalIdInJobs(oldId, newId);
  }
  emitAnalyticsCacheChanged("question");
  emitAnalyticsCacheChanged("dashboard");
};

const reconcile = async (job, result) => {
  const tempId = job.localId;
  let realId = tempId;
  let savedEntity = null;
  let referenceSync = null;
  if (job.entityType === "form") {
    savedEntity = result?.form ? { ...result.form, driveFileUrl: result.fileUrl } : null;
    realId = savedEntity?.id || tempId;
  } else if (job.entityType === "question") {
    savedEntity = result?.question || null;
    realId = savedEntity?.id || tempId;
    referenceSync = result?.referenceSync || null;
  } else if (job.entityType === "dashboard") {
    savedEntity = result?.dashboard || null;
    realId = savedEntity?.id || tempId;
    referenceSync = result?.referenceSync || null;
  }

  if (realId !== tempId) await remapLocalIdInJobs(tempId, realId);
  await reconcileEntityCache(job.entityType, tempId, savedEntity);
  if (realId !== tempId) {
    await rewriteChildRefsInCaches(job.entityType, tempId, realId);
    emitTempIdResolved(tempId, realId);
  }
  if (referenceSync?.remap) await applyServerRemap(referenceSync.remap);
};

const runJob = async (job) => {
  await updateJob(job.jobId, { status: "uploading", lastError: null });
  setUploadUploading(1);
  try {
    const result = await uploadByType(job);
    await reconcile(job, result);
    await deleteJob(job.jobId);
    setUploadLastError(null);
  } catch (err) {
    const message = String(err?.message || err);
    const attempt = (job.attempt || 0) + 1;
    await updateJob(job.jobId, {
      status: "error",
      attempt,
      lastError: message,
      nextAttemptAt: Date.now() + computeBackoffMs(attempt),
    });
    setUploadLastError(message);
  } finally {
    setUploadUploading(0);
    await publishPending();
  }
};

const scheduleBackoffWake = async () => {
  if (backoffTimer || typeof setTimeout !== "function") return;
  const all = await getAllJobs();
  const now = Date.now();
  const waits = all
    .filter((j) => j.status === "error" && (j.dependsOnLocalIds?.length ?? 0) === 0 && j.nextAttemptAt)
    .map((j) => j.nextAttemptAt - now);
  if (!waits.length) return;
  const delay = Math.max(250, Math.min(...waits));
  backoffTimer = setTimeout(() => {
    backoffTimer = null;
    void processQueue();
  }, delay);
};

export async function processQueue() {
  if (processing) return;
  processing = true;
  if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null; }
  try {
    await publishPending();
    // eslint-disable-next-line no-constant-condition
    for (;;) {
      const job = await pickRunnableJob();
      if (!job) break;
      await runJob(job);
    }
  } finally {
    processing = false;
    setUploadUploading(0);
    await publishPending();
    await scheduleBackoffWake();
  }
}

// 新しいジョブを積んだ後などに呼ぶ（多重起動は processing ガードで吸収）。
export const kickUploadWorker = () => { void processQueue(); };

// 手動「再試行」: エラージョブのバックオフを解除して即再開する。
export const retryNow = async () => {
  const all = await getAllJobs();
  for (const job of all) {
    if (job.status === "error") {
      await updateJob(job.jobId, { status: "pending", attempt: 0, nextAttemptAt: null, lastError: null });
    }
  }
  setUploadLastError(null);
  void processQueue();
};

// アプリ起動時に 1 度だけ呼ぶ。前回セッションの残ジョブを再開し、online で再キックする。
export const startUploadWorker = () => {
  if (started) { void processQueue(); return; }
  started = true;
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("online", () => { void processQueue(); });
  }
  void publishPending().then(() => processQueue());
};

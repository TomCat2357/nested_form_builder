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
import { toErrorMessage } from "../../utils/errorMessage.js";
import { isLocalId } from "../../core/ids.js";
import {
  saveForm,
  getForm,
  createFolder as createFolderInGas,
  moveItems as moveItemsInGas,
  renameFolder as renameFolderInGas,
  deleteFolder as deleteFolderInGas,
  archiveForms as archiveFormsInGas,
  unarchiveForms as unarchiveFormsInGas,
} from "../../services/gasClient.js";
import { analyticsGasClient } from "../../features/analytics/analyticsGasClient.js";
import { saveFormsToCache, getFormsFromCache } from "./formsCache.js";
import {
  questionCache,
  dashboardCache,
  emitAnalyticsCacheChanged,
  emitAnalyticsFoldersChanged,
} from "../../features/analytics/analyticsCache.js";
import {
  enqueueJob,
  getAllJobs,
  updateJob,
  deleteJob,
  deleteJobsForLocalId,
  countPendingByType,
  remapLocalIdInJobs,
  toUploadPayload,
  applyRefRemapToPayload,
} from "./uploadQueue.js";
import { registryStore } from "./registryStore.js";
import {
  setUploadUploading,
  setUploadPending,
  setUploadLastError,
} from "../../features/search/globalSyncState.js";
import { uploadLog } from "../../utils/uploadLog.js";

// ---------------------------------------------------------------------------
// フォーム reconcile コールバック（AppDataProvider が登録）
// ---------------------------------------------------------------------------
let formReconciler = null;
export const registerFormReconciler = (fn) => {
  formReconciler = typeof fn === "function" ? fn : null;
};

// 新規フォーム（local_…）を「破棄」したとき、React 状態と formsCache から取り除くための
// コールバック（AppDataProvider が removeFormsState を登録）。未登録なら formsCache を直接更新。
let formRemover = null;
export const registerFormRemover = (fn) => {
  formRemover = typeof fn === "function" ? fn : null;
};

// ---------------------------------------------------------------------------
// フォルダ reconcile コールバック（種類別）。op ジョブ成功後、サーバ確定の folders 一覧を
// 各一覧 UI へ静かに反映する（ネット往復なし）。form は AppDataProvider、
// question/dashboard は一覧ページが登録する。
// ---------------------------------------------------------------------------
const folderReconcilers = Object.create(null); // entityType -> fn(folders)
export const registerFolderReconciler = (entityType, fn) => {
  if (typeof fn === "function") folderReconcilers[entityType] = fn;
  else delete folderReconcilers[entityType];
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

export const publishPending = async () => {
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
  if (!isOnline()) {
    uploadLog.logVerbose("pick", "offline — skip", {});
    return null;
  }
  const all = await getAllJobs();
  const now = Date.now();
  let blockedByDeps = 0;
  let backoffWaiting = 0;
  const runnable = all.filter((job) => {
    if (Array.isArray(job.dependsOnLocalIds) && job.dependsOnLocalIds.length > 0) { blockedByDeps += 1; return false; }
    if (job.status === "uploading") return false;
    if (job.status === "error") {
      const ready = !job.nextAttemptAt || job.nextAttemptAt <= now;
      if (!ready) backoffWaiting += 1;
      return ready;
    }
    return job.status === "pending";
  });
  runnable.sort((a, b) => {
    const ta = TYPE_ORDER[a.entityType] ?? 9;
    const tb = TYPE_ORDER[b.entityType] ?? 9;
    if (ta !== tb) return ta - tb;
    const ca = a.createdAt || 0;
    const cb = b.createdAt || 0;
    if (ca !== cb) return ca - cb;
    return (a.opSeq || 0) - (b.opSeq || 0);
  });
  const picked = runnable[0] || null;
  if (picked) {
    uploadLog.logVerbose("pick", "runnable", {
      jobId: picked.jobId, entityType: picked.entityType, kind: picked.kind, status: picked.status, attempt: picked.attempt,
    });
  } else if (all.length > 0) {
    // 走らせられるジョブが無いのに件数が残る＝「出続ける」状態。理由を可視化する。
    uploadLog.logVerbose("pick", "none runnable (queue not empty)", {
      total: all.length, blockedByDeps, backoffWaiting,
    });
  }
  return picked;
};

// 操作（op）ジョブを対応する GAS 呼び出しへ振り分ける。
const uploadOp = async (job) => {
  const p = job.opPayload || {};
  if (job.entityType === "form") {
    switch (job.opType) {
      case "createFolder": return createFolderInGas(p.path);
      case "move": return moveItemsInGas(p);
      case "renameFolder": return renameFolderInGas(p);
      case "deleteFolder": return deleteFolderInGas(p.path);
      case "archive": return archiveFormsInGas(p.ids);
      case "unarchive": return unarchiveFormsInGas(p.ids);
      default: throw new Error(`unknown form op: ${job.opType}`);
    }
  }
  const E = job.entityType === "dashboard" ? "Dashboard" : "Question";
  switch (job.opType) {
    case "createFolder": return analyticsGasClient[`create${E}Folder`](p.path);
    case "move": return analyticsGasClient[`move${E}s`](p);
    case "renameFolder": return analyticsGasClient[`rename${E}Folder`](p);
    case "deleteFolder": return analyticsGasClient[`delete${E}Folder`](p.path);
    case "archive": return analyticsGasClient[`archive${E}s`](p.ids);
    case "unarchive": return analyticsGasClient[`unarchive${E}s`](p.ids);
    default: throw new Error(`unknown analytics op: ${job.opType}`);
  }
};

const uploadByType = async (job) => {
  uploadLog.logVerbose("gas", "call", {
    jobId: job.jobId, kind: job.kind, entityType: job.entityType, opType: job.opType, isNew: isLocalId(job.localId),
  });
  if (job.kind === "op") return uploadOp(job);
  const payload = toUploadPayload(job);
  if (job.entityType === "form") return saveForm(payload, "auto");
  if (job.entityType === "question") return analyticsGasClient.saveQuestion(payload);
  if (job.entityType === "dashboard") return analyticsGasClient.saveDashboard(payload);
  throw new Error(`unknown entityType: ${job.entityType}`);
};

// entityType（form/question/dashboard）→ registry kind（forms/questions/dashboards）。
const REGISTRY_KIND_BY_ENTITY = { form: "forms", question: "questions", dashboard: "dashboards" };

// 保存ジョブ完了（local_ → 実 fileId 確定）時に registry 作業キャッシュへ実 fileId を upsert する
// （非ブロッキング・fail-safe）。forms のラベルは settings.formTitle、analytics は name。
const upsertRegistryForSaved = (entityType, savedEntity) => {
  if (!savedEntity || !savedEntity.id) return;
  const kind = REGISTRY_KIND_BY_ENTITY[entityType];
  if (!kind) return;
  const name = entityType === "form"
    ? ((savedEntity.settings && savedEntity.settings.formTitle) || "")
    : (savedEntity.name || "");
  registryStore
    .upsert({
      fileId: savedEntity.id,
      name,
      folder: typeof savedEntity.folder === "string" ? savedEntity.folder : "",
      driveFileUrl: savedEntity.driveFileUrl || "",
    }, kind)
    .catch(() => {});
};

// 成功したエンティティ自身のキャッシュ/状態を実 ID へ確定する。
const reconcileEntityCache = async (entityType, tempId, savedEntity) => {
  if (!savedEntity) return;
  upsertRegistryForSaved(entityType, savedEntity);
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

// op ジョブ成功後の reconcile。フォルダ構造を変える op はサーバ確定 folders を静かに採用し、
// 各エンティティの folder はローカルが正なので触らない。archive/unarchive は反映済みで何もしない。
const FOLDER_STRUCTURE_OPS = new Set(["createFolder", "move", "renameFolder", "deleteFolder"]);
const reconcileOp = async (job, result) => {
  if (FOLDER_STRUCTURE_OPS.has(job.opType)) {
    const folders = Array.isArray(result?.folders) ? result.folders : null;
    if (job.entityType === "form") {
      const fn = folderReconcilers.form;
      if (folders && fn) {
        try { await fn(folders); } catch (_e) { /* noop */ }
      }
    } else if (folders) {
      // question / dashboard はフォルダ pub/sub で一覧ページへサーバ確定 folders を反映する。
      emitAnalyticsFoldersChanged(job.entityType, folders);
    }
  }
};

const reconcile = async (job, result) => {
  if (job.kind === "op") {
    await reconcileOp(job, result);
    return;
  }
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

  uploadLog.logVerbose("reconcile", "entity", { jobId: job.jobId, entityType: job.entityType, tempId, realId });
  if (realId !== tempId) await remapLocalIdInJobs(tempId, realId);
  await reconcileEntityCache(job.entityType, tempId, savedEntity);
  if (realId !== tempId) {
    await rewriteChildRefsInCaches(job.entityType, tempId, realId);
    emitTempIdResolved(tempId, realId);
  }
  if (referenceSync?.remap) await applyServerRemap(referenceSync.remap);
};

const runJob = async (job) => {
  uploadLog.logVerbose("run", "start", { jobId: job.jobId, entityType: job.entityType, kind: job.kind, localId: job.localId });
  await updateJob(job.jobId, { status: "uploading", lastError: null });
  setUploadUploading(1);
  try {
    const result = await uploadByType(job);
    await reconcile(job, result);
    await deleteJob(job.jobId);
    setUploadLastError(null);
    uploadLog.logVerbose("run", "success", { jobId: job.jobId, entityType: job.entityType, localId: job.localId });
  } catch (err) {
    const message = String(toErrorMessage(err));
    const attempt = (job.attempt || 0) + 1;
    // 失敗の本パスは verbose 非依存で常に出す（「なぜできなかったか」を残す）。
    uploadLog.warn("run", "fail", { jobId: job.jobId, entityType: job.entityType, localId: job.localId, attempt, message });
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

/**
 * オフラインファースト保存の共通プリミティブ。
 *
 * Form / Question / Dashboard はいずれも「（任意で）キャッシュへ即時反映 → uploadQueue へ
 * write-behind ジョブを積む → ワーカー起動 →（任意で）一覧へ変更通知」という同型の保存パスを持つ。
 * 種別ごとの差異（キャッシュ書き込み手段・変更通知の有無）だけを引数で受け取り、
 * write-behind プリミティブ本体（enqueueJob + kickUploadWorker）を 1 箇所へ集約する。
 *
 * @param {Object} args
 * @param {"form"|"question"|"dashboard"} args.entityType uploadQueue のジョブ種別
 * @param {Object} args.record 保存レコード。record.id を localId として使う（新規は呼び出し側で local_… を採番済み）
 * @param {(record: Object) => (Promise<void>|void)} [args.upsertCache] キャッシュ即時反映。
 *   Question/Dashboard は cache.upsert。Form は AppDataProvider 側が反映するため省略する。
 * @param {(entityType: string) => void} [args.emit] 一覧への変更通知。analytics は emitAnalyticsCacheChanged。Form は省略。
 * @param {string[]} [args.dependsOnLocalIds] 参照先 local_… への依存（参照先 save 完了まで待つ）。
 * @returns {Promise<Object>} 渡した record をそのまま返す。
 */
export const enqueueEntitySave = async ({ entityType, record, upsertCache, emit, dependsOnLocalIds }) => {
  if (upsertCache) await upsertCache(record);
  await enqueueJob({ entityType, localId: record.id, payload: record, dependsOnLocalIds });
  kickUploadWorker();
  if (emit) emit(entityType);
  return record;
};

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

// 個別「再試行」: 指定 1 ジョブのバックオフを解除して即再開する（retryNow の単体版）。
export const retryJob = async (jobId) => {
  uploadLog.logVerbose("retry", "single", { jobId });
  await updateJob(jobId, { status: "pending", attempt: 0, nextAttemptAt: null, lastError: null });
  void processQueue();
};

// ---------------------------------------------------------------------------
// 取り消し（リセット）
//   - keepLocal: アップロードキューのジョブだけ削除。ローカルのデータ/キャッシュは残す。
//   - discard:   ジョブ削除に加えてローカルの未送信内容も巻き戻す。
//                新規(local_…) はローカルから削除、既存編集(実 fileId) はサーバ最新版へ revert。
// uploading 中のジョブは in-flight 完了で reconcile されうるため、UI 側で操作を無効化する想定。
// ---------------------------------------------------------------------------

// 新規フォーム（local_…）をローカル状態/キャッシュから取り除く。
const discardLocalForm = async (localId) => {
  if (formRemover) {
    await formRemover([localId]);
    return;
  }
  // フォールバック: provider 未登録（テスト等）なら formsCache を直接更新。
  try {
    const { forms = [], loadFailures = [], propertyStoreMode = "", folders = [] } = await getFormsFromCache();
    const next = forms.filter((f) => f.id !== localId);
    await saveFormsToCache(next, loadFailures, propertyStoreMode, { folders });
  } catch (_e) { /* noop */ }
};

// 既存編集（実 fileId）をサーバ最新版へ戻す。サーバ直フェッチで cache を上書きする
// （analyticsStore.getById はキャッシュ優先で古い未送信版を返すため使わない）。
const revertEntityToServer = async (entityType, realId) => {
  if (entityType === "form") {
    let serverForm = null;
    try { serverForm = await getForm(realId); } catch (err) {
      uploadLog.warn("revert", "getForm failed", { realId, message: String(toErrorMessage(err)) });
      return;
    }
    if (!serverForm) return;
    const saved = { ...serverForm, pendingUpload: false };
    if (formReconciler) await formReconciler(realId, saved);
    else {
      try {
        const { forms = [], loadFailures = [], propertyStoreMode = "", folders = [] } = await getFormsFromCache();
        const next = forms.filter((f) => f.id !== realId);
        next.unshift(saved);
        await saveFormsToCache(next, loadFailures, propertyStoreMode, { folders });
      } catch (_e) { /* noop */ }
    }
    return;
  }
  const cache = entityType === "question" ? questionCache : dashboardCache;
  let serverEntity = null;
  try {
    const res = entityType === "dashboard"
      ? await analyticsGasClient.getDashboard(realId)
      : await analyticsGasClient.getQuestion(realId);
    serverEntity = res?.[entityType] || null;
  } catch (err) {
    uploadLog.warn("revert", "getEntity failed", { entityType, realId, message: String(toErrorMessage(err)) });
    return;
  }
  if (serverEntity) await cache.upsert({ ...serverEntity, pendingUpload: false });
  else await cache.remove(realId);
  emitAnalyticsCacheChanged(entityType);
};

// ジョブをキューから外すだけ（ローカルは残す）。
export const cancelJobKeepLocal = async (jobId) => {
  uploadLog.logVerbose("cancel", "keepLocal", { jobId });
  await deleteJob(jobId);
  await publishPending();
};

// ジョブを削除し、ローカルの未送信内容も破棄する（新規は削除 / 既存はサーバ版へ revert）。
export const cancelJobDiscard = async (job) => {
  if (!job) return;
  uploadLog.logVerbose("cancel", "discard", { jobId: job.jobId, entityType: job.entityType, kind: job.kind, localId: job.localId });
  await deleteJob(job.jobId);
  // op ジョブはローカルへ楽観反映済みで巻き戻しが重いため、キュー除去のみ（keepLocal 相当）。
  if (job.kind === "op") { await publishPending(); return; }

  const { entityType, localId } = job;
  await deleteJobsForLocalId(localId); // coalesce 漏れの同 localId ジョブも掃除
  if (isLocalId(localId)) {
    if (entityType === "form") {
      await discardLocalForm(localId);
    } else {
      const cache = entityType === "question" ? questionCache : dashboardCache;
      await cache.remove(localId);
      emitAnalyticsCacheChanged(entityType);
    }
  } else if (entityType === "form") {
    // 既存編集フォームの破棄(=schema までサーバ版へ revert)は初版スコープ外。
    // ジョブだけ外し、ローカルの編集内容は残す（keepLocal 相当）。UI 側も 破棄 を無効化する。
    uploadLog.logVerbose("cancel", "discard form(existing) → keepLocal", { localId });
  } else {
    await revertEntityToServer(entityType, localId);
  }
  await publishPending();
};

// 全ジョブをキューから外すだけ。
export const cancelAllKeepLocal = async () => {
  uploadLog.logVerbose("cancel", "all keepLocal", {});
  const all = await getAllJobs();
  for (const job of all) await deleteJob(job.jobId);
  await publishPending();
};

// 全ジョブを破棄（form→question→dashboard→op 順で逐次。IndexedDB 競合を避ける）。
export const cancelAllDiscard = async () => {
  uploadLog.logVerbose("cancel", "all discard", {});
  const all = await getAllJobs();
  const order = (job) => (job.kind === "op" ? 9 : (TYPE_ORDER[job.entityType] ?? 8));
  const sorted = all.slice().sort((a, b) => order(a) - order(b));
  for (const job of sorted) await cancelJobDiscard(job);
  await publishPending();
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

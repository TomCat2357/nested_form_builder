/**
 * オフラインファースト保存の永続アップロードキュー（write-behind）。
 *
 * フォーム / クエスチョン / ダッシュボードの保存は、まず IndexedDB（各エンティティの
 * キャッシュ）へ書き込み、ここへ「アップロードジョブ」を 1 件積む。バックグラウンドの
 * uploadWorker が逐次 Google Drive へアップロードし、成功したらジョブを削除する。
 * ジョブはリロード/オフラインを跨いで残り、再接続・再起動で再開される。
 *
 * 1 ジョブの形:
 *   {
 *     jobId,             // ジョブ固有 ID
 *     entityType,        // "form" | "question" | "dashboard"
 *     localId,           // 現在のローカル ID（新規は local_… / 既存は実 fileId）
 *     realId,            // 付け替え後の実 fileId（未確定は null）
 *     payload,           // 送信するエンティティのスナップショット
 *     status,            // "pending" | "uploading" | "error"
 *     attempt,           // 連続失敗回数（バックオフ計算に使う）
 *     lastError,         // 直近のエラー文言
 *     dependsOnLocalIds, // このペイロードが参照する未アップロードの local_ id 群
 *     createdAt, updatedAt
 *   }
 */

import { STORE_NAMES } from "../../core/constants.js";
import { withTransaction, waitForRequest } from "./dbHelpers.js";
import { deepClone } from "../../core/schema.js";
import { genId, isLocalId } from "../../core/ids.js";
import { isUnderFolder } from "../../utils/folderTree.js";
import { uploadLog } from "../../utils/uploadLog.js";

const STORE = STORE_NAMES.uploadQueue;

// ---------------------------------------------------------------------------
// ジョブ変更の pub/sub（状態パネル用）。
// uploadSyncState（件数）の uploadSyncListeners とは別立て。件数が変わらない
// pending→uploading→error の遷移や lastError 更新もパネルへ届ける必要があるため、
// CRUD（enqueue/update/delete/remap）の確定後にここで発火し、購読側は getAllJobs を引き直す。
// ---------------------------------------------------------------------------
export const uploadQueueListeners = new Set();
export const subscribeUploadQueue = (fn) => {
  uploadQueueListeners.add(fn);
  return () => uploadQueueListeners.delete(fn);
};
export const emitUploadQueueChanged = () => {
  uploadQueueListeners.forEach((fn) => {
    try { fn(); } catch (_e) { /* noop */ }
  });
};

// ---------------------------------------------------------------------------
// 参照フィールドのユーティリティ（種類別）
// ---------------------------------------------------------------------------

// クエスチョンが参照するフォーム ID 群（gui.formId / formSources[].formId）。
const collectQuestionFormIds = (payload) => {
  const ids = [];
  const q = payload?.query || {};
  if (q?.gui?.formId) ids.push(q.gui.formId);
  if (Array.isArray(q?.formSources)) {
    for (const src of q.formSources) {
      if (src?.formId) ids.push(src.formId);
    }
  }
  return ids;
};

// ダッシュボードが参照するクエスチョン ID 群（cards[].questionId）。
const collectDashboardQuestionIds = (payload) => {
  const ids = [];
  if (Array.isArray(payload?.cards)) {
    for (const card of payload.cards) {
      if (card?.questionId) ids.push(card.questionId);
    }
  }
  return ids;
};

// ペイロードが参照する ID 群（種類別）。依存解決と参照書き換えで共有する。
export const collectReferencedIds = (entityType, payload) => {
  if (entityType === "question") return collectQuestionFormIds(payload);
  if (entityType === "dashboard") return collectDashboardQuestionIds(payload);
  return [];
};

// ペイロードが参照する「未アップロードの local_ id」だけを返す（依存ジョブ）。
export const collectDependsOnLocalIds = (entityType, payload) =>
  collectReferencedIds(entityType, payload).filter(isLocalId);

// remap = { [oldId]: newId } をペイロードの参照フィールドに適用する。変更があれば true。
export const applyRefRemapToPayload = (entityType, payload, remap) => {
  if (!payload || !remap || Object.keys(remap).length === 0) return false;
  let changed = false;
  if (entityType === "question") {
    const q = payload.query;
    if (q?.gui?.formId && remap[q.gui.formId]) {
      q.gui.formId = remap[q.gui.formId];
      changed = true;
    }
    if (Array.isArray(q?.formSources)) {
      for (const src of q.formSources) {
        if (src?.formId && remap[src.formId]) {
          src.formId = remap[src.formId];
          changed = true;
        }
      }
    }
  } else if (entityType === "dashboard") {
    if (Array.isArray(payload.cards)) {
      for (const card of payload.cards) {
        if (card?.questionId && remap[card.questionId]) {
          card.questionId = remap[card.questionId];
          changed = true;
        }
      }
    }
  }
  return changed;
};

// op ジョブの opPayload 内 id 配列（formIds / itemIds / ids）に remap を適用する。
// 移動/アーカイブが未アップロードの local_ エンティティを参照していた場合、その save 完了で
// local_ → 実 fileId へ付け替えるために使う。変更があれば true。
export const applyRefRemapToOpPayload = (opType, opPayload, remap) => {
  if (!opPayload || !remap || Object.keys(remap).length === 0) return false;
  let changed = false;
  for (const key of ["formIds", "itemIds", "ids"]) {
    const arr = opPayload[key];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] && remap[arr[i]]) {
        arr[i] = remap[arr[i]];
        changed = true;
      }
    }
  }
  return changed;
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

const nowMs = () => Date.now();

// 新規ジョブを積む。ただし同じ (entityType, localId) の保留/エラージョブが既にあれば、
// 最新ペイロードで上書き（coalesce）して二重アップロードを防ぐ。in-flight 中のジョブは
// 触らず、別ジョブとして積む（in-flight 完了後に逐次処理される）。
export const enqueueJob = async ({ entityType, localId, payload, dependsOnLocalIds }) => {
  const deps = Array.isArray(dependsOnLocalIds)
    ? dependsOnLocalIds
    : collectDependsOnLocalIds(entityType, payload);
  const { job, coalesced } = await withTransaction(STORE, "readwrite", async (store) => {
    const all = (await waitForRequest(store.getAll())) || [];
    const existing = all.find(
      (j) => j.kind !== "op" && j.entityType === entityType && j.localId === localId && j.status !== "uploading",
    );
    const base = {
      kind: "save",
      entityType,
      localId,
      realId: null,
      payload: deepClone(payload),
      status: "pending",
      attempt: 0,
      lastError: null,
      dependsOnLocalIds: deps.slice(),
      updatedAt: nowMs(),
    };
    if (existing) {
      const merged = { ...existing, ...base, jobId: existing.jobId, createdAt: existing.createdAt };
      await waitForRequest(store.put(merged));
      return { job: merged, coalesced: true };
    }
    const created = { ...base, jobId: genId(), createdAt: nowMs() };
    await waitForRequest(store.put(created));
    return { job: created, coalesced: false };
  });
  uploadLog.logVerbose("enqueue", coalesced ? "save job (coalesced)" : "save job", {
    entityType, localId, jobId: job.jobId, isNew: isLocalId(localId), deps,
  });
  emitUploadQueueChanged();
  return job;
};

// 操作ジョブ（move / renameFolder / deleteFolder / archive / unarchive）を積む。
// save と違い coalesce しない（localId:null）。連続操作は opSeq 昇順で逐次適用される。
// dependsOnLocalIds に未アップロードの local_ id を渡すと、その save 完了まで実行を待つ。
export const enqueueOpJob = async ({ entityType, opType, opPayload, dependsOnLocalIds }) => {
  const deps = Array.isArray(dependsOnLocalIds) ? dependsOnLocalIds.slice() : [];
  const job = await withTransaction(STORE, "readwrite", async (store) => {
    const all = (await waitForRequest(store.getAll())) || [];
    let maxSeq = 0;
    for (const j of all) {
      if (typeof j.opSeq === "number" && j.opSeq > maxSeq) maxSeq = j.opSeq;
    }
    const job = {
      jobId: genId(),
      kind: "op",
      entityType,
      opType,
      opPayload: deepClone(opPayload || {}),
      opSeq: maxSeq + 1,
      localId: null,
      realId: null,
      status: "pending",
      attempt: 0,
      lastError: null,
      dependsOnLocalIds: deps,
      createdAt: nowMs(),
      updatedAt: nowMs(),
    };
    await waitForRequest(store.put(job));
    return job;
  });
  uploadLog.logVerbose("enqueue", "op job", { entityType, opType, opSeq: job.opSeq, jobId: job.jobId, deps });
  emitUploadQueueChanged();
  return job;
};

export const getAllJobs = async () =>
  withTransaction(STORE, "readonly", async (store) => (await waitForRequest(store.getAll())) || []);

export const updateJob = async (jobId, patch) => {
  const next = await withTransaction(STORE, "readwrite", async (store) => {
    const current = await waitForRequest(store.get(jobId));
    if (!current) return null;
    const merged = { ...current, ...patch, updatedAt: nowMs() };
    await waitForRequest(store.put(merged));
    return merged;
  });
  emitUploadQueueChanged();
  return next;
};

export const deleteJob = async (jobId) => {
  await withTransaction(STORE, "readwrite", async (store) => {
    await waitForRequest(store.delete(jobId));
  });
  uploadLog.logVerbose("queue", "deleteJob", { jobId });
  emitUploadQueueChanged();
};

// 指定 localId に紐づくジョブを全削除（エンティティ削除/アーカイブ時の取り消し用）。
export const deleteJobsForLocalId = async (localId) => {
  await withTransaction(STORE, "readwrite", async (store) => {
    const all = (await waitForRequest(store.getAll())) || [];
    for (const job of all) {
      if (job.localId === localId) await waitForRequest(store.delete(job.jobId));
    }
  });
  uploadLog.logVerbose("queue", "deleteJobsForLocalId", { localId });
  emitUploadQueueChanged();
};

// 指定フォルダ（path 自身/配下）を対象にする保留 op を取り消す。
// deleteFolder で配下を消す際、そこへ移動する move や、そこに作る createFolder が
// あとから再生成するのを防ぐ（消す前に積んだ操作を無効化する）。
export const deleteOpJobsForFolderPrefix = async (entityType, path) => {
  await withTransaction(STORE, "readwrite", async (store) => {
    const all = (await waitForRequest(store.getAll())) || [];
    for (const job of all) {
      if (job.kind !== "op" || job.entityType !== entityType) continue;
      if (job.status === "uploading") continue;
      const p = job.opPayload || {};
      const targets =
        (job.opType === "move" && isUnderFolder(p.destPath, path)) ||
        (job.opType === "createFolder" && isUnderFolder(p.path, path));
      if (targets) await waitForRequest(store.delete(job.jobId));
    }
  });
  emitUploadQueueChanged();
};

// 種類別の未アップロード（pending + error + uploading）件数。インジケーター用。
export const countPendingByType = async () => {
  const all = await getAllJobs();
  const counts = { form: 0, question: 0, dashboard: 0 };
  for (const job of all) {
    if (counts[job.entityType] !== undefined) counts[job.entityType] += 1;
  }
  return counts;
};

// ジョブの表示名（状態パネル用）。save は payload から、op は操作種別で要約する。
export const getJobLabel = (job) => {
  if (!job) return "";
  if (job.kind === "op") {
    const p = job.opPayload || {};
    const count = Array.isArray(p.ids) ? p.ids.length
      : Array.isArray(p.itemIds) ? p.itemIds.length
        : Array.isArray(p.formIds) ? p.formIds.length : 0;
    const target = p.path || p.destPath || p.newName || "";
    const suffix = target ? `（${target}）` : count ? `（${count}件）` : "";
    return `操作: ${job.opType || "?"}${suffix}`;
  }
  const payload = job.payload || {};
  if (job.entityType === "form") {
    return (payload.settings && payload.settings.formTitle) || payload.name || job.localId || "(無題)";
  }
  return payload.name || job.localId || "(無題)";
};

// 「なぜ未アップロードのままか」を 1 行で説明する（状態パネルの理由列）。
// 優先順: 依存待ち > 失敗(lastError) > 送信中 > 待機中。
// jobsById は dependsOnLocalIds を相手ジョブ名へ解決するための Map（任意）。
export const getJobReason = (job, jobsById) => {
  if (!job) return "";
  const deps = Array.isArray(job.dependsOnLocalIds) ? job.dependsOnLocalIds : [];
  if (deps.length > 0) {
    const names = deps.map((id) => {
      const dep = jobsById && typeof jobsById.get === "function" ? jobsById.get(id) : null;
      return dep ? getJobLabel(dep) : String(id).slice(0, 12);
    });
    return `参照先（${names.join("・")}）のアップロード待ち`;
  }
  if (job.status === "error") {
    const base = job.lastError ? String(job.lastError) : "アップロードに失敗しました";
    return job.nextAttemptAt ? `${base}（自動再試行待ち）` : base;
  }
  if (job.status === "uploading") return "送信中…";
  return "待機中（順番待ち）";
};

// tempId → realId の付け替えをキュー全体へ反映する。
//   - localId が tempId のジョブ（＝そのエンティティ自身のジョブ）は localId/realId を更新
//   - payload が tempId を参照するジョブは参照フィールドを realId へ書き換え
//   - dependsOnLocalIds から tempId を除去（解決済みなので依存ではなくなる）
export const remapLocalIdInJobs = async (tempId, realId) => {
  if (!tempId || !realId || tempId === realId) return;
  const remap = { [tempId]: realId };
  await withTransaction(STORE, "readwrite", async (store) => {
    const all = (await waitForRequest(store.getAll())) || [];
    for (const job of all) {
      let changed = false;
      if (job.localId === tempId) {
        job.localId = realId;
        job.realId = realId;
        changed = true;
      }
      if (job.kind === "op") {
        if (applyRefRemapToOpPayload(job.opType, job.opPayload, remap)) changed = true;
      } else if (applyRefRemapToPayload(job.entityType, job.payload, remap)) {
        changed = true;
      }
      if (Array.isArray(job.dependsOnLocalIds) && job.dependsOnLocalIds.includes(tempId)) {
        job.dependsOnLocalIds = job.dependsOnLocalIds.filter((id) => id !== tempId);
        changed = true;
      }
      if (changed) {
        job.updatedAt = nowMs();
        await waitForRequest(store.put(job));
      }
    }
  });
  emitUploadQueueChanged();
};

// 送信用ペイロードを作る。新規（local_ id）は id を外して GAS に新規ファイルを作らせる。
// 既存は実 fileId をそのまま id として上書きさせる。
export const toUploadPayload = (job) => {
  const payload = deepClone(job.payload || {});
  if (isLocalId(job.localId)) {
    delete payload.id;
  } else {
    payload.id = job.localId;
  }
  delete payload.pendingUpload;
  return payload;
};

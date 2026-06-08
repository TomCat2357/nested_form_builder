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

const STORE = STORE_NAMES.uploadQueue;

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
  return withTransaction(STORE, "readwrite", async (store) => {
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
      return merged;
    }
    const job = { ...base, jobId: genId(), createdAt: nowMs() };
    await waitForRequest(store.put(job));
    return job;
  });
};

// 操作ジョブ（move / renameFolder / deleteFolder / archive / unarchive）を積む。
// save と違い coalesce しない（localId:null）。連続操作は opSeq 昇順で逐次適用される。
// dependsOnLocalIds に未アップロードの local_ id を渡すと、その save 完了まで実行を待つ。
export const enqueueOpJob = async ({ entityType, opType, opPayload, dependsOnLocalIds }) => {
  const deps = Array.isArray(dependsOnLocalIds) ? dependsOnLocalIds.slice() : [];
  return withTransaction(STORE, "readwrite", async (store) => {
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
};

export const getAllJobs = async () =>
  withTransaction(STORE, "readonly", async (store) => (await waitForRequest(store.getAll())) || []);

export const updateJob = async (jobId, patch) =>
  withTransaction(STORE, "readwrite", async (store) => {
    const current = await waitForRequest(store.get(jobId));
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: nowMs() };
    await waitForRequest(store.put(next));
    return next;
  });

export const deleteJob = async (jobId) =>
  withTransaction(STORE, "readwrite", async (store) => {
    await waitForRequest(store.delete(jobId));
  });

// 指定 localId に紐づくジョブを全削除（エンティティ削除/アーカイブ時の取り消し用）。
export const deleteJobsForLocalId = async (localId) =>
  withTransaction(STORE, "readwrite", async (store) => {
    const all = (await waitForRequest(store.getAll())) || [];
    for (const job of all) {
      if (job.localId === localId) await waitForRequest(store.delete(job.jobId));
    }
  });

// 指定フォルダ（path 自身/配下）を対象にする保留 op を取り消す。
// deleteFolder で配下を消す際、そこへ移動する move や、そこに作る createFolder が
// あとから再生成するのを防ぐ（消す前に積んだ操作を無効化する）。
export const deleteOpJobsForFolderPrefix = async (entityType, path) =>
  withTransaction(STORE, "readwrite", async (store) => {
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

// 種類別の未アップロード（pending + error + uploading）件数。インジケーター用。
export const countPendingByType = async () => {
  const all = await getAllJobs();
  const counts = { form: 0, question: 0, dashboard: 0 };
  for (const job of all) {
    if (counts[job.entityType] !== undefined) counts[job.entityType] += 1;
  }
  return counts;
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

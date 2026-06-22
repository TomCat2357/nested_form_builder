/**
 * FormPage の state 変換系コールバック本体。
 *
 * FormPage.jsx の useCallback 群から本体ロジックを抽出。
 * useCallback でラップするのは呼び出し側 (FormPage) の責務。
 */

import { restoreResponsesFromData, collectFileUploadFolderUrls, collectFileUploadFolderNames } from "../utils/responses.js";
import { collectFileUploadFields } from "../core/schema.js";
import { hasScriptRun, trashDriveFilesByIds } from "../services/gasClient.js";
import { getCachedEntryWithIndex } from "../app/state/recordsMemoryStore.js";
import {
  appendDriveFileId,
  normalizeDriveFileIds,
  normalizeDriveFolderState,
  resolveEffectiveDriveFolderUrl,
} from "../utils/driveFolderState.js";
import {
  diffResponses,
  pickLatestEntry,
  sampleKeys,
  toEntryVersion,
  toResponseObject,
} from "./formPageHelpers.js";

/**
 * setResponses 経由で responses を更新し、副作用としてログを出す。
 */
export function runCommitResponses(setResponses, { source, updater, forceLog = false, meta = null }, ctx) {
  const { responseMutationSeqRef, formId, entryId, isDirtyRef, isViewModeRef } = ctx;
  setResponses((prevState) => {
    const prev = toResponseObject(prevState);
    const rawNextState = typeof updater === "function" ? updater(prevState) : updater;
    const nextState = rawNextState === undefined || rawNextState === null ? {} : rawNextState;
    const next = toResponseObject(nextState);
    if (nextState === prevState) return prevState;

    const diff = diffResponses(prev, next);
    const shouldLog = forceLog || diff.removedKeys.length > 0 || diff.changedKeys.length > 6 || diff.addedKeys.length > 6;
    if (shouldLog) {
      responseMutationSeqRef.current += 1;
      if (process.env.NODE_ENV !== "production") console.log("[FormPage] responses mutated", {
        seq: responseMutationSeqRef.current,
        source,
        formId,
        entryId: entryId || "new",
        isDirty: isDirtyRef.current,
        isViewMode: isViewModeRef.current,
        prevCount: diff.prevCount,
        nextCount: diff.nextCount,
        addedCount: diff.addedKeys.length,
        removedCount: diff.removedKeys.length,
        changedCount: diff.changedKeys.length,
        addedKeys: sampleKeys(diff.addedKeys),
        removedKeys: sampleKeys(diff.removedKeys),
        changedKeys: sampleKeys(diff.changedKeys),
        ...(meta || {}),
      });
    }
    return nextState;
  });
}

/**
 * エントリオブジェクトを取り込み、関連する全 state を更新する。
 */
export function runApplyEntryToState(nextEntry, fallbackEntryId, source, ctx) {
  const {
    normalizedSchemaRef,
    responsesRef,
    formId,
    entryId,
    isDirtyRef,
    isViewModeRef,
    initialResponsesRef,
    initialDriveFolderStatesRef,
    setEntry,
    setRecordNoInput,
    setDriveFolderStates,
    setCurrentRecordId,
    commitResponses,
  } = ctx;

  const schema = normalizedSchemaRef.current;
  const restored = restoreResponsesFromData(schema, nextEntry?.data || {}, nextEntry?.dataUnixMs || {});
  const folderUrlsByField = collectFileUploadFolderUrls(schema, nextEntry?.data || {});
  const folderNamesByField = collectFileUploadFolderNames(schema, nextEntry?.data || {});
  const uploadFields = collectFileUploadFields(schema);
  const nextDriveFolderStates = {};
  uploadFields.forEach((field) => {
    const fid = field?.id;
    if (!fid) return;
    const folderUrl = folderUrlsByField[fid] || "";
    // 論理パス（folderName）も state へ復元し、再保存でセルへ書き戻す（前進補完）。
    const folderName = folderNamesByField[fid] || "";
    nextDriveFolderStates[fid] = normalizeDriveFolderState({
      resolvedUrl: folderUrl,
      inputUrl: folderUrl,
      folderName,
      autoCreated: false,
    });
  });
  const previous = responsesRef.current;
  const diff = diffResponses(previous, restored);
  const hasPotentialOverwrite = diff.removedKeys.length > 0 || diff.changedKeys.length > 6;
  if (hasPotentialOverwrite || source !== "save:new-entry") {
    if (process.env.NODE_ENV !== "production") console.log("[FormPage] applyEntryToState", {
      source,
      formId,
      entryId: entryId || "new",
      nextEntryId: nextEntry?.id || fallbackEntryId || null,
      isDirty: isDirtyRef.current,
      isViewMode: isViewModeRef.current,
      prevCount: diff.prevCount,
      nextCount: diff.nextCount,
      removedCount: diff.removedKeys.length,
      changedCount: diff.changedKeys.length,
    });
  }
  setEntry(nextEntry);
  setRecordNoInput(nextEntry?.["No."] === undefined || nextEntry?.["No."] === null ? "" : String(nextEntry["No."]));
  initialResponsesRef.current = restored;
  initialDriveFolderStatesRef.current = nextDriveFolderStates;
  setDriveFolderStates(nextDriveFolderStates);
  commitResponses(`applyEntryToState:${source}`, restored, {
    forceLog: true,
    meta: { nextEntryId: nextEntry?.id || fallbackEntryId || null },
  });
  setCurrentRecordId(nextEntry?.id || fallbackEntryId || null);
}

/**
 * 印刷ジョブ完了時に Drive フォルダ state を更新する。
 */
export function runUpdateDriveFolderStateFromPrint(result, ctx) {
  const { normalizedSchemaRef, updateFieldDriveFolderState } = ctx;
  const schema = normalizedSchemaRef.current;
  const primaryFieldId = collectFileUploadFields(schema)[0]?.id || "";
  if (!primaryFieldId) return;
  updateFieldDriveFolderState(primaryFieldId, (prev) => {
    const currentEffectiveFolderUrl = resolveEffectiveDriveFolderUrl(prev);
    const nextResolvedUrl = typeof result?.folderUrl === "string" && result.folderUrl.trim()
      ? result.folderUrl.trim()
      : (currentEffectiveFolderUrl || prev.resolvedUrl);
    const keepAutoCreated = prev.autoCreated && prev.resolvedUrl.trim() && prev.resolvedUrl.trim() === nextResolvedUrl;
    return {
      ...prev,
      resolvedUrl: nextResolvedUrl,
      inputUrl: prev.inputUrl.trim() ? prev.inputUrl : nextResolvedUrl,
      autoCreated: keepAutoCreated || result?.autoCreated === true,
      pendingPrintFileIds: appendDriveFileId(prev.pendingPrintFileIds, result?.fileId),
    };
  });
}

/**
 * 同期されたエントリを即適用するか、編集中なら保留する。
 */
export function runApplyOrDeferSyncedEntry(nextEntry, source, ctx) {
  const { entryRef, formId, entryId, isViewModeRef, pendingSyncedEntryRef, applyEntryToStateRef } = ctx;
  if (!nextEntry) return false;
  const currentVersion = toEntryVersion(entryRef.current);
  const incomingVersion = toEntryVersion(nextEntry);
  if (incomingVersion > 0 && currentVersion > 0 && incomingVersion < currentVersion) {
    if (process.env.NODE_ENV !== "production") console.log("[FormPage] ignore stale synced entry", {
      source,
      formId,
      entryId: entryId || "new",
      currentVersion,
      incomingVersion,
    });
    return false;
  }
  if (!isViewModeRef.current) {
    pendingSyncedEntryRef.current = pickLatestEntry(pendingSyncedEntryRef.current, nextEntry);
    if (process.env.NODE_ENV !== "production") console.log("[FormPage] defer synced entry during edit", {
      source,
      formId,
      entryId: entryId || "new",
      pendingVersion: toEntryVersion(pendingSyncedEntryRef.current),
    });
    return false;
  }
  pendingSyncedEntryRef.current = null;
  applyEntryToStateRef.current(nextEntry, entryId, source);
  return true;
}

/**
 * 編集をキャンセルして最新キャッシュ or 初期値に戻す。
 */
export async function runCancelEditAndRestoreLatest(ctx) {
  const {
    formId,
    entryId,
    entryRef,
    pendingSyncedEntryRef,
    initialResponsesRef,
    initialDriveFolderStatesRef,
    applyEntryToState,
    commitResponses,
    setDriveFolderStates,
    setMode,
  } = ctx;
  if (!entryId || !formId) return;
  let restoreTarget = pickLatestEntry(entryRef.current, pendingSyncedEntryRef.current);
  try {
    const { entry: cachedEntry } = await getCachedEntryWithIndex(formId, entryId);
    restoreTarget = pickLatestEntry(restoreTarget, cachedEntry);
  } catch (error) {
    console.error("[FormPage] failed to load latest cache on cancel:", error);
  }
  if (restoreTarget) {
    applyEntryToState(restoreTarget, entryId, "cancel:restore-latest");
  } else {
    commitResponses("cancel:restore-initial", initialResponsesRef.current, { forceLog: true });
    setDriveFolderStates(initialDriveFolderStatesRef.current);
  }
  pendingSyncedEntryRef.current = null;
  setMode("view");
}

/**
 * 未保存セッションでアップロード済みファイルを Drive ごみ箱に移動。
 */
export async function runDiscardUnsavedUploadedFiles(ctx) {
  const { driveFolderStatesRef } = ctx;
  const currentStates = driveFolderStatesRef.current || {};
  const fileIds = normalizeDriveFileIds(
    Object.values(currentStates).flatMap((state) => normalizeDriveFolderState(state).sessionUploadFileIds),
  );
  if (fileIds.length === 0) return;
  if (!hasScriptRun()) {
    throw new Error("この機能はGoogle Apps Script環境でのみ利用可能です");
  }
  await trashDriveFilesByIds(fileIds);
}

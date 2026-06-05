/**
 * FormPage の保存ハンドラ。
 *
 * FormPage.jsx から純関数として抽出。React state / refs はすべて
 * `ctx` 引数経由で受け取る。
 */

import { dataStore } from "../app/state/dataStore.js";
import {
  acquireSaveLock,
  finalizeRecordDriveFolder,
  hasScriptRun,
  submitResponses,
} from "../services/gasClient.js";
import { formHasSpreadsheet } from "../app/state/dataStoreHelpers.js";
import { collectFileUploadFields } from "../core/schema.js";
import { traverseSchema } from "../core/schemaUtils.js";
import { collectResponses as coreCollectResponses } from "../core/collect.js";
import { joinFieldPath } from "../utils/pathCodec.js";
import { GAS_ERROR_CODE_LOCK_TIMEOUT } from "../core/constants.js";
import { getCachedEntryWithIndex } from "../app/state/recordsMemoryStore.js";
import {
  canRetryOperationSync,
  wait,
  WRITE_RETRY_INTERVAL_MS,
  WRITE_RETRY_MAX_ATTEMPTS,
} from "../features/search/globalSyncState.js";
import {
  buildFieldValuesMap,
  collectFileUploadMeta,
} from "../features/preview/printDocument.js";
import {
  createEmptyDriveFolderStates,
  normalizeDriveFileIds,
  normalizeDriveFolderState,
} from "../utils/driveFolderState.js";
import {
  collectDriveFileIds,
  buildFolderUrlsByFieldFromStates,
} from "./formPageHelpers.js";

/**
 * Drive フォルダ確定処理失敗を表す例外。
 */
export class DriveFolderFinalizeError extends Error {
  constructor(originalError) {
    super("drive_folder_finalize_failed");
    this.originalError = originalError;
  }
}

/**
 * バックグラウンドのスプレッドシート書き込みをリトライ付きで実行する。
 *
 * ロック競合 (LOCK_TIMEOUT) や一時的なスプレッドシートエラーは `canRetryOperationSync`
 * が true を返す間だけ `waitFn(retryIntervalMs)` を挟んで再試行する。成功時・リトライ中は
 * アラートを出さない。全リトライ枯渇時のみ、ローカル保存済みである旨の正確な文言で
 * 1 度だけ `showAlert` する（LOCK_TIMEOUT は安心文言、それ以外は汎用エラー文言）。
 *
 * @param {object} args
 * @param {() => Promise<void>} args.attemptSave 1 回分の書き込み（acquire→submit→recordNo 同期）
 * @param {Function} args.showAlert
 * @param {(ms: number) => Promise<void>} [args.waitFn]
 * @param {number} [args.maxAttempts]
 * @param {number} [args.retryIntervalMs]
 * @returns {Promise<{ ok: boolean, error?: any }>}
 */
export async function runWithSaveRetry_({
  attemptSave,
  showAlert,
  waitFn = wait,
  maxAttempts = WRITE_RETRY_MAX_ATTEMPTS,
  retryIntervalMs = WRITE_RETRY_INTERVAL_MS,
}) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    try {
      await attemptSave();
      return { ok: true };
    } catch (error) {
      lastError = error;
      if (canRetryOperationSync(error) && attempt < maxAttempts) {
        await waitFn(retryIntervalMs);
        continue;
      }
      break;
    }
  }
  console.error("[FormPage] Background spreadsheet save failed after retries:", lastError);
  if (lastError?.code === GAS_ERROR_CODE_LOCK_TIMEOUT) {
    showAlert(
      "ローカルには保存しました。スプレッドシートへの即時反映に繰り返し失敗したため、次回の同期で自動的に再試行します。",
      "スプレッドシートへの反映を保留しました",
    );
  } else {
    showAlert(`スプレッドシート保存に失敗しました: ${lastError?.message || lastError}`);
  }
  return { ok: false, error: lastError };
}

/**
 * FormPage の保存処理。
 *
 * @param {object} args 呼び出し引数
 * @param {object} args.payload submitResponses 用のペイロード
 * @param {object} args.rawResponses ユーザー入力の生 responses
 * @param {{unlinkDriveFolder?: boolean}} [args.options] オプション
 *
 * @param {object} ctx FormPage 由来のコンテキスト
 * @param {object} ctx.form 現在のフォーム
 * @param {object|null} ctx.entry 既存エントリ（新規時は null）
 * @param {string} ctx.recordNoInput No. 入力値
 * @param {Array} ctx.normalizedSchema 正規化済みスキーマ
 * @param {object} ctx.fieldPaths フィールドフルパスマップ ({ fid: "親|子|孫" })
 * @param {string} ctx.userEmail
 * @param {string} ctx.draftKey sessionStorage キー
 * @param {string} ctx.driveFolderDraftKey
 * @param {React.MutableRefObject} ctx.driveFolderStatesRef
 * @param {React.MutableRefObject} ctx.initialDriveFolderStatesRef
 * @param {React.MutableRefObject} ctx.initialResponsesRef
 * @param {React.MutableRefObject} ctx.pendingSyncedEntryRef
 * @param {Function} ctx.applyEntryToState
 * @param {Function} ctx.reloadListFromCache
 * @param {Function} ctx.setDriveFolderStates
 * @param {Function} ctx.setEntry
 * @param {Function} ctx.showAlert
 *
 * @returns {Promise<object>} 保存後のエントリ
 */
export async function performFormPageSave({ payload, rawResponses, options = {} }, ctx) {
  const {
    form,
    entry,
    recordNoInput,
    normalizedSchema,
    fieldPaths,
    userEmail,
    draftKey,
    driveFolderDraftKey,
    driveFolderStatesRef,
    initialDriveFolderStatesRef,
    initialResponsesRef,
    pendingSyncedEntryRef,
    applyEntryToState,
    reloadListFromCache,
    setDriveFolderStates,
    setEntry,
    showAlert,
  } = ctx;

  if (!form) throw new Error("form_not_found");

  const isNewEntry = !entry?.id;
  const createdBy = isNewEntry ? (userEmail || "") : (entry?.createdBy || "");
  const modifiedBy = userEmail || entry?.modifiedBy || "";
  const settings = form.settings || {};
  const sheetName = settings.sheetName || "Data";
  const hasSpreadsheet = formHasSpreadsheet(form);
  const requiresSpreadsheetSave = Boolean(hasSpreadsheet && hasScriptRun());
  const payloadWithFormId = { ...payload, formId: form.id };

  if (!requiresSpreadsheetSave) {
    if (hasSpreadsheet) {
      console.warn("[FormPage] google.script.run unavailable; skipped background spreadsheet save");
    } else {
      console.warn("[FormPage] No spreadsheet configured, skipping spreadsheet save");
    }
  }

  const normalizedRecordNo = String(recordNoInput || "").trim();

  const saveData = { ...payloadWithFormId.responses };
  const saveOrder = [...payloadWithFormId.order];
  const uploadFields = collectFileUploadFields(normalizedSchema);
  const currentStates = driveFolderStatesRef.current || {};
  const currentResponseFileIds = collectDriveFileIds(rawResponses);
  const initialResponseFileIds = collectDriveFileIds(initialResponsesRef.current);
  const currentResponseFileIdSet = new Set(currentResponseFileIds);
  const extraTrashFileIds = normalizeDriveFileIds(initialResponseFileIds).filter(
    (fileId) => !currentResponseFileIdSet.has(fileId),
  );
  const extraTrashFileIdSet = new Set(extraTrashFileIds);

  const finalizedFolderUrlByField = {};

  const needsAnyFinalize = uploadFields.some((field) => {
    const st = normalizeDriveFolderState(currentStates[field.id]);
    return Boolean(
      st.resolvedUrl.trim()
      || st.inputUrl.trim()
      || st.pendingDeleteUrl.trim()
      || st.sessionUploadFileIds.length
      || st.pendingPrintFileIds.length,
    );
  }) || extraTrashFileIds.length > 0;

  if (needsAnyFinalize) {
    if (options.unlinkDriveFolder === true) {
      // all folder URLs become empty
    } else {
      if (!hasScriptRun()) {
        throw new Error("この機能はGoogle Apps Script環境でのみ利用可能です");
      }
      // First pass: per-field finalize
      const fieldValuesMap = buildFieldValuesMap(normalizedSchema, rawResponses || {});
      const metaMap = collectFileUploadMeta(normalizedSchema, {
        responses: rawResponses || {},
        folderUrlsByField: buildFolderUrlsByFieldFromStates(currentStates),
      });
      try {
        let remainingExtraTrash = Array.from(extraTrashFileIdSet);
        for (let i = 0; i < uploadFields.length; i += 1) {
          const field = uploadFields[i];
          const fid = field?.id;
          if (!fid) continue;
          const st = normalizeDriveFolderState(currentStates[fid]);
          const fieldValue = (rawResponses || {})[fid];
          const perFieldFileIds = normalizeDriveFileIds([
            ...(Array.isArray(fieldValue)
              ? fieldValue.map((entryItem) => (entryItem && typeof entryItem.driveFileId === "string" ? entryItem.driveFileId : ""))
              : []),
            ...st.pendingPrintFileIds,
          ]);
          // Trash candidates: session uploads no longer present in current value
          const perFieldTrash = normalizeDriveFileIds(st.sessionUploadFileIds).filter(
            (fileId) => !currentResponseFileIdSet.has(fileId),
          );
          const trashFileIds = normalizeDriveFileIds(perFieldTrash);
          // Attach leftover extraTrash to the first field to not lose them
          if (i === 0 && remainingExtraTrash.length > 0) {
            trashFileIds.push(...remainingExtraTrash);
            remainingExtraTrash = [];
          }
          const hasSomething = Boolean(
            st.resolvedUrl.trim()
            || st.inputUrl.trim()
            || st.pendingDeleteUrl.trim()
            || perFieldFileIds.length
            || trashFileIds.length,
          );
          if (!hasSomething) {
            finalizedFolderUrlByField[fid] = "";
            continue;
          }
          const finalizeResult = await finalizeRecordDriveFolder({
            currentDriveFolderUrl: st.resolvedUrl.trim(),
            inputDriveFolderUrl: st.inputUrl.trim(),
            rootFolderUrl: field?.driveRootFolderUrl || "",
            folderNameTemplate: field?.driveFolderNameTemplate || "",
            responses: rawResponses || {},
            fieldPaths,
            fieldValues: fieldValuesMap,
            fileUploadMeta: metaMap,
            fileIds: normalizeDriveFileIds(perFieldFileIds),
            trashFileIds: normalizeDriveFileIds(trashFileIds),
            folderUrlToTrash: st.pendingDeleteUrl.trim(),
            recordId: payloadWithFormId.id,
          });
          finalizedFolderUrlByField[fid] = typeof finalizeResult?.folderUrl === "string"
            ? finalizeResult.folderUrl.trim()
            : st.resolvedUrl.trim();
        }
      } catch (folderError) {
        throw new DriveFolderFinalizeError(folderError);
      }
    }
  }

  // Embed per-field folderUrl into sheet cell JSON by rebuilding fileUpload paths
  {
    const rebuilt = coreCollectResponses(
      normalizedSchema,
      rawResponses || {},
      { fileUploadFolderUrls: finalizedFolderUrlByField },
    );
    const fileUploadBaseKeys = new Set();
    traverseSchema(normalizedSchema, (field, context) => {
      if (field?.type === "fileUpload") {
        fileUploadBaseKeys.add(joinFieldPath(context.pathSegments));
      }
    });
    fileUploadBaseKeys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(rebuilt, key)) {
        saveData[key] = rebuilt[key];
      } else if (Object.prototype.hasOwnProperty.call(saveData, key)) {
        delete saveData[key];
      }
    });
  }

  const saved = await dataStore.upsertEntry(form.id, {
    id: payloadWithFormId.id,
    data: saveData,
    order: saveOrder,
    createdBy,
    modifiedBy,
    "No.": normalizedRecordNo === "" ? entry?.["No."] : normalizedRecordNo,
  });
  applyEntryToState(saved, saved.id, "save:new-entry");
  pendingSyncedEntryRef.current = null;
  reloadListFromCache();
  if (options.unlinkDriveFolder === true) {
    const emptyStates = createEmptyDriveFolderStates();
    setDriveFolderStates(emptyStates);
    initialDriveFolderStatesRef.current = emptyStates;
  }

  if (requiresSpreadsheetSave) {
    const submitPayload = {
      ...payloadWithFormId,
      responses: saveData,
      order: saveOrder,
      id: saved.id,
      createdAt: saved.createdAt,
      createdAtUnixMs: saved.createdAtUnixMs,
      createdBy: saved.createdBy,
      "No.": saved["No."],
    };
    // バックグラウンドでスプレッドシートへ書き込む。ロック競合 (LOCK_TIMEOUT) は一時的な
    // ことが多いので数回リトライし、その間はアラートを出さない。楽観的保存でメモリには
    // 反映済みかつ未同期レコードは次回同期で再プッシュされるため、誤報を避ける。全リトライ
    // 枯渇時のみ、ローカル保存済みである旨の正確な文言で 1 度だけ通知する。
    const attemptSpreadsheetSave = async () => {
      await acquireSaveLock({ formId: form.id, sheetName });
      const gasResult = await submitResponses({ formId: form.id, sheetName, payload: submitPayload });
      if (
        gasResult?.recordNo !== undefined
        && gasResult?.recordNo !== null
        && gasResult?.recordNo !== ""
        && String(gasResult.recordNo) !== String(saved["No."])
      ) {
        const { entry: currentCached } = await getCachedEntryWithIndex(form.id, saved.id);
        const baseRecord = currentCached || saved;
        const synced = await dataStore.upsertEntry(form.id, {
          ...baseRecord,
          "No.": gasResult.recordNo,
        });
        setEntry((prev) => (prev?.id === synced.id ? synced : prev));
      }
    };
    void runWithSaveRetry_({ attemptSave: attemptSpreadsheetSave, showAlert });
  }
  try {
    sessionStorage.removeItem(draftKey);
  } catch (e) { /* ignore */ }
  try {
    sessionStorage.removeItem(driveFolderDraftKey);
  } catch (e) { /* ignore */ }
  return saved;
}

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
import { GAS_ERROR_CODE_LOCK_TIMEOUT } from "../core/constants.js";
import { getCachedEntryWithIndex } from "../app/state/recordsMemoryStore.js";
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
        fileUploadBaseKeys.add(context.pathSegments.join("|"));
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
    void acquireSaveLock({ formId: form.id, sheetName })
      .then(() => submitResponses({
        formId: form.id,
        sheetName,
        payload: {
          ...payloadWithFormId,
          responses: saveData,
          order: saveOrder,
          id: saved.id,
          createdAt: saved.createdAt,
          createdAtUnixMs: saved.createdAtUnixMs,
          createdBy: saved.createdBy,
          "No.": saved["No."],
        },
      }))
      .then(async (gasResult) => {
        if (gasResult?.recordNo === undefined || gasResult?.recordNo === null || gasResult?.recordNo === "") return;
        if (String(gasResult.recordNo) === String(saved["No."])) return;

        const { entry: currentCached } = await getCachedEntryWithIndex(form.id, saved.id);
        const baseRecord = currentCached || saved;
        const synced = await dataStore.upsertEntry(form.id, {
          ...baseRecord,
          "No.": gasResult.recordNo,
        });
        setEntry((prev) => (prev?.id === synced.id ? synced : prev));
      })
      .catch((error) => {
        console.error("[FormPage] Background spreadsheet save failed:", error);
        if (error?.code === GAS_ERROR_CODE_LOCK_TIMEOUT) {
          showAlert(
            "現在、他のユーザーによる更新処理が実行中のためスプレッドシートへの保存を完了できませんでした。少し時間をおいて再度お試しください。",
            "スプレッドシート保存を完了できませんでした",
          );
          return;
        }
        showAlert(`スプレッドシート保存に失敗しました: ${error?.message || error}`);
      });
  }
  try {
    sessionStorage.removeItem(draftKey);
  } catch (e) { /* ignore */ }
  try {
    sessionStorage.removeItem(driveFolderDraftKey);
  } catch (e) { /* ignore */ }
  return saved;
}

/**
 * FormPage の各種アクションハンドラ。
 *
 * FormPage.jsx から純関数として抽出。React state / refs はすべて
 * `ctx` 引数経由で受け取る。
 */

import { dataStore } from "../app/state/dataStore.js";
import { toErrorMessage } from "../utils/errorMessage.js";
import { getCachedEntryWithIndex } from "../app/state/recordsMemoryStore.js";
import { evaluateCacheForRecords } from "../app/state/cachePolicy.js";
import { traverseSchema } from "../core/schemaUtils.js";
import { GAS_ERROR_CODE_LOCK_TIMEOUT } from "../core/constants.js";
import { restoreResponsesFromData } from "../utils/responses.js";
import { DriveFolderFinalizeError } from "./formPageSaveHandler.js";
import { selectFormLinkCopyTargets, copyChildRecordsForLinks } from "./childRecordCopy.js";

/**
 * 戻る系ナビゲーション。
 * - 直接レコードモードでは entry URL に replace
 * - location.state.from があれば優先
 * - fallbackPath があればそこへ、なければ "/" へ
 */
export function performFormPageNavigateBack({ saved = false, deleted = false } = {}, ctx) {
  const {
    formId,
    entryId,
    isDirectRecordMode,
    isFormScoped,
    fallbackPath,
    location,
    navigate,
    clearNewEntryDraft,
  } = ctx;

  clearNewEntryDraft();
  if (isDirectRecordMode && !deleted) {
    navigate(`/form/${formId}/entry/${entryId}`, { replace: true, state: location.state });
    return;
  }
  const state = (saved || deleted)
    ? { ...(saved || deleted ? { saved, deleted } : {}) }
    : undefined;
  // formid 固定で開いたスコープ時は、location.state.from（メインや admin ルートを指す可能性）に
  // 依存せず、必ずそのフォームの絞り込み一覧へ戻す。メイン画面へは戻れないようにする。
  if (isFormScoped) {
    navigate(`/search?form=${formId}`, { replace: true, state });
    return;
  }
  if (location.state?.from) {
    navigate(location.state.from, { replace: true, state });
    return;
  }
  if (fallbackPath) {
    navigate(fallbackPath, { replace: true, state });
  } else {
    navigate("/", { replace: true, state });
  }
}

/**
 * 操作起点のキャッシュ整合性チェック。
 *
 * @param {{source: string}} args
 * @param {object} ctx FormPage 由来のコンテキスト
 *   formId, entryId, loadingRef, reloadingRef, savingRef, readLockRef,
 *   isViewModeRef, isDirtyRef, responsesRef, applyOrDeferSyncedEntry,
 *   refreshFormsIfNeeded, setLoading, setIsReloading
 */
export async function performFormPageOperationCacheCheck({ source }, ctx) {
  const {
    formId,
    entryId,
    loadingRef,
    reloadingRef,
    savingRef,
    readLockRef,
    isViewModeRef,
    isDirtyRef,
    responsesRef,
    applyOrDeferSyncedEntry,
    refreshFormsIfNeeded,
    setLoading,
    setIsReloading,
  } = ctx;

  if (!formId) return;

  if (entryId && !loadingRef.current && !reloadingRef.current && !savingRef.current && !readLockRef.current) {
    try {
      const { entry: cachedEntry, rowIndex, lastSyncedAt } = await getCachedEntryWithIndex(formId, entryId);
      const cacheDecision = evaluateCacheForRecords({
        lastSyncedAt,
        hasData: !!cachedEntry,
      });

      if (!cacheDecision.isFresh) {
        const options = { forceSync: true };
        if (rowIndex !== undefined && rowIndex !== null) options.rowIndexHint = rowIndex;

        if (!isViewModeRef.current) {
          // 編集モード中は操作によるバックグラウンド更新でデータを上書きしない
        } else if (cacheDecision.shouldSync) {
          setLoading(true);
          try {
            const latest = await dataStore.getEntry(formId, entryId, options);
            if (latest && !isDirtyRef.current) {
              applyOrDeferSyncedEntry(latest, "operation-cache:sync");
            }
          } finally {
            setLoading(false);
          }
        } else if (cacheDecision.shouldBackground) {
          setIsReloading(true);
          dataStore.getEntry(formId, entryId, options)
            .then((latest) => {
              if (latest && !isDirtyRef.current) {
                applyOrDeferSyncedEntry(latest, "operation-cache:background");
              }
            })
            .catch((error) => {
              console.error("[FormPage] background getEntry failed:", error);
            })
            .finally(() => {
              setIsReloading(false);
            });
        }
      }
    } catch (error) {
      console.error("[FormPage] operation cache check failed:", error);
    }
  }

  if (isDirtyRef.current && !isViewModeRef.current) {
    return;
  }

  await refreshFormsIfNeeded(source);
}

/**
 * 保存ボタンの起点。previewRef.submit() を実行し、結果に応じて遷移/通知。
 *
 * @param {{redirect?: boolean, stayAsView?: boolean, skipStayAsViewNavigation?: boolean, unlinkDriveFolder?: boolean}} args
 * @param {object} ctx FormPage 由来のコンテキスト
 */
export async function performFormPageTriggerSave(args, ctx) {
  const { redirect, stayAsView, skipStayAsViewNavigation = false, unlinkDriveFolder = false } = args || {};
  const {
    form,
    formId,
    entryId,
    isReadLocked,
    isAdmin,
    currentRecordId,
    location,
    previewRef,
    pendingUnlinkSaveRef,
    pendingChildRecordCopyRef,
    unlinkFolderDialog,
    setIsSaving,
    setMode,
    navigate,
    navigateBack,
    showAlert,
    showToast,
  } = ctx;

  if (!form) {
    showAlert("フォームが見つかりません");
    return { ok: false, recordId: "" };
  }
  if (isReadLocked) return { ok: false, recordId: "" };

  setIsSaving(true);
  try {
    const preview = previewRef.current;
    if (!preview) throw new Error("preview_not_ready");
    const result = await preview.submit({ silent: true, unlinkDriveFolder });
    const savedId = String(preview.getRecordId?.() || result?.id || currentRecordId || entryId || "").trim();

    // 新規レコード保存後、formLink でコピー予約された子レコードを子フォームへ複製する
    // （pid == 新しい親レコードの id）。ナビゲーション前に直列実行する。
    const pendingChildCopy = pendingChildRecordCopyRef?.current;
    if (!entryId && savedId && pendingChildCopy?.links?.length) {
      try {
        await copyChildRecordsForLinks({
          pending: pendingChildCopy,
          newParentId: savedId,
          showToast,
          showAlert,
        });
      } catch (childCopyError) {
        console.error("[FormPage] child record copy failed:", childCopyError);
        showAlert(`子レコードのコピーに失敗しました: ${toErrorMessage(childCopyError)}`);
      } finally {
        if (pendingChildRecordCopyRef) pendingChildRecordCopyRef.current = null;
      }
    }

    if (stayAsView) {
      if (!skipStayAsViewNavigation) {
        if (!entryId && savedId) {
          navigate(`/form/${formId}/entry/${savedId}`, {
            replace: true,
            state: location.state,
          });
        } else {
          setMode("view");
        }
      }
      showToast("保存しました");
    } else if (redirect) {
      navigateBack({ saved: true });
    }
    return { ok: true, recordId: savedId };
  } catch (error) {
    console.warn(error);
    if (error instanceof DriveFolderFinalizeError && isAdmin) {
      pendingUnlinkSaveRef.current = { redirect, stayAsView, skipStayAsViewNavigation };
      unlinkFolderDialog.open({ errorMessage: error.originalError?.message || "不明なエラー" });
      return { ok: false, recordId: "" };
    }
    if (error?.message === "validation_failed" || error?.message?.includes("missing_")) {
      return { ok: false, recordId: "" };
    }
    if (error instanceof DriveFolderFinalizeError) {
      showAlert(`Driveフォルダの処理に失敗しました: ${error.originalError?.message || error.message}`);
      return { ok: false, recordId: "" };
    }
    if (error?.code === GAS_ERROR_CODE_LOCK_TIMEOUT) {
      showAlert(
        "現在、他のユーザーによる更新処理が実行中のため保存できませんでした。しばらく時間をおいて、もう一度お試しください。",
        "保存を完了できませんでした",
      );
      return { ok: false, recordId: "" };
    }
    showAlert(`保存に失敗しました: ${toErrorMessage(error)}`);
    return { ok: false, recordId: "" };
  } finally {
    setIsSaving(false);
  }
}

/**
 * 削除 / 削除取消し ダイアログの確定処理。
 */
export async function performFormPageConfirmEntryAction(ctx) {
  const {
    entryActionDialog,
    formId,
    entryId,
    userEmail,
    applyEntryToState,
    reloadListFromCache,
    navigateBack,
  } = ctx;

  const action = entryActionDialog.state.action;
  entryActionDialog.reset();
  if (action === "delete") {
    await dataStore.deleteEntry(formId, entryId, { deletedBy: userEmail || "" });
    navigateBack({ deleted: true });
  } else if (action === "undelete") {
    await dataStore.undeleteEntry(formId, entryId, { modifiedBy: userEmail || "" });
    const { entry: updated } = await getCachedEntryWithIndex(formId, entryId);
    if (updated) {
      applyEntryToState(updated, entryId, "undelete");
    }
    reloadListFromCache();
  }
}

/**
 * 「コピー元レコード ID 取得」ボタン処理。
 */
export async function performFormPageFetchCopySource(ctx) {
  const {
    formId,
    copySourceId,
    isAdmin,
    normalizedSchema,
    showAlert,
    setIsCopySourceLoading,
    setCopySourceResponses,
    setCopySourceRecordId,
    setIsCopyDialogOpen,
  } = ctx;

  if (!formId) return;
  const sourceId = String(copySourceId || "").trim();
  if (!sourceId) {
    showAlert("コピー元レコードIDを入力してください");
    return;
  }

  try {
    setIsCopySourceLoading(true);
    const { entry: sourceData } = await getCachedEntryWithIndex(formId, sourceId);
    if (!sourceData) {
      showAlert("指定したレコードが見つかりませんでした");
      return;
    }
    if (!isAdmin && (sourceData.deletedAtUnixMs || sourceData.deletedAt)) {
      showAlert("削除済みレコードからのコピーは管理者のみ可能です");
      return;
    }
    const restored = restoreResponsesFromData(normalizedSchema, sourceData.data || {}, sourceData.dataUnixMs || {});
    setCopySourceResponses(restored);
    // 確定したコピー元 id を保持する（copySourceId 入力欄は後で編集され得るため別途記録）。
    // formLink 子レコードの複製で pid フィルタに使う。
    if (typeof setCopySourceRecordId === "function") {
      setCopySourceRecordId(String(sourceData.id || sourceId));
    }
    setIsCopyDialogOpen(true);
  } catch (error) {
    console.error("[FormPage] failed to fetch source record for copy:", error);
    showAlert(`コピー元レコードの取得に失敗しました: ${toErrorMessage(error)}`);
  } finally {
    setIsCopySourceLoading(false);
  }
}

/**
 * RecordCopyDialog の確定処理。選択されたフィールド ID を responses にマージする。
 */
export function performFormPageConfirmRecordCopy(selectedFieldIds, ctx) {
  const {
    topLevelFieldMap,
    copySourceResponses,
    copySourceRecordId,
    pendingChildRecordCopyRef,
    commitResponses,
    setIsCopyDialogOpen,
    showAlert,
    showToast,
  } = ctx;

  const selectedIds = Array.isArray(selectedFieldIds) ? selectedFieldIds : [];
  if (!selectedIds.length) {
    showAlert("コピーする項目を選択してください");
    return;
  }

  // 選択された formLink 項目は「保存後にまとめて子レコードを複製する」保留タスクとして記録する。
  // （formLink は値を持たないため、下の値マージ処理では何もコピーされない。）
  const formLinkTargets = selectFormLinkCopyTargets(selectedIds, topLevelFieldMap);
  const sourceRecordId = String(copySourceRecordId || "").trim();
  if (pendingChildRecordCopyRef) {
    pendingChildRecordCopyRef.current = (formLinkTargets.length > 0 && sourceRecordId)
      ? { sourceRecordId, links: formLinkTargets }
      : null;
  }

  const copyTargetFieldIds = {};
  selectedIds.forEach((fieldId) => {
    const rootField = topLevelFieldMap[fieldId];
    if (!rootField) return;
    traverseSchema([rootField], (field) => {
      const id = typeof field?.id === "string" ? field.id.trim() : "";
      if (id) copyTargetFieldIds[id] = true;
    }, { responses: copySourceResponses });
  });

  const filteredResponses = {};
  Object.keys(copyTargetFieldIds).forEach((fieldId) => {
    if (Object.prototype.hasOwnProperty.call(copySourceResponses, fieldId)) {
      filteredResponses[fieldId] = copySourceResponses[fieldId];
    }
  });

  commitResponses("record-copy:merge", (prev) => ({
    ...(prev || {}),
    ...filteredResponses,
  }), {
    forceLog: true,
    meta: {
      copiedCount: Object.keys(filteredResponses).length,
    },
  });
  setIsCopyDialogOpen(false);

  const copiedCount = Object.keys(filteredResponses).length;
  const hasPendingChildCopy = Boolean(pendingChildRecordCopyRef?.current?.links?.length);
  if (copiedCount > 0) {
    showToast(hasPendingChildCopy
      ? `${copiedCount} 項目をコピーしました（子レコードは保存時にコピーします）`
      : `${copiedCount} 項目をコピーしました`);
  } else if (hasPendingChildCopy) {
    showToast("子レコードは保存時にコピーします");
  } else {
    showAlert("コピー対象の回答が見つかりませんでした");
  }
}

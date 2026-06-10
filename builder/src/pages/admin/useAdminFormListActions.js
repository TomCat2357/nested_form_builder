import { useCallback } from "react";
import { toErrorMessage } from "../../utils/errorMessage.js";
import { useConfirmDialog } from "../../app/hooks/useConfirmDialog.js";
import { importFormsFromDrive } from "../../services/gasClient.js";
import { sanitizeFileBaseName, resolveDialogTargetIds } from "./listActionsShared.js";
import { buildImportDetail, flattenImportedContents } from "./formImportWorkflow.js";
import { useAdminListActions } from "./useAdminListActions.js";

/**
 * フォーム一覧アクションを一括提供する hook。
 * 共通本体は useAdminListActions。Form 固有の差分（id キー・文言・export 整形・コピー対象の選別・
 * アーカイブの hasPublished・confirm エラーログ）を opts で注入し、Form 限定の「参照のみ」ダイアログと
 * ネスト対応の import workflow（formImportWorkflow.js の flatten/detail）だけをここで実装してマージする。
 */
export function useAdminFormListActions({
  sortedForms,
  selected,
  clearSelection,
  clearSelectionByIds,
  showAlert,
  archiveForms,
  unarchiveForms,
  setFormsReadOnly,
  clearFormsReadOnly,
  deleteForms,
  deleteFormsWithFiles,
  exportForms,
  copyForm,
  registerImportedForm,
  // フォルダ操作
  allItems = [],
  registeredFolders = [],
  selectedFolders,
  clearFolderSelection,
  currentPath = "",
  createFolder,
  moveItems,
  renameFolder,
  renameForm,
  deleteFolder,
}) {
  const base = useAdminListActions({
    idKey: "formId",
    folderCountKey: "folderFormCount",
    moveIdsKey: "formIds",
    sortedItems: sortedForms,
    selected,
    clearSelection,
    clearSelectionByIds,
    showAlert,
    archive: archiveForms,
    unarchive: unarchiveForms,
    copy: copyForm,
    remove: deleteForms,
    removeWithFiles: deleteFormsWithFiles,
    exportItems: exportForms,
    messages: {
      archiveEmpty: "アーカイブ可能なフォームを選択してください。（読み込みエラーの項目は削除のみ可能です）",
      deleteEmpty: "リンク解除するフォームまたはフォルダを選択してください。",
      hardDeleteEmpty: "削除するフォームを選択してください。",
      exportEmpty: "スキーマをエクスポートするフォームを選択してください。",
      importNotInGas: "インポート機能はGoogle Apps Script環境でのみ利用可能です",
      copyNotInGas: "コピー機能はGoogle Apps Script環境でのみ利用可能です",
      copySuccess: "フォームをコピーしました。スプレッドシートの設定を確認してください。",
      copyFailed: (error) => "フォームのコピーに失敗しました: " + (error.message || "不明なエラー"),
      deleteErrorFallback: "削除中にエラーが発生しました",
      hardDeleteErrorFallback: "削除中にエラーが発生しました",
      moveEmpty: "移動するフォームまたはフォルダを選択してください。",
    },
    archiveExtraInit: { hasPublished: false },
    computeArchiveExtra: (targets) => ({ hasPublished: targets.some((form) => !form.archived) }),
    pickCopyTarget: () => {
      const selectedForm = sortedForms.find((f) => selected.has(f.id));
      if (!selectedForm || selectedForm.loadError) {
        showAlert("コピー可能なフォームを1件選択してください。");
        return null;
      }
      return selectedForm.id;
    },
    exportEntryName: (form) => sanitizeFileBaseName(form.settings?.formTitle, "form"),
    exportZipPrefix: "forms",
    onActionError: (scope, error) => {
      const prefix = {
        archive: "[AdminFormList] Archive action failed:",
        delete: "[AdminFormList] Delete action failed:",
        hardDelete: "[AdminFormList] Hard delete action failed:",
      }[scope];
      if (prefix) console.error(prefix, error);
    },
    allItems,
    registeredFolders,
    selectedFolders,
    clearFolderSelection,
    currentPath,
    createFolder,
    moveItems,
    renameFolder,
    renameItem: renameForm,
    deleteFolder,
    renameGetItemName: (form) => form.settings?.formTitle || "",
    renameIsItemRenamable: (form) => !form.loadError,
    renameEmptyMessage: "名前を変更できるフォームを選択してください。",
    renameAmbiguousMessage: "名前を変更するフォルダまたはフォームを1つだけ選択してください。",
    createFolderOnError: (error) => console.error("[AdminFormList] Create folder failed:", error),
    moveOnError: (error) => console.error("[AdminFormList] Move failed:", error),
    renameOnError: (error, kind) =>
      console.error(
        kind === "item" ? "[AdminFormList] Rename form failed:" : "[AdminFormList] Rename folder failed:",
        error,
      ),
  });

  const { setImportDialogOpen, setImporting, importUrl } = base;

  // ---- Form 限定: 「参照のみ」ダイアログ（アーカイブと相互排他）。共通 hook には載せない。 ----
  const readOnlyDialog = useConfirmDialog({ formId: null, targetIds: [], multiple: false, allReadOnly: false });

  const handleReadOnlySelected = () => {
    const selectedForms = sortedForms.filter((form) => selected.has(form.id) && !form.loadError);
    if (!selectedForms.length) {
      showAlert("参照のみ設定可能なフォームを選択してください。");
      return;
    }
    const allReadOnly = selectedForms.every((form) => form.readOnly);
    const targetIds = selectedForms.map((form) => form.id);
    readOnlyDialog.open({
      formId: targetIds[0],
      targetIds,
      multiple: targetIds.length > 1,
      allReadOnly,
    });
  };

  const confirmReadOnlyAction = () => {
    const targetIds = resolveDialogTargetIds(readOnlyDialog.state, "formId");
    if (!targetIds.length) return;
    const shouldClear = readOnlyDialog.state.allReadOnly;
    clearSelectionByIds(targetIds);
    readOnlyDialog.reset();

    (async () => {
      try {
        if (shouldClear) {
          await clearFormsReadOnly(targetIds);
        } else {
          await setFormsReadOnly(targetIds);
        }
      } catch (error) {
        console.error("[AdminFormList] ReadOnly action failed:", error);
        showAlert(`参照のみ設定中にエラーが発生しました: ${error.message}`);
      }
    })();
  };

  // ---- import workflow（ネスト対応・flatten/detail を formImportWorkflow.js から注入） ----
  const startImportWorkflow = useCallback(
    async (parsedContents, { skipped = 0, parseFailed = 0 } = {}) => {
      const { list: queue, invalidPayloadCount } = flattenImportedContents(parsedContents);
      const detail = buildImportDetail(skipped, parseFailed, { useRegisteredLabel: true });
      if (!queue.length) {
        showAlert(`取り込めるフォームはありませんでした${detail}。`);
        return;
      }

      setImporting(true);
      let imported = 0;
      let saveFailed = invalidPayloadCount;

      try {
        for (const item of queue) {
          try {
            await registerImportedForm({
              form: item.form,
              fileId: item.fileId,
              fileUrl: item.fileUrl,
              folder: currentPath,
            });
            imported += 1;
          } catch (error) {
            saveFailed += 1;
            console.warn("[DriveImport] failed to import one form", {
              formId: item?.form?.id,
              title: item?.form?.settings?.formTitle,
              error: toErrorMessage(error),
            });
          }
        }

        clearSelection();
        const saveFailedDetail = saveFailed > 0 ? `（保存失敗 ${saveFailed} 件）` : "";

        if (imported > 0) {
          showAlert(`${imported} 件のフォームを取り込みました${detail}${saveFailedDetail}。`);
        } else {
          showAlert(`取り込めるフォームはありませんでした${detail}${saveFailedDetail}。`);
        }
        console.log(
          `[DriveImport] success=${imported}, alreadyRegistered=${skipped}, parseFailed=${parseFailed}, saveFailed=${saveFailed}`,
        );
      } catch (error) {
        console.error("[DriveImport] import workflow failed", error);
        showAlert(error?.message || "スキーマの取り込み中にエラーが発生しました");
      } finally {
        setImporting(false);
      }
    },
    [registerImportedForm, showAlert, clearSelection, currentPath, setImporting],
  );

  const handleImportFromDrive = async () => {
    const url = importUrl?.trim();
    if (!url) {
      showAlert("Google Drive URLを入力してください");
      return;
    }

    setImportDialogOpen(false);
    setImporting(true);

    try {
      const result = await importFormsFromDrive(url);
      const { forms: importedForms, skipped = 0, parseFailed = 0 } = result;

      if (!importedForms || importedForms.length === 0) {
        // 取り込む新規ファイルが無い。既登録（リンク済み）でスキップした場合は、
        // 「失敗」ではなく「登録済みのため取り込み不要」と分かる表現にする。
        if (skipped > 0 && parseFailed === 0) {
          showAlert(`すべて登録済み（リンク済み）のためスキップしました（${skipped} 件）。`);
        } else {
          showAlert(`有効なフォームがありませんでした${buildImportDetail(skipped, parseFailed, { useRegisteredLabel: true })}。`);
        }
        setImporting(false);
        return;
      }

      await startImportWorkflow(importedForms, { skipped, parseFailed });
    } catch (error) {
      console.error("[DriveImport] import from Drive failed", error);
      showAlert(error?.message || "Google Driveからのインポートに失敗しました");
      setImporting(false);
    }
  };

  return {
    ...base,
    confirmReadOnly: readOnlyDialog.state,
    setConfirmReadOnly: readOnlyDialog.setState,
    handleReadOnlySelected,
    confirmReadOnlyAction,
    handleImportFromDrive,
  };
}

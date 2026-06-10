import { useCallback } from "react";
import { sanitizeFileBaseName } from "./listActionsShared.js";
import { useAdminListActions } from "./useAdminListActions.js";

/**
 * Question / Dashboard 一覧アクションを一括提供する汎用 hook。
 * 共通本体は useAdminListActions。analytics 固有の差分（id キー・文言・export 整形・
 * コピー対象の選別）を opts で注入し、import workflow だけ薄く上書きする。
 *
 * kind: "questions" | "dashboards"
 * itemLabel: ダイアログ等の表示文言で使う「Question」「Dashboard」
 *
 * actions:
 *  - archive(ids), unarchive(ids), copy(id), delete(ids), export(ids), import(url), registerImported(payload)
 */
export function useAdminAnalyticsListActions({
  kind,
  itemLabel,
  sortedItems,
  selected,
  clearSelection,
  clearSelectionByIds,
  showAlert,
  archive,
  unarchive,
  copy,
  remove,
  removeWithFiles,
  exportItems,
  importFromDrive,
  registerImported,
  // フォルダ操作
  allItems = [],
  registeredFolders = [],
  selectedFolders,
  clearFolderSelection,
  currentPath = "",
  createFolder,
  moveItems,
  renameFolder,
  renameItem,
  deleteFolder,
}) {
  const singularLabel = kind === "questions" ? "question" : "dashboard";

  const base = useAdminListActions({
    idKey: "id",
    folderCountKey: "folderItemCount",
    moveIdsKey: "itemIds",
    sortedItems,
    selected,
    clearSelection,
    clearSelectionByIds,
    showAlert,
    archive,
    unarchive,
    copy,
    remove,
    removeWithFiles,
    exportItems,
    messages: {
      archiveEmpty: `アーカイブする ${itemLabel} を選択してください。`,
      deleteEmpty: `リンク解除する ${itemLabel} またはフォルダを選択してください。`,
      hardDeleteEmpty: `削除する ${itemLabel} を選択してください。`,
      exportEmpty: `エクスポートする ${itemLabel} を選択してください。`,
      importNotInGas: "インポート機能は Google Apps Script 環境でのみ利用可能です",
      copyNotInGas: "コピー機能は Google Apps Script 環境でのみ利用可能です",
      copySuccess: `${itemLabel} をコピーしました。コピー後に名前を変更してください。`,
      copyFailed: (err) => `${itemLabel} のコピーに失敗しました: ${err.message || "不明なエラー"}`,
      deleteErrorFallback: `${itemLabel} の削除中にエラーが発生しました`,
      hardDeleteErrorFallback: `${itemLabel} の削除中にエラーが発生しました`,
      moveEmpty: `移動する ${itemLabel} またはフォルダを選択してください。`,
    },
    pickCopyTarget: () => {
      if (selected.size !== 1) {
        showAlert(`コピーする ${itemLabel} を 1 件選択してください。`);
        return null;
      }
      const target = sortedItems.find((item) => selected.has(item.id));
      if (!target) {
        showAlert(`コピー可能な ${itemLabel} を選択してください。`);
        return null;
      }
      return target.id;
    },
    exportEntryName: (item, { index, total }) =>
      sanitizeFileBaseName(item?.name, total === 1 ? singularLabel : `${kind}_${index}`),
    exportZipPrefix: kind,
    allItems,
    registeredFolders,
    selectedFolders,
    clearFolderSelection,
    currentPath,
    createFolder,
    moveItems,
    renameFolder,
    renameItem,
    deleteFolder,
    renameGetItemName: (item) => item.name || "",
    renameEmptyMessage: `名前を変更できる ${itemLabel} を選択してください。`,
    renameAmbiguousMessage: `名前を変更するフォルダまたは ${itemLabel} を1つだけ選択してください。`,
  });

  const { setImportDialogOpen, setImporting, importUrl } = base;

  const handleImportFromDrive = useCallback(async () => {
    const url = importUrl?.trim();
    if (!url) {
      showAlert("Google Drive URL を入力してください");
      return;
    }
    setImportDialogOpen(false);
    setImporting(true);

    try {
      const result = await importFromDrive(url);
      const items = result?.items || [];
      const skipped = result?.skipped || 0;
      const parseFailed = result?.parseFailed || 0;

      if (!items.length) {
        // 取り込む新規ファイルが無い。既登録（リンク済み）でスキップした場合は、
        // 「失敗」ではなく「登録済みのため取り込み不要」と分かる表現にする。
        if (skipped > 0 && parseFailed === 0) {
          showAlert(`すべて登録済み（リンク済み）のためスキップしました（${skipped} 件）。`);
        } else {
          const detail = [];
          if (skipped > 0) detail.push(`登録済み（リンク済み）スキップ ${skipped} 件`);
          if (parseFailed > 0) detail.push(`読込失敗 ${parseFailed} 件`);
          showAlert(`取り込める ${itemLabel} はありませんでした${detail.length ? `（${detail.join("、")}）` : ""}。`);
        }
        setImporting(false);
        return;
      }

      let imported = 0;
      let saveFailed = 0;
      for (const item of items) {
        try {
          await registerImported({ ...item, folder: currentPath });
          imported += 1;
        } catch (err) {
          saveFailed += 1;
          console.warn("[AnalyticsImport] failed to register:", err);
        }
      }

      clearSelection();
      const summary = [];
      if (skipped > 0) summary.push(`登録済み（リンク済み）スキップ ${skipped} 件`);
      if (parseFailed > 0) summary.push(`読込失敗 ${parseFailed} 件`);
      if (saveFailed > 0) summary.push(`保存失敗 ${saveFailed} 件`);
      const detailText = summary.length ? `（${summary.join("、")}）` : "";

      if (imported > 0) {
        showAlert(`${imported} 件の ${itemLabel} を取り込みました${detailText}。`);
      } else {
        showAlert(`取り込める ${itemLabel} はありませんでした${detailText}。`);
      }
    } catch (err) {
      showAlert(err?.message || `Google Drive からのインポートに失敗しました`);
    } finally {
      setImporting(false);
    }
  }, [importUrl, importFromDrive, registerImported, clearSelection, showAlert, itemLabel, currentPath, setImportDialogOpen, setImporting]);

  return {
    ...base,
    handleImportFromDrive,
    resultListKey: kind, // "questions" | "dashboards"
    resultSingleKey: kind === "questions" ? "question" : "dashboard",
  };
}

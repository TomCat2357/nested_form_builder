import { useCallback, useState } from "react";
import { useConfirmDialog } from "../../app/hooks/useConfirmDialog.js";
import { hasScriptRun } from "../../services/gasClient.js";
import { countItemsUnder } from "../../utils/folderTree.js";
import { sanitizeFileBaseName, downloadJsonOrZip, resolveDialogTargetIds, createMoveActions, createFolderCreateActions, createRenameActions } from "./listActionsShared.js";

/**
 * Question / Dashboard 一覧アクションを一括提供する汎用 hook。
 * フォーム用 useAdminFormListActions の Question/Dashboard 版（参照のみ機能を除く）。
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
  const archiveDialog = useConfirmDialog({ id: null, targetIds: [], multiple: false, allArchived: false });
  const deleteDialog = useConfirmDialog({ id: null, targetIds: [], multiple: false });
  const copyDialog = useConfirmDialog({ id: null });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  // フォルダ操作ダイアログ
  const newFolderDialog = useConfirmDialog();
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState("");
  const moveDialog = useConfirmDialog({ itemIds: [], folderPaths: [], count: 0 });
  const [moveDest, setMoveDest] = useState("");
  const [moveError, setMoveError] = useState("");
  const renameDialog = useConfirmDialog({ kind: "folder", path: "", id: "", currentName: "" });
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");

  const resultListKey = kind; // "questions" | "dashboards"
  const resultSingleKey = kind === "questions" ? "question" : "dashboard";

  const folderOf = (item) => (item && typeof item.folder === "string" ? item.folder : "");

  // selected(アイテム) + selectedFolders(フォルダ) の現在の選択をまとめる。
  const collectSelection = () => {
    const itemIds = Array.from(selected || []);
    const folderPaths = Array.from(selectedFolders || []);
    return { itemIds, folderPaths };
  };

  const handleArchiveSelected = () => {
    const targets = sortedItems.filter((item) => selected.has(item.id));
    if (!targets.length) {
      showAlert(`アーカイブする ${itemLabel} を選択してください。`);
      return;
    }
    const allArchived = targets.every((item) => item.archived);
    const targetIds = targets.map((item) => item.id);
    archiveDialog.open({
      id: targetIds[0],
      targetIds,
      multiple: targetIds.length > 1,
      allArchived,
    });
  };

  const handleDeleteSelected = () => {
    const { itemIds, folderPaths } = collectSelection();
    if (!itemIds.length && !folderPaths.length) {
      showAlert(`リンク解除する ${itemLabel} またはフォルダを選択してください。`);
      return;
    }
    // フォルダ配下のアイテム件数（直接選択アイテムと重複し得るが、サーバ側で冪等に解決される）。
    let folderItemCount = 0;
    folderPaths.forEach((path) => {
      folderItemCount += countItemsUnder(allItems, folderOf, path);
    });
    deleteDialog.open({
      id: itemIds[0] || null,
      targetIds: itemIds,
      folderPaths,
      multiple: itemIds.length > 1,
      folderItemCount,
    });
  };

  const handleCopySelected = () => {
    if (copying) return;
    if (!hasScriptRun()) {
      showAlert("コピー機能は Google Apps Script 環境でのみ利用可能です");
      return;
    }
    if (selected.size !== 1) {
      showAlert(`コピーする ${itemLabel} を 1 件選択してください。`);
      return;
    }
    const target = sortedItems.find((item) => selected.has(item.id));
    if (!target) {
      showAlert(`コピー可能な ${itemLabel} を選択してください。`);
      return;
    }
    copyDialog.open({ id: target.id });
  };

  const handleExport = async () => {
    if (!selected.size) {
      showAlert(`エクスポートする ${itemLabel} を選択してください。`);
      return;
    }
    setExporting(true);
    try {
      const targets = await exportItems(Array.from(selected));
      if (!targets.length) {
        showAlert("エクスポート可能なデータがありません");
        return;
      }

      const singularLabel = kind === "questions" ? "question" : "dashboard";
      await downloadJsonOrZip(targets, {
        entryName: (item, { index, total }) =>
          sanitizeFileBaseName(item?.name, total === 1 ? singularLabel : `${kind}_${index}`),
        zipPrefix: kind,
      });
      showAlert("エクスポートファイルをダウンロードしました。");
    } catch (err) {
      showAlert(`エクスポートに失敗しました: ${err.message || "不明なエラー"}`);
    } finally {
      setExporting(false);
    }
  };

  const handleImport = () => {
    if (importing) return;
    if (!hasScriptRun()) {
      showAlert("インポート機能は Google Apps Script 環境でのみ利用可能です");
      return;
    }
    setImportUrl("");
    setImportDialogOpen(true);
  };

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
  }, [importUrl, importFromDrive, registerImported, clearSelection, showAlert, itemLabel, currentPath]);

  const confirmArchiveAction = () => {
    const targetIds = resolveDialogTargetIds(archiveDialog.state, "id");
    if (!targetIds.length) return;
    const shouldUnarchive = archiveDialog.state.allArchived;
    clearSelectionByIds(targetIds);
    archiveDialog.reset();

    (async () => {
      try {
        if (shouldUnarchive) {
          await unarchive(targetIds);
        } else {
          await archive(targetIds);
        }
      } catch (err) {
        showAlert(`アーカイブ処理中にエラーが発生しました: ${err.message}`);
      }
    })();
  };

  const confirmDeleteAction = async () => {
    const targetIds = resolveDialogTargetIds(deleteDialog.state, "id");
    const folderPaths = Array.isArray(deleteDialog.state.folderPaths) ? deleteDialog.state.folderPaths : [];
    if (!targetIds.length && !folderPaths.length) return;
    try {
      // フォルダ削除（配下アイテム＋登録簿エントリをサーバ側で除去）
      for (const path of folderPaths) {
        await deleteFolder(path);
      }
      // 単体選択アイテムの削除（フォルダ配下と重複しても冪等）
      if (targetIds.length) {
        await remove(targetIds);
        clearSelectionByIds(targetIds);
      }
      if (folderPaths.length && clearFolderSelection) clearFolderSelection();
      deleteDialog.reset();
    } catch (err) {
      showAlert(err?.message || `${itemLabel} の削除中にエラーが発生しました`);
    }
  };

  const confirmCopyAction = async () => {
    const id = copyDialog.state.id;
    copyDialog.reset();
    if (!id) return;
    setCopying(true);
    try {
      await copy(id);
      clearSelection();
      showAlert(`${itemLabel} をコピーしました。コピー後に名前を変更してください。`);
    } catch (err) {
      showAlert(`${itemLabel} のコピーに失敗しました: ${err.message || "不明なエラー"}`);
    } finally {
      setCopying(false);
    }
  };

  // ---- 新規フォルダ ----
  const { handleCreateFolder, confirmCreateFolder } = createFolderCreateActions({
    showAlert,
    currentPath,
    createFolder,
    newFolderDialog,
    newFolderName,
    setNewFolderName,
    setNewFolderError,
  });

  // ---- 移動 ----
  const { handleMoveSelected, confirmMove } = createMoveActions({
    idsKey: "itemIds",
    collectSelection: () => {
      const { itemIds, folderPaths } = collectSelection();
      return { ids: itemIds, folderPaths };
    },
    emptySelectionMessage: `移動する ${itemLabel} またはフォルダを選択してください。`,
    moveDialog,
    moveDest,
    setMoveDest,
    setMoveError,
    registeredFolders,
    moveItems,
    clearSelectionByIds,
    clearFolderSelection,
    showAlert,
  });

  // ---- 名前変更 ----
  // フォルダ1件 → フォルダ名変更（mv の rename 相当）。アイテム1件 → アイテム自体の name 変更。
  const { handleRenameSelected, confirmRename } = createRenameActions({
    sortedItems,
    selected,
    selectedFolders,
    renameDialog,
    renameName,
    setRenameName,
    setRenameError,
    registeredFolders,
    renameItem,
    renameFolder,
    clearSelectionByIds,
    clearFolderSelection,
    getItemName: (item) => item.name || "",
    emptyRenameMessage: `名前を変更できる ${itemLabel} を選択してください。`,
    ambiguousRenameMessage: `名前を変更するフォルダまたは ${itemLabel} を1つだけ選択してください。`,
    showAlert,
  });

  return {
    confirmArchive: archiveDialog.state,
    setConfirmArchive: archiveDialog.setState,
    confirmDelete: deleteDialog.state,
    setConfirmDelete: deleteDialog.setState,
    confirmCopy: copyDialog.state,
    setConfirmCopy: copyDialog.setState,
    importDialogOpen,
    setImportDialogOpen,
    importUrl,
    setImportUrl,
    importing,
    exporting,
    copying,
    handleArchiveSelected,
    handleDeleteSelected,
    handleCopySelected,
    handleExport,
    handleImport,
    handleImportFromDrive,
    confirmArchiveAction,
    confirmDeleteAction,
    confirmCopyAction,
    resultListKey,
    resultSingleKey,
    // フォルダ操作
    newFolderDialogState: newFolderDialog.state,
    newFolderName,
    setNewFolderName,
    newFolderError,
    setNewFolderError,
    handleCreateFolder,
    confirmCreateFolder,
    closeNewFolderDialog: newFolderDialog.reset,
    moveDialogState: moveDialog.state,
    moveDest,
    setMoveDest,
    moveError,
    setMoveError,
    handleMoveSelected,
    confirmMove,
    closeMoveDialog: moveDialog.reset,
    renameDialogState: renameDialog.state,
    renameName,
    setRenameName,
    renameError,
    setRenameError,
    handleRenameSelected,
    confirmRename,
    closeRenameDialog: renameDialog.reset,
  };
}

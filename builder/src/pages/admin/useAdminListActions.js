import { useState } from "react";
import { useConfirmDialog } from "../../app/hooks/useConfirmDialog.js";
import { hasScriptRun } from "../../services/gasClient.js";
import { countItemsUnder } from "../../utils/folderTree.js";
import {
  sanitizeFileBaseName,
  downloadJsonOrZip,
  resolveDialogTargetIds,
  createMoveActions,
  createFolderCreateActions,
  createRenameActions,
} from "./listActionsShared.js";

export { sanitizeFileBaseName };

/**
 * Form 一覧（useAdminFormListActions）と Question/Dashboard 一覧（useAdminAnalyticsListActions）で
 * 「ほぼ行単位で同一」だった archive / delete / hardDelete / copy / export / フォルダ操作のダイアログ
 * 状態・ハンドラ・confirm 処理を集約した共通 hook。
 *
 * 両者の差分（id キー名・メッセージ文言・export 整形・コピー対象の選別・アーカイブ追加フィールド・
 * confirm エラーログ）は opts で注入する。import workflow と Form 限定の readOnly ダイアログは
 * 各ラッパー側に残し、戻り値へマージする（戻り値キーは両ページの既存利用に合わせて後方互換）。
 *
 * @param {Object} opts
 * @param {string} opts.idKey ダイアログ state の単体 ID フィールド名（"formId" | "id"）
 * @param {string} opts.folderCountKey 削除ダイアログのフォルダ配下件数キー（"folderFormCount" | "folderItemCount"）
 * @param {string} opts.moveIdsKey 移動アクションの ID 配列キー（"formIds" | "itemIds"）
 */
export function useAdminListActions({
  idKey,
  folderCountKey,
  moveIdsKey,
  sortedItems,
  selected,
  clearSelection,
  clearSelectionByIds,
  showAlert,
  // CRUD コールバック
  archive,
  unarchive,
  copy,
  remove,
  removeWithFiles,
  exportItems,
  // 文言・整形の注入
  messages,
  archiveExtraInit = {},
  computeArchiveExtra = () => ({}),
  pickCopyTarget,
  exportEntryName,
  exportZipPrefix,
  onActionError,
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
  renameGetItemName,
  renameIsItemRenamable,
  renameEmptyMessage,
  renameAmbiguousMessage,
  createFolderOnError,
  moveOnError,
  renameOnError,
}) {
  const archiveDialog = useConfirmDialog({ [idKey]: null, targetIds: [], multiple: false, allArchived: false, ...archiveExtraInit });
  const deleteDialog = useConfirmDialog({ [idKey]: null, targetIds: [], multiple: false });
  const hardDeleteDialog = useConfirmDialog({ [idKey]: null, targetIds: [], multiple: false });
  const copyDialog = useConfirmDialog({ [idKey]: null });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  // フォルダ操作ダイアログ
  const newFolderDialog = useConfirmDialog();
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState("");
  const moveDialog = useConfirmDialog({ [moveIdsKey]: [], folderPaths: [], count: 0 });
  const [moveDest, setMoveDest] = useState("");
  const [moveError, setMoveError] = useState("");
  const renameDialog = useConfirmDialog({ kind: "folder", path: "", id: "", currentName: "" });
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");

  const folderOf = (item) => (item && typeof item.folder === "string" ? item.folder : "");

  // selected(アイテム) + selectedFolders(フォルダ) の現在の選択をまとめる。
  const collectSelection = () => {
    const ids = Array.from(selected || []);
    const folderPaths = Array.from(selectedFolders || []);
    return { ids, folderPaths };
  };

  const handleArchiveSelected = () => {
    const targets = sortedItems.filter((item) => selected.has(item.id));
    if (!targets.length) {
      showAlert(messages.archiveEmpty);
      return;
    }
    const allArchived = targets.every((item) => item.archived);
    const targetIds = targets.map((item) => item.id);
    archiveDialog.open({
      [idKey]: targetIds[0],
      targetIds,
      multiple: targetIds.length > 1,
      allArchived,
      ...computeArchiveExtra(targets),
    });
  };

  const handleDeleteSelected = () => {
    const { ids, folderPaths } = collectSelection();
    if (!ids.length && !folderPaths.length) {
      showAlert(messages.deleteEmpty);
      return;
    }
    // フォルダ配下のアイテム件数（直接選択アイテムと重複し得るが、サーバ側で冪等に解決される）。
    let folderItemCount = 0;
    folderPaths.forEach((path) => {
      folderItemCount += countItemsUnder(allItems, folderOf, path);
    });
    deleteDialog.open({
      [idKey]: ids[0] || null,
      targetIds: ids,
      folderPaths,
      multiple: ids.length > 1,
      [folderCountKey]: folderItemCount,
    });
  };

  // 「削除」: 選択アイテムのみ対象（フォルダは対象外）。プロジェクト内ファイルは実体もゴミ箱へ。
  const handleHardDeleteSelected = () => {
    const ids = Array.from(selected || []);
    if (!ids.length) {
      showAlert(messages.hardDeleteEmpty);
      return;
    }
    hardDeleteDialog.open({
      [idKey]: ids[0] || null,
      targetIds: ids,
      multiple: ids.length > 1,
    });
  };

  const handleCopySelected = () => {
    if (copying) return;
    if (!hasScriptRun()) {
      showAlert(messages.copyNotInGas);
      return;
    }
    const id = pickCopyTarget();
    if (!id) return;
    copyDialog.open({ [idKey]: id });
  };

  const handleExport = async () => {
    if (!selected.size) {
      showAlert(messages.exportEmpty);
      return;
    }
    setExporting(true);
    try {
      const targets = await exportItems(Array.from(selected));
      if (!targets.length) {
        showAlert("エクスポート可能なデータがありません");
        return;
      }
      await downloadJsonOrZip(targets, { entryName: exportEntryName, zipPrefix: exportZipPrefix });
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
      showAlert(messages.importNotInGas);
      return;
    }
    setImportUrl("");
    setImportDialogOpen(true);
  };

  const confirmArchiveAction = () => {
    const targetIds = resolveDialogTargetIds(archiveDialog.state, idKey);
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
      } catch (error) {
        if (onActionError) onActionError("archive", error);
        showAlert(`アーカイブ処理中にエラーが発生しました: ${error.message}`);
      }
    })();
  };

  const confirmDeleteAction = async () => {
    const targetIds = resolveDialogTargetIds(deleteDialog.state, idKey);
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
    } catch (error) {
      if (onActionError) onActionError("delete", error);
      showAlert(error?.message || messages.deleteErrorFallback);
    }
  };

  const confirmHardDeleteAction = async () => {
    const targetIds = resolveDialogTargetIds(hardDeleteDialog.state, idKey);
    if (!targetIds.length) return;
    try {
      await removeWithFiles(targetIds);
      clearSelectionByIds(targetIds);
      hardDeleteDialog.reset();
    } catch (error) {
      if (onActionError) onActionError("hardDelete", error);
      showAlert(error?.message || messages.hardDeleteErrorFallback);
    }
  };

  const confirmCopyAction = async () => {
    const id = copyDialog.state[idKey];
    copyDialog.reset();
    if (!id) return;
    setCopying(true);
    try {
      await copy(id);
      clearSelection();
      showAlert(messages.copySuccess);
    } catch (error) {
      showAlert(messages.copyFailed(error));
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
    onError: createFolderOnError,
  });

  // ---- 移動 ----
  const { handleMoveSelected, confirmMove } = createMoveActions({
    idsKey: moveIdsKey,
    collectSelection,
    emptySelectionMessage: messages.moveEmpty,
    moveDialog,
    moveDest,
    setMoveDest,
    setMoveError,
    registeredFolders,
    moveItems,
    clearSelectionByIds,
    clearFolderSelection,
    showAlert,
    onError: moveOnError,
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
    getItemName: renameGetItemName,
    isItemRenamable: renameIsItemRenamable,
    emptyRenameMessage: renameEmptyMessage,
    ambiguousRenameMessage: renameAmbiguousMessage,
    showAlert,
    onError: renameOnError,
  });

  return {
    // ダイアログ state / setter
    confirmArchive: archiveDialog.state,
    setConfirmArchive: archiveDialog.setState,
    confirmDelete: deleteDialog.state,
    setConfirmDelete: deleteDialog.setState,
    confirmHardDelete: hardDeleteDialog.state,
    setConfirmHardDelete: hardDeleteDialog.setState,
    confirmCopy: copyDialog.state,
    setConfirmCopy: copyDialog.setState,
    // import / export 状態（handleImportFromDrive は各ラッパーが定義してマージする）
    importDialogOpen,
    setImportDialogOpen,
    importUrl,
    setImportUrl,
    importing,
    setImporting,
    exporting,
    copying,
    // ハンドラ
    handleArchiveSelected,
    handleDeleteSelected,
    handleHardDeleteSelected,
    handleCopySelected,
    handleExport,
    handleImport,
    confirmArchiveAction,
    confirmDeleteAction,
    confirmHardDeleteAction,
    confirmCopyAction,
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

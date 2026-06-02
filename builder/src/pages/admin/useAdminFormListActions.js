import { useCallback, useState } from "react";
import { useConfirmDialog } from "../../app/hooks/useConfirmDialog.js";
import { hasScriptRun, importFormsFromDrive } from "../../services/gasClient.js";
import { toUnixMs } from "../../utils/dateTime.js";
import { normalizeFolderPath, countItemsUnder, folderExists } from "../../utils/folderTree.js";
import { sanitizeFileBaseName, downloadJsonOrZip, resolveDialogTargetIds } from "./listActionsShared.js";
import { asPlainObject } from "../../utils/objectShape.js";

const buildImportDetail = (skipped = 0, parseFailed = 0, { useRegisteredLabel = false } = {}) => {
  const parts = [];
  if (skipped > 0) {
    const label = useRegisteredLabel ? "登録済み（リンク済み）スキップ" : "スキップ";
    parts.push(`${label} ${skipped} 件`);
  }
  if (parseFailed > 0) parts.push(`読込失敗 ${parseFailed} 件`);
  return parts.length > 0 ? `（${parts.join("、")}）` : "";
};

const sanitizeImportedForm = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const schema = Array.isArray(raw.schema) ? raw.schema : [];
  const settings = asPlainObject(raw.settings);
  const createdAtUnixMs = toUnixMs(raw.createdAtUnixMs ?? raw.createdAt);
  const modifiedAtUnixMs = toUnixMs(raw.modifiedAtUnixMs ?? raw.modifiedAt);

  if (!settings.formTitle && typeof raw.name === "string") {
    settings.formTitle = raw.name;
  }

  return {
    id: raw.id,
    description: typeof raw.description === "string" ? raw.description : "",
    schema,
    settings,
    archived: !!raw.archived,
    readOnly: !!raw.readOnly,
    schemaVersion: Number.isFinite(raw.schemaVersion) ? raw.schemaVersion : 1,
    createdAt: Number.isFinite(createdAtUnixMs) ? createdAtUnixMs : raw.createdAt,
    modifiedAt: Number.isFinite(modifiedAtUnixMs) ? modifiedAtUnixMs : raw.modifiedAt,
    createdAtUnixMs: Number.isFinite(createdAtUnixMs) ? createdAtUnixMs : null,
    modifiedAtUnixMs: Number.isFinite(modifiedAtUnixMs) ? modifiedAtUnixMs : null,
  };
};

const flattenImportedContents = (contents) => {
  const list = [];
  let invalidPayloadCount = 0;
  (Array.isArray(contents) ? contents : []).forEach((item) => {
    if (item && item.form && item.fileId) {
      const sanitized = sanitizeImportedForm(item.form);
      if (sanitized) {
        list.push({ form: sanitized, fileId: item.fileId, fileUrl: item.fileUrl || null });
      } else {
        invalidPayloadCount += 1;
      }
    } else {
      invalidPayloadCount += 1;
    }
  });
  return { list, invalidPayloadCount };
};

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
  const archiveDialog = useConfirmDialog({ formId: null, targetIds: [], multiple: false, allArchived: false, hasPublished: false });
  const readOnlyDialog = useConfirmDialog({ formId: null, targetIds: [], multiple: false, allReadOnly: false });
  const deleteDialog = useConfirmDialog({ formId: null, targetIds: [], multiple: false });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const copyDialog = useConfirmDialog({ formId: null });
  const [copying, setCopying] = useState(false);
  // フォルダ操作ダイアログ
  const newFolderDialog = useConfirmDialog();
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState("");
  const moveDialog = useConfirmDialog({ formIds: [], folderPaths: [], count: 0 });
  const [moveDest, setMoveDest] = useState("");
  const [moveError, setMoveError] = useState("");
  const renameDialog = useConfirmDialog({ kind: "folder", path: "", id: "", currentName: "" });
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");

  const folderOf = (item) => (item && typeof item.folder === "string" ? item.folder : "");

  // selected(フォーム) + selectedFolders(フォルダ) の現在の選択をまとめる。
  const collectSelection = () => {
    const formIds = Array.from(selected || []);
    const folderPaths = Array.from(selectedFolders || []);
    return { formIds, folderPaths };
  };

  const handleArchiveSelected = () => {
    const selectedForms = sortedForms.filter((form) => selected.has(form.id));
    if (!selectedForms.length) {
      showAlert("アーカイブ可能なフォームを選択してください。（読み込みエラーの項目は削除のみ可能です）");
      return;
    }

    const allArchived = selectedForms.every((form) => form.archived);
    const hasPublished = selectedForms.some((form) => !form.archived);

    const targetIds = selectedForms.map((form) => form.id);
    const firstId = targetIds[0];
    archiveDialog.open({
      formId: firstId,
      targetIds,
      multiple: targetIds.length > 1,
      allArchived,
      hasPublished,
    });
  };

  const handleReadOnlySelected = () => {
    const selectedForms = sortedForms.filter((form) => selected.has(form.id) && !form.loadError);
    if (!selectedForms.length) {
      showAlert("参照のみ設定可能なフォームを選択してください。");
      return;
    }

    const allReadOnly = selectedForms.every((form) => form.readOnly);
    const targetIds = selectedForms.map((form) => form.id);
    const firstId = targetIds[0];
    readOnlyDialog.open({
      formId: firstId,
      targetIds,
      multiple: targetIds.length > 1,
      allReadOnly,
    });
  };

  const handleDeleteSelected = () => {
    const { formIds, folderPaths } = collectSelection();
    if (!formIds.length && !folderPaths.length) {
      showAlert("リンク解除するフォームまたはフォルダを選択してください。");
      return;
    }
    // フォルダ配下のフォーム件数（直接選択フォームと重複し得るが、サーバ側で冪等に解決される）。
    let folderFormCount = 0;
    folderPaths.forEach((path) => {
      folderFormCount += countItemsUnder(allItems, folderOf, path);
    });
    deleteDialog.open({
      formId: formIds[0] || null,
      targetIds: formIds,
      folderPaths,
      multiple: formIds.length > 1,
      folderFormCount,
    });
  };

  const handleExport = async () => {
    if (!selected.size) {
      showAlert("スキーマをエクスポートするフォームを選択してください。");
      return;
    }
    setExporting(true);
    try {
      const targets = await exportForms(Array.from(selected));
      if (!targets.length) {
        showAlert("エクスポート可能なデータがありません");
        return;
      }

      await downloadJsonOrZip(targets, {
        entryName: (form) => sanitizeFileBaseName(form.settings?.formTitle, "form"),
        zipPrefix: "forms",
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
      showAlert("インポート機能はGoogle Apps Script環境でのみ利用可能です");
      return;
    }
    setImportUrl("");
    setImportDialogOpen(true);
  };

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
              error: error?.message || error,
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
    [registerImportedForm, showAlert, clearSelection, currentPath],
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

  const confirmArchiveAction = () => {
    const targetIds = resolveDialogTargetIds(archiveDialog.state, "formId");
    if (!targetIds.length) return;

    const shouldUnarchive = archiveDialog.state.allArchived;

    clearSelectionByIds(targetIds);
    archiveDialog.reset();

    (async () => {
      try {
        if (shouldUnarchive) {
          await unarchiveForms(targetIds);
        } else {
          await archiveForms(targetIds);
        }
      } catch (error) {
        console.error("[AdminFormList] Archive action failed:", error);
        showAlert(`アーカイブ処理中にエラーが発生しました: ${error.message}`);
      }
    })();
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

  const confirmDeleteAction = async () => {
    const targetIds = resolveDialogTargetIds(deleteDialog.state, "formId");
    const folderPaths = Array.isArray(deleteDialog.state.folderPaths) ? deleteDialog.state.folderPaths : [];
    if (!targetIds.length && !folderPaths.length) return;

    try {
      // フォルダ削除（配下フォーム＋登録簿エントリをサーバ側で除去）
      for (const path of folderPaths) {
        await deleteFolder(path);
      }
      // 単体選択フォームの削除（フォルダ配下と重複しても冪等）
      if (targetIds.length) {
        await deleteForms(targetIds);
        clearSelectionByIds(targetIds);
      }
      if (folderPaths.length && clearFolderSelection) clearFolderSelection();
      deleteDialog.reset();
    } catch (error) {
      console.error("[AdminFormList] Delete action failed:", error);
      showAlert(error?.message || "削除中にエラーが発生しました");
    }
  };

  // ---- 新規フォルダ ----
  const handleCreateFolder = () => {
    if (!hasScriptRun()) {
      showAlert("フォルダ作成はGoogle Apps Script環境でのみ利用可能です");
      return;
    }
    setNewFolderName("");
    setNewFolderError("");
    newFolderDialog.open();
  };

  const confirmCreateFolder = async () => {
    const name = (newFolderName || "").trim();
    if (!name) {
      setNewFolderError("フォルダ名を入力してください");
      return;
    }
    const path = normalizeFolderPath([currentPath, name].filter(Boolean).join("/"));
    try {
      await createFolder(path);
      newFolderDialog.reset();
      setNewFolderName("");
      setNewFolderError("");
    } catch (error) {
      console.error("[AdminFormList] Create folder failed:", error);
      setNewFolderError(error?.message || "フォルダの作成に失敗しました");
    }
  };

  // ---- 移動 ----
  const handleMoveSelected = () => {
    if (!hasScriptRun()) {
      showAlert("移動はGoogle Apps Script環境でのみ利用可能です");
      return;
    }
    const { formIds, folderPaths } = collectSelection();
    if (!formIds.length && !folderPaths.length) {
      showAlert("移動するフォームまたはフォルダを選択してください。");
      return;
    }
    setMoveDest("");
    setMoveError("");
    moveDialog.open({ formIds, folderPaths, count: formIds.length + folderPaths.length });
  };

  const confirmMove = () => {
    const formIds = Array.isArray(moveDialog.state.formIds) ? moveDialog.state.formIds : [];
    const folderPaths = Array.isArray(moveDialog.state.folderPaths) ? moveDialog.state.folderPaths : [];
    const destPath = normalizeFolderPath(moveDest);

    // クライアント側の存在チェック（最終判定はサーバ）。空欄=最上位は常に許可。
    if (destPath && !folderExists(registeredFolders, destPath)) {
      setMoveError(`移動先フォルダ「${destPath}」が存在しません`);
      return;
    }
    // フォルダを自身/配下へ移動しようとしていないか
    for (const old of folderPaths) {
      const o = normalizeFolderPath(old);
      if (destPath === o || destPath.startsWith(o + "/")) {
        setMoveError(`フォルダ「${o}」を自身またはその配下へは移動できません`);
        return;
      }
    }

    // ダイアログを先に閉じ、GAS はバックグラウンドで実行（完了後にリスト自動更新）。
    if (formIds.length) clearSelectionByIds(formIds);
    if (folderPaths.length && clearFolderSelection) clearFolderSelection();
    moveDialog.reset();
    setMoveDest("");
    setMoveError("");
    moveItems({ formIds, folderPaths, destPath }).catch((error) => {
      console.error("[AdminFormList] Move failed:", error);
      showAlert(error?.message || "移動に失敗しました");
    });
  };

  // ---- 名前変更 ----
  // フォルダ1件 → フォルダ名変更（mv の rename 相当。親は保持し leaf 名だけ変える）。
  // フォーム1件 → フォーム自体の名前（settings.formTitle）変更。文脈で切り替える。
  const handleRenameSelected = () => {
    if (!hasScriptRun()) {
      showAlert("名前変更はGoogle Apps Script環境でのみ利用可能です");
      return;
    }
    const folderPaths = Array.from(selectedFolders || []);
    const formIds = Array.from(selected || []);
    if (folderPaths.length === 1 && formIds.length === 0) {
      const path = normalizeFolderPath(folderPaths[0]);
      const currentName = path.split("/").pop() || "";
      setRenameName(currentName);
      setRenameError("");
      renameDialog.open({ kind: "folder", path, currentName });
      return;
    }
    if (formIds.length === 1 && folderPaths.length === 0) {
      const form = sortedForms.find((f) => f.id === formIds[0]);
      if (!form || form.loadError) {
        showAlert("名前を変更できるフォームを選択してください。");
        return;
      }
      const currentName = form.settings?.formTitle || "";
      setRenameName(currentName);
      setRenameError("");
      renameDialog.open({ kind: "item", id: form.id, currentName });
      return;
    }
    showAlert("名前を変更するフォルダまたはフォームを1つだけ選択してください。");
  };

  const confirmRenameItem = async () => {
    const formId = renameDialog.state.id;
    const newName = (renameName || "").trim();
    if (!newName) {
      setRenameError("新しい名前を入力してください");
      return;
    }
    try {
      await renameForm(formId, newName);
      clearSelectionByIds([formId]);
      renameDialog.reset();
      setRenameName("");
      setRenameError("");
    } catch (error) {
      console.error("[AdminFormList] Rename form failed:", error);
      setRenameError(error?.message || "名前の変更に失敗しました");
    }
  };

  const confirmRename = async () => {
    if (renameDialog.state.kind === "item") {
      await confirmRenameItem();
      return;
    }
    await confirmRenameFolder();
  };

  const confirmRenameFolder = async () => {
    const path = normalizeFolderPath(renameDialog.state.path);
    const newName = (renameName || "").trim();
    if (!newName) {
      setRenameError("新しいフォルダ名を入力してください");
      return;
    }
    if (newName.includes("/")) {
      setRenameError("フォルダ名に「/」は使用できません");
      return;
    }
    // 同じ階層内での同名衝突をクライアント側でも先取りチェック（最終判定はサーバ）。
    const segs = path.split("/");
    segs.pop();
    const parent = segs.join("/");
    const next = parent ? `${parent}/${newName}` : newName;
    if (next !== path && folderExists(registeredFolders, next)) {
      setRenameError(`同名のフォルダ「${next}」が既に存在します`);
      return;
    }

    try {
      await renameFolder({ path, newName });
      if (clearFolderSelection) clearFolderSelection();
      renameDialog.reset();
      setRenameName("");
      setRenameError("");
    } catch (error) {
      console.error("[AdminFormList] Rename folder failed:", error);
      setRenameError(error?.message || "名前の変更に失敗しました");
    }
  };

  const handleCopySelected = () => {
    if (copying) return;
    if (!hasScriptRun()) {
      showAlert("コピー機能はGoogle Apps Script環境でのみ利用可能です");
      return;
    }
    const selectedForm = sortedForms.find((f) => selected.has(f.id));
    if (!selectedForm || selectedForm.loadError) {
      showAlert("コピー可能なフォームを1件選択してください。");
      return;
    }
    copyDialog.open({ formId: selectedForm.id });
  };

  const confirmCopyAction = async () => {
    const formId = copyDialog.state.formId;
    copyDialog.reset();
    if (!formId) return;

    setCopying(true);
    try {
      await copyForm(formId);
      clearSelection();
      showAlert("フォームをコピーしました。スプレッドシートの設定を確認してください。");
    } catch (error) {
      showAlert("フォームのコピーに失敗しました: " + (error.message || "不明なエラー"));
    } finally {
      setCopying(false);
    }
  };

  return {
    confirmArchive: archiveDialog.state,
    setConfirmArchive: archiveDialog.setState,
    confirmReadOnly: readOnlyDialog.state,
    setConfirmReadOnly: readOnlyDialog.setState,
    confirmDelete: deleteDialog.state,
    setConfirmDelete: deleteDialog.setState,
    importDialogOpen,
    setImportDialogOpen,
    importUrl,
    setImportUrl,
    importing,
    exporting,
    confirmCopy: copyDialog.state,
    setConfirmCopy: copyDialog.setState,
    copying,
    handleArchiveSelected,
    handleReadOnlySelected,
    handleDeleteSelected,
    handleExport,
    handleImport,
    handleImportFromDrive,
    confirmArchiveAction,
    confirmReadOnlyAction,
    confirmDeleteAction,
    handleCopySelected,
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

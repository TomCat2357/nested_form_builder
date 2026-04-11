import { useCallback, useState } from "react";
import JSZip from "jszip";
import { useConfirmDialog } from "../app/hooks/useConfirmDialog.js";
import { hasScriptRun, importFormsFromDrive } from "../services/gasClient.js";
import { toUnixMs } from "../utils/dateTime.js";

const buildImportDetail = (skipped = 0, parseFailed = 0, { useRegisteredLabel = false } = {}) => {
  const parts = [];
  if (skipped > 0) {
    const label = useRegisteredLabel ? "登録済みスキップ" : "スキップ";
    parts.push(`${label} ${skipped} 件`);
  }
  if (parseFailed > 0) parts.push(`読込失敗 ${parseFailed} 件`);
  return parts.length > 0 ? `（${parts.join("、")}）` : "";
};

const sanitizeImportedForm = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const schema = Array.isArray(raw.schema) ? raw.schema : [];
  const settings = raw && typeof raw.settings === "object" && !Array.isArray(raw.settings) ? raw.settings : {};
  const createdAtUnixMs = toUnixMs(raw.createdAtUnixMs ?? raw.createdAt);
  const modifiedAtUnixMs = toUnixMs(raw.modifiedAtUnixMs ?? raw.modifiedAt);

  // 旧形式のnameフィールドがある場合、settings.formTitleに移行
  if (!settings.formTitle && typeof raw.name === "string") {
    settings.formTitle = raw.name;
  }

  return {
    id: raw.id, // IDを保持（重要）
    description: typeof raw.description === "string" ? raw.description : "",
    schema,
    settings,
    archived: !!raw.archived,
    schemaVersion: Number.isFinite(raw.schemaVersion) ? raw.schemaVersion : 1,
    createdAt: Number.isFinite(createdAtUnixMs) ? createdAtUnixMs : raw.createdAt, // 作成日時を保持
    modifiedAt: Number.isFinite(modifiedAtUnixMs) ? modifiedAtUnixMs : raw.modifiedAt, // 更新日時を保持
    createdAtUnixMs: Number.isFinite(createdAtUnixMs) ? createdAtUnixMs : null,
    modifiedAtUnixMs: Number.isFinite(modifiedAtUnixMs) ? modifiedAtUnixMs : null,
  };
};

const flattenImportedContents = (contents) => {
  const list = [];
  let invalidPayloadCount = 0;
  (Array.isArray(contents) ? contents : []).forEach((item) => {
    // GASから返ってくる新形式: { form, fileId, fileUrl }
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

export function useAdminDashboardActions({
  sortedForms,
  selected,
  clearSelection,
  clearSelectionByIds,
  showAlert,
  archiveForms,
  unarchiveForms,
  deleteForms,
  exportForms,
  copyForm,
  registerImportedForm,
}) {
  const archiveDialog = useConfirmDialog({ formId: null, targetIds: [], multiple: false, allArchived: false, hasPublished: false });
  const deleteDialog = useConfirmDialog({ formId: null, targetIds: [], multiple: false });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const copyDialog = useConfirmDialog({ formId: null });
  const [copying, setCopying] = useState(false);

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

  const handleDeleteSelected = () => {
    if (!selected.size) {
      showAlert("削除するフォームを選択してください。");
      return;
    }
    const targetIds = Array.from(selected);
    const firstId = targetIds[0];
    deleteDialog.open({ formId: firstId, multiple: targetIds.length > 1, targetIds });
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

      let blob, filename, mimeType;

      if (targets.length === 1) {
        const form = targets[0];
        const safeTitle = (form.settings?.formTitle || "form").replace(/[\\/:*?"<>|\r\n]/g, "_").replace(/^\.+/, "");
        filename = `${safeTitle}.json`;
        mimeType = "application/json";
        blob = new Blob([JSON.stringify(form, null, 2)], { type: mimeType });
      } else {
        const zip = new JSZip();
        targets.forEach((form) => {
          const safeTitle = (form.settings?.formTitle || "form").replace(/[\\/:*?"<>|\r\n]/g, "_").replace(/^\.+/, "");
          zip.file(`${safeTitle}.json`, JSON.stringify(form, null, 2));
        });
        blob = await zip.generateAsync({ type: "blob" });
        filename = `forms_${new Date().toISOString().replace(/[:.-]/g, "")}.zip`;
        mimeType = "application/zip";
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
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
            // fileIdがある場合はコピーなしで登録（元ファイルをそのまま管理）
            await registerImportedForm({
              form: item.form,
              fileId: item.fileId,
              fileUrl: item.fileUrl,
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

        // 結果メッセージ
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
    [registerImportedForm, showAlert],
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
      // Google DriveからフォームデータをAPI経由で取得
      const result = await importFormsFromDrive(url);
      const { forms: importedForms, skipped = 0, parseFailed = 0 } = result;
      const detail = buildImportDetail(skipped, parseFailed);

      if (!importedForms || importedForms.length === 0) {
        showAlert(`有効なフォームがありませんでした${detail}。`);
        setImporting(false);
        return;
      }

      // インポートワークフローを実行
      await startImportWorkflow(importedForms, { skipped, parseFailed });
    } catch (error) {
      console.error("[DriveImport] import from Drive failed", error);
      showAlert(error?.message || "Google Driveからのインポートに失敗しました");
      setImporting(false);
    }
  };

  const confirmArchiveAction = () => {
    const targetIds = (archiveDialog.state.targetIds && archiveDialog.state.targetIds.length
      ? archiveDialog.state.targetIds
      : archiveDialog.state.formId
        ? [archiveDialog.state.formId]
        : []);
    if (!targetIds.length) return;

    // アーカイブ状態を保持
    const shouldUnarchive = archiveDialog.state.allArchived;

    // ダイアログを即座に閉じて選択をクリア
    clearSelectionByIds(targetIds);
    archiveDialog.reset();

    // バックグラウンドで一括処理を実行
    (async () => {
      try {
        if (shouldUnarchive) {
          await unarchiveForms(targetIds);
        } else {
          await archiveForms(targetIds);
        }
      } catch (error) {
        console.error("[AdminDashboard] Archive action failed:", error);
        showAlert(`アーカイブ処理中にエラーが発生しました: ${error.message}`);
      }
    })();
  };

  const confirmDeleteAction = async () => {
    const targetIds = (deleteDialog.state.targetIds && deleteDialog.state.targetIds.length
      ? deleteDialog.state.targetIds
      : deleteDialog.state.formId
        ? [deleteDialog.state.formId]
        : []);
    if (!targetIds.length) return;

    try {
      await deleteForms(targetIds);
      clearSelectionByIds(targetIds);
      deleteDialog.reset();
    } catch (error) {
      console.error("[AdminDashboard] Delete action failed:", error);
      showAlert(error?.message || "フォームの削除中にエラーが発生しました");
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
    handleDeleteSelected,
    handleExport,
    handleImport,
    handleImportFromDrive,
    confirmArchiveAction,
    confirmDeleteAction,
    handleCopySelected,
    confirmCopyAction,
  };
}

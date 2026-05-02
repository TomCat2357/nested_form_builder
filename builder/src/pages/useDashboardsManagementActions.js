import { useCallback, useState } from "react";
import JSZip from "jszip";
import { useConfirmDialog } from "../app/hooks/useConfirmDialog.js";
import { hasScriptRun, importDashboardsFromDrive } from "../services/gasClient.js";
import { sanitizeImportedDashboard } from "../features/dashboards/dashboardSchema.js";

const buildImportDetail = (skipped = 0, parseFailed = 0, { useRegisteredLabel = false } = {}) => {
  const parts = [];
  if (skipped > 0) {
    const label = useRegisteredLabel ? "登録済みスキップ" : "スキップ";
    parts.push(`${label} ${skipped} 件`);
  }
  if (parseFailed > 0) parts.push(`読込失敗 ${parseFailed} 件`);
  return parts.length > 0 ? `（${parts.join("、")}）` : "";
};

const flattenImportedContents = (contents) => {
  const list = [];
  let invalidPayloadCount = 0;
  (Array.isArray(contents) ? contents : []).forEach((item) => {
    if (item && item.dashboard && item.fileId) {
      const sanitized = sanitizeImportedDashboard(item.dashboard);
      if (sanitized) {
        list.push({ dashboard: sanitized, fileId: item.fileId, fileUrl: item.fileUrl || null });
      } else {
        invalidPayloadCount += 1;
      }
    } else {
      invalidPayloadCount += 1;
    }
  });
  return { list, invalidPayloadCount };
};

export function useDashboardsManagementActions({
  sortedDashboards,
  selected,
  clearSelection,
  clearSelectionByIds,
  showAlert,
  archiveDashboards,
  unarchiveDashboards,
  setDashboardsReadOnly,
  clearDashboardsReadOnly,
  deleteDashboards,
  exportDashboards,
  copyDashboard,
  registerImportedDashboard,
}) {
  const archiveDialog = useConfirmDialog({ dashboardId: null, targetIds: [], multiple: false, allArchived: false, hasPublished: false });
  const readOnlyDialog = useConfirmDialog({ dashboardId: null, targetIds: [], multiple: false, allReadOnly: false });
  const deleteDialog = useConfirmDialog({ dashboardId: null, targetIds: [], multiple: false });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const copyDialog = useConfirmDialog({ dashboardId: null });
  const [copying, setCopying] = useState(false);

  const handleArchiveSelected = () => {
    const selectedItems = sortedDashboards.filter((d) => selected.has(d.id));
    if (!selectedItems.length) {
      showAlert("アーカイブ可能なダッシュボードを選択してください。");
      return;
    }
    const allArchived = selectedItems.every((d) => d.archived);
    const hasPublished = selectedItems.some((d) => !d.archived);
    const targetIds = selectedItems.map((d) => d.id);
    archiveDialog.open({ dashboardId: targetIds[0], targetIds, multiple: targetIds.length > 1, allArchived, hasPublished });
  };

  const handleReadOnlySelected = () => {
    const selectedItems = sortedDashboards.filter((d) => selected.has(d.id) && !d.loadError);
    if (!selectedItems.length) {
      showAlert("参照のみ設定可能なダッシュボードを選択してください。");
      return;
    }
    const allReadOnly = selectedItems.every((d) => d.readOnly);
    const targetIds = selectedItems.map((d) => d.id);
    readOnlyDialog.open({ dashboardId: targetIds[0], targetIds, multiple: targetIds.length > 1, allReadOnly });
  };

  const handleDeleteSelected = () => {
    if (!selected.size) {
      showAlert("削除するダッシュボードを選択してください。");
      return;
    }
    const targetIds = Array.from(selected);
    deleteDialog.open({ dashboardId: targetIds[0], multiple: targetIds.length > 1, targetIds });
  };

  const handleExport = async () => {
    if (!selected.size) {
      showAlert("エクスポートするダッシュボードを選択してください。");
      return;
    }
    setExporting(true);
    try {
      const targets = await exportDashboards(Array.from(selected));
      if (!targets.length) {
        showAlert("エクスポート可能なデータがありません");
        return;
      }
      let blob;
      let filename;
      let mimeType;
      if (targets.length === 1) {
        const dashboard = targets[0];
        const safeTitle = (dashboard.settings?.title || "dashboard").replace(/[\\/:*?"<>|\r\n]/g, "_").replace(/^\.+/, "");
        filename = `${safeTitle}.dashboard.json`;
        mimeType = "application/json";
        blob = new Blob([JSON.stringify(dashboard, null, 2)], { type: mimeType });
      } else {
        const zip = new JSZip();
        targets.forEach((dashboard) => {
          const safeTitle = (dashboard.settings?.title || "dashboard").replace(/[\\/:*?"<>|\r\n]/g, "_").replace(/^\.+/, "");
          zip.file(`${safeTitle}.dashboard.json`, JSON.stringify(dashboard, null, 2));
        });
        blob = await zip.generateAsync({ type: "blob" });
        filename = `dashboards_${new Date().toISOString().replace(/[:.-]/g, "")}.zip`;
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
        showAlert(`取り込めるダッシュボードはありませんでした${detail}。`);
        return;
      }
      setImporting(true);
      let imported = 0;
      let saveFailed = invalidPayloadCount;
      try {
        for (const item of queue) {
          try {
            await registerImportedDashboard({
              dashboard: item.dashboard,
              fileId: item.fileId,
              fileUrl: item.fileUrl,
            });
            imported += 1;
          } catch (error) {
            saveFailed += 1;
            console.warn("[DashboardImport] failed", { id: item?.dashboard?.id, error: error?.message || error });
          }
        }
        clearSelection();
        const saveFailedDetail = saveFailed > 0 ? `（保存失敗 ${saveFailed} 件）` : "";
        if (imported > 0) {
          showAlert(`${imported} 件のダッシュボードを取り込みました${detail}${saveFailedDetail}。`);
        } else {
          showAlert(`取り込めるダッシュボードはありませんでした${detail}${saveFailedDetail}。`);
        }
      } catch (error) {
        console.error("[DashboardImport] workflow failed", error);
        showAlert(error?.message || "ダッシュボードの取り込み中にエラーが発生しました");
      } finally {
        setImporting(false);
      }
    },
    [registerImportedDashboard, showAlert, clearSelection],
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
      const result = await importDashboardsFromDrive(url);
      const { dashboards: imported, skipped = 0, parseFailed = 0 } = result;
      const detail = buildImportDetail(skipped, parseFailed);
      if (!imported || imported.length === 0) {
        showAlert(`有効なダッシュボードがありませんでした${detail}。`);
        setImporting(false);
        return;
      }
      await startImportWorkflow(imported, { skipped, parseFailed });
    } catch (error) {
      console.error("[DashboardImport] from Drive failed", error);
      showAlert(error?.message || "Google Driveからのインポートに失敗しました");
      setImporting(false);
    }
  };

  const confirmArchiveAction = () => {
    const targetIds = (archiveDialog.state.targetIds && archiveDialog.state.targetIds.length
      ? archiveDialog.state.targetIds
      : archiveDialog.state.dashboardId
        ? [archiveDialog.state.dashboardId]
        : []);
    if (!targetIds.length) return;
    const shouldUnarchive = archiveDialog.state.allArchived;
    clearSelectionByIds(targetIds);
    archiveDialog.reset();
    (async () => {
      try {
        if (shouldUnarchive) await unarchiveDashboards(targetIds);
        else await archiveDashboards(targetIds);
      } catch (error) {
        console.error("[DashboardsManagement] Archive failed:", error);
        showAlert(`アーカイブ処理中にエラーが発生しました: ${error.message}`);
      }
    })();
  };

  const confirmReadOnlyAction = () => {
    const targetIds = (readOnlyDialog.state.targetIds && readOnlyDialog.state.targetIds.length
      ? readOnlyDialog.state.targetIds
      : readOnlyDialog.state.dashboardId
        ? [readOnlyDialog.state.dashboardId]
        : []);
    if (!targetIds.length) return;
    const shouldClear = readOnlyDialog.state.allReadOnly;
    clearSelectionByIds(targetIds);
    readOnlyDialog.reset();
    (async () => {
      try {
        if (shouldClear) await clearDashboardsReadOnly(targetIds);
        else await setDashboardsReadOnly(targetIds);
      } catch (error) {
        console.error("[DashboardsManagement] ReadOnly failed:", error);
        showAlert(`参照のみ設定中にエラーが発生しました: ${error.message}`);
      }
    })();
  };

  const confirmDeleteAction = async () => {
    const targetIds = (deleteDialog.state.targetIds && deleteDialog.state.targetIds.length
      ? deleteDialog.state.targetIds
      : deleteDialog.state.dashboardId
        ? [deleteDialog.state.dashboardId]
        : []);
    if (!targetIds.length) return;
    try {
      await deleteDashboards(targetIds);
      clearSelectionByIds(targetIds);
      deleteDialog.reset();
    } catch (error) {
      console.error("[DashboardsManagement] Delete failed:", error);
      showAlert(error?.message || "ダッシュボードの削除中にエラーが発生しました");
    }
  };

  const handleCopySelected = () => {
    if (copying) return;
    if (!hasScriptRun()) {
      showAlert("コピー機能はGoogle Apps Script環境でのみ利用可能です");
      return;
    }
    const selectedDashboard = sortedDashboards.find((d) => selected.has(d.id));
    if (!selectedDashboard || selectedDashboard.loadError) {
      showAlert("コピー可能なダッシュボードを1件選択してください。");
      return;
    }
    copyDialog.open({ dashboardId: selectedDashboard.id });
  };

  const confirmCopyAction = async () => {
    const dashboardId = copyDialog.state.dashboardId;
    copyDialog.reset();
    if (!dashboardId) return;
    setCopying(true);
    try {
      await copyDashboard(dashboardId);
      clearSelection();
      showAlert("ダッシュボードをコピーしました。");
    } catch (error) {
      showAlert("ダッシュボードのコピーに失敗しました: " + (error.message || "不明なエラー"));
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
  };
}

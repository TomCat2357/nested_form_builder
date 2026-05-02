import React, { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useSetSelection } from "../app/hooks/useSetSelection.js";
import { useAlert } from "../app/hooks/useAlert.js";
import { toUnixMs, formatUnixMsDateTimeMs } from "../utils/dateTime.js";
import ImportUrlDialog from "./AdminImportUrlDialog.jsx";
import { useDashboardsManagementActions } from "./useDashboardsManagementActions.js";

const toComparableUnixMs = (value) => {
  const ms = Number.isFinite(value) ? value : toUnixMs(value);
  return Number.isFinite(ms) ? ms : 0;
};

const formatUnixMsValue = (value) => {
  const ms = toComparableUnixMs(value);
  return ms > 0 ? formatUnixMsDateTimeMs(ms) : "---";
};

export default function DashboardsManagementPage() {
  const {
    dashboards,
    dashboardLoadFailures,
    loadingDashboards,
    dashboardsLastSyncedAt,
    refreshDashboards,
    archiveDashboards,
    unarchiveDashboards,
    setDashboardsReadOnly,
    clearDashboardsReadOnly,
    deleteDashboards,
    exportDashboards,
    copyDashboard,
    registerImportedDashboard,
  } = useAppData();
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const { selected, toggle: toggleSelect, selectAll: selectAllRaw, clear: clearSelection, clearByIds: clearSelectionByIds } = useSetSelection();

  useEffect(() => {
    if (!loadingDashboards) {
      refreshDashboards({ reason: "dashboards-mount", background: dashboards.length > 0 }).catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedDashboards = useMemo(() => {
    const list = dashboards.slice();
    list.sort((a, b) => toComparableUnixMs(b.modifiedAtUnixMs) - toComparableUnixMs(a.modifiedAtUnixMs));
    return list;
  }, [dashboards]);

  const loadFailureRows = useMemo(() => {
    const rows = (dashboardLoadFailures || []).map((item) => ({
      id: item.id,
      archived: true,
      settings: {},
      description: "",
      modifiedAtUnixMs: toUnixMs(item.lastTriedAt),
      loadError: item,
    }));
    rows.sort((a, b) => toComparableUnixMs(b.modifiedAtUnixMs) - toComparableUnixMs(a.modifiedAtUnixMs));
    return rows;
  }, [dashboardLoadFailures]);

  const allRows = useMemo(() => [...sortedDashboards, ...loadFailureRows], [sortedDashboards, loadFailureRows]);

  const selectAll = (checked) => {
    if (checked) selectAllRaw(allRows.map((d) => d.id));
    else clearSelection();
  };

  const {
    confirmArchive,
    setConfirmArchive,
    confirmReadOnly,
    setConfirmReadOnly,
    confirmDelete,
    setConfirmDelete,
    importDialogOpen,
    setImportDialogOpen,
    importUrl,
    setImportUrl,
    importing,
    exporting,
    confirmCopy,
    setConfirmCopy,
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
  } = useDashboardsManagementActions({
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
  });

  const goToEditor = (dashboardId) => {
    navigate(`/dashboards/${dashboardId}/edit`);
  };

  const goToView = (dashboardId) => {
    navigate(`/dashboards/${dashboardId}/view`);
  };

  const handleCreateNew = () => {
    navigate("/dashboards/new");
  };

  return (
    <AppLayout
      title="ダッシュボード管理"
      badge="ダッシュボード一覧"
      fallbackPath="/"
      sidebarActions={
        <>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-13" onClick={handleCreateNew}>
            新規作成
          </button>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-13" onClick={handleImport}>
            {importing ? "インポート中..." : "インポート"}
          </button>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-13" onClick={handleExport} disabled={exporting || selected.size === 0}>
            {exporting ? "エクスポート中..." : "エクスポート"}
          </button>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-13" onClick={handleCopySelected} disabled={copying || selected.size !== 1}>
            {copying ? "コピー中..." : "コピー"}
          </button>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-13" onClick={handleArchiveSelected} disabled={selected.size === 0}>
            アーカイブ
          </button>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-13" onClick={handleReadOnlySelected} disabled={selected.size === 0}>
            参照のみ
          </button>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-13 admin-danger-btn" onClick={handleDeleteSelected} disabled={selected.size === 0}>
            削除
          </button>
          <button
            type="button"
            className={`nf-btn-outline nf-btn-sidebar nf-text-13${!loadingDashboards ? " admin-refresh-btn" : ""}`}
            onClick={() => refreshDashboards({ reason: "manual:dashboards", background: false })}
            disabled={loadingDashboards}
          >
            {loadingDashboards ? "🔄 更新中..." : "🔄 更新"}
          </button>
        </>
      }
    >
      {loadingDashboards && dashboards.length === 0 ? (
        <p className="nf-text-subtle">読み込み中...</p>
      ) : (
        <div className="search-table-wrap">
          <table className="search-table">
            <thead>
              <tr>
                <th className="search-th">
                  <input type="checkbox" checked={allRows.length > 0 && selected.size === allRows.length} onChange={(event) => selectAll(event.target.checked)} />
                </th>
                <th className="search-th">名称</th>
                <th className="search-th">ダッシュボードID</th>
                <th className="search-th">更新日時</th>
                <th className="search-th">テンプレート</th>
                <th className="search-th">状態</th>
              </tr>
            </thead>
            <tbody>
              {allRows.map((dashboard) => {
                const isLoadError = !!dashboard.loadError;
                const loadError = dashboard.loadError || null;
                const lastUpdated = isLoadError
                  ? formatUnixMsValue(loadError?.lastTriedAt)
                  : formatUnixMsValue(dashboard.modifiedAtUnixMs);
                return (
                  <tr
                    key={dashboard.id}
                    className="admin-row"
                    data-clickable={isLoadError ? "false" : "true"}
                    data-error={isLoadError ? "true" : "false"}
                    onClick={() => {
                      if (!isLoadError) goToView(dashboard.id);
                    }}
                  >
                    <td className="search-td" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(dashboard.id)} onChange={() => toggleSelect(dashboard.id)} />
                      {isLoadError && <div className="nf-text-danger-ink nf-text-11 nf-mt-4">削除のみ可能</div>}
                    </td>
                    <td className="search-td">
                      {isLoadError ? (
                        <>
                          <div className="nf-fw-600 nf-text-danger-ink">{loadError?.fileName || "(名称不明)"}</div>
                          <div className="nf-text-danger-ink-strong nf-text-12">ID: {dashboard.id}</div>
                        </>
                      ) : (
                        <>
                          <div className="nf-fw-600">{dashboard.settings?.title || "(無題)"}</div>
                          {dashboard.description && <div className="nf-text-muted nf-text-12 nf-pre-wrap">{dashboard.description}</div>}
                        </>
                      )}
                    </td>
                    <td className="search-td">
                      <div className="nf-row nf-gap-6">
                        <span className="admin-form-id">{dashboard.id}</span>
                        {!isLoadError && (
                          <button
                            type="button"
                            className="admin-copy-btn"
                            onClick={(e) => { e.stopPropagation(); goToEditor(dashboard.id); }}
                            title="編集画面を開く"
                          >
                            ✏
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="search-td">{lastUpdated}</td>
                    <td className="search-td">
                      {isLoadError ? (
                        <span className="nf-text-danger-strong nf-fw-600">読み込みエラー</span>
                      ) : dashboard.templateUrl ? (
                        <a href={dashboard.templateUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="admin-link">
                          テンプレートを開く
                        </a>
                      ) : (
                        <span className="nf-text-subtle nf-text-12">未設定</span>
                      )}
                    </td>
                    <td className="search-td">
                      {isLoadError ? (
                        <span className="nf-text-danger-strong nf-fw-600">読み込みエラー</span>
                      ) : dashboard.archived ? (
                        <span className="nf-text-danger-strong">アーカイブ済み</span>
                      ) : dashboard.readOnly ? (
                        <span className="nf-text-warning nf-fw-600">参照のみ</span>
                      ) : (
                        <span className="nf-text-success">公開中</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {allRows.length === 0 && (
                <tr>
                  <td className="search-td nf-text-center" colSpan={6}>
                    ダッシュボードが登録されていません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {dashboardsLastSyncedAt && (
            <p className="nf-text-muted nf-text-11 nf-mt-8">最終取得: {formatUnixMsValue(dashboardsLastSyncedAt)}</p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmArchive.open}
        title={confirmArchive.allArchived ? "アーカイブを解除" : "ダッシュボードをアーカイブ"}
        message={
          confirmArchive.allArchived
            ? "このダッシュボードのアーカイブを解除して公開中に戻します。よろしいですか？"
            : "このダッシュボードをアーカイブします。よろしいですか？"
        }
        options={[
          { label: "キャンセル", value: "cancel", onSelect: () => setConfirmArchive({ open: false, dashboardId: null, targetIds: [], multiple: false, allArchived: false, hasPublished: false }) },
          { label: confirmArchive.allArchived ? "解除" : "アーカイブ", value: "archive", variant: "primary", onSelect: confirmArchiveAction },
        ]}
      />

      <ConfirmDialog
        open={confirmReadOnly.open}
        title={confirmReadOnly.allReadOnly ? "参照のみを解除" : "ダッシュボードを参照のみに設定"}
        message={
          confirmReadOnly.allReadOnly
            ? "このダッシュボードの参照のみ設定を解除します。よろしいですか？"
            : "このダッシュボードを参照のみに設定します。以降、編集・削除ができなくなります（閲覧は可能）。よろしいですか？"
        }
        options={[
          { label: "キャンセル", value: "cancel", onSelect: () => setConfirmReadOnly({ open: false, dashboardId: null, targetIds: [], multiple: false, allReadOnly: false }) },
          { label: confirmReadOnly.allReadOnly ? "解除" : "参照のみに設定", value: "readOnly", variant: "primary", onSelect: confirmReadOnlyAction },
        ]}
      />

      <ConfirmDialog
        open={confirmDelete.open}
        title="ダッシュボードを削除"
        message={
          confirmDelete.multiple
            ? "選択したダッシュボードのリンクを管理一覧から外します。Driveファイル自体は削除されません。よろしいですか？"
            : "このダッシュボードのリンクを管理一覧から外します。Driveファイル自体は削除されません。よろしいですか？"
        }
        options={[
          { label: "キャンセル", value: "cancel", onSelect: () => setConfirmDelete({ open: false, dashboardId: null, targetIds: [], multiple: false }) },
          { label: "削除", value: "delete", variant: "danger", onSelect: confirmDeleteAction },
        ]}
      />

      <ConfirmDialog
        open={confirmCopy.open}
        title="ダッシュボードをコピー"
        message="ダッシュボード定義を複製します。コピー元と同じフォルダに保存されます。"
        options={[
          { label: "キャンセル", value: "cancel", onSelect: () => setConfirmCopy({ open: false, dashboardId: null }) },
          { label: "コピー", value: "copy", variant: "primary", onSelect: confirmCopyAction },
        ]}
      />

      <ImportUrlDialog
        open={importDialogOpen}
        url={importUrl}
        onUrlChange={setImportUrl}
        onImport={handleImportFromDrive}
        onCancel={() => setImportDialogOpen(false)}
      />
    </AppLayout>
  );
}

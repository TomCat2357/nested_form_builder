import React, { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useFormCacheSync } from "../app/hooks/useFormCacheSync.js";
import { useSetSelection } from "../app/hooks/useSetSelection.js";
import { useAlert } from "../app/hooks/useAlert.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { toUnixMs, formatUnixMsDateTimeMs } from "../utils/dateTime.js";
import { buildSharedFormUrl } from "../utils/formShareUrl.js";
import ImportUrlDialog from "./AdminImportUrlDialog.jsx";
import { useAdminDashboardActions } from "./useAdminDashboardActions.js";

const formatDisplayFieldsSummary = (form) => {
  if (!form) return "";
  const settings = Array.isArray(form.displayFieldSettings) && form.displayFieldSettings.length
    ? form.displayFieldSettings
    : (Array.isArray(form.importantFields) ? form.importantFields.map((path) => ({ path })) : []);
  if (!settings.length) return "";
  return settings
    .filter((item) => item?.path)
    .map((item) => item.path)
    .join(", ");
};

const toComparableUnixMs = (value) => {
  const ms = Number.isFinite(value) ? value : toUnixMs(value);
  return Number.isFinite(ms) ? ms : 0;
};

const formatUnixMsValue = (value) => {
  const ms = toComparableUnixMs(value);
  return ms > 0 ? formatUnixMsDateTimeMs(ms) : "---";
};

export default function AdminDashboardPage() {
  const { forms, loadFailures, loadingForms, lastSyncedAt, archiveForms, unarchiveForms, setFormsReadOnly, clearFormsReadOnly, deleteForms, refreshForms, exportForms, copyForm, registerImportedForm } = useAppData();
  useBuilderSettings();
  const navigate = useNavigate();
  const { showAlert } = useAlert();
const { selected, toggle: toggleSelect, selectAll: selectAllRaw, clear: clearSelection, clearByIds: clearSelectionByIds } = useSetSelection();
  const [copiedId, setCopiedId] = useState(null);

  
  const sortedForms = useMemo(() => {
    const list = forms.slice();
    list.sort(
      (a, b) => toComparableUnixMs(b.modifiedAtUnixMs ?? b.modifiedAt) -
        toComparableUnixMs(a.modifiedAtUnixMs ?? a.modifiedAt)
    );
    return list;
  }, [forms]);

  const loadFailureRows = useMemo(() => {
    const rows = (loadFailures || []).map((item) => ({
      id: item.id,
      archived: true,
      settings: {},
      description: "",
      modifiedAt: item.lastTriedAt,
      modifiedAtUnixMs: toUnixMs(item.lastTriedAt),
      loadError: item,
    }));
    rows.sort(
      (a, b) => toComparableUnixMs(b.modifiedAtUnixMs ?? b.modifiedAt) -
        toComparableUnixMs(a.modifiedAtUnixMs ?? a.modifiedAt)
    );
    return rows;
  }, [loadFailures]);

  const adminForms = useMemo(() => [...sortedForms, ...loadFailureRows], [sortedForms, loadFailureRows]);

  const selectAll = (checked) => {
    if (checked) selectAllRaw(adminForms.map((form) => form.id));
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
  } = useAdminDashboardActions({
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
  });

  const goToEditor = (formId) => {
    navigate(`/forms/${formId}/edit`);
  };

  const handleCopyId = useCallback((formId, event) => {
    event.stopPropagation();
    const baseUrl = window.__GAS_WEBAPP_URL__ || window.location.origin;
    const fullUrl = buildSharedFormUrl(baseUrl, formId);
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopiedId(formId);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch((error) => {
      console.error("Failed to copy:", error);
      showAlert("URLのコピーに失敗しました");
    });
  }, [showAlert]);

  const handleCreateNew = () => {
    navigate("/forms/new");
  };

  useFormCacheSync({
    enabled: true,
    formsCount: forms.length + (loadFailures || []).length,
    lastSyncedAt,
    loadingForms,
    refreshForms,
    label: "admin-dashboard",
  });

  return (
    <AppLayout
      title="フォーム管理"
      badge="フォーム一覧"
      fallbackPath="/"
      actions={null}
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
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-13"
            onClick={handleCopySelected}
            disabled={copying || selected.size !== 1}
          >
            {copying ? "コピー中..." : "コピー"}
          </button>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-13"
            onClick={handleArchiveSelected}
            disabled={selected.size === 0}
          >
            アーカイブ
          </button>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-13"
            onClick={handleReadOnlySelected}
            disabled={selected.size === 0}
          >
            参照のみ
          </button>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-13 admin-danger-btn"
            onClick={handleDeleteSelected}
            disabled={selected.size === 0}
          >
            削除
          </button>
          <button
            type="button"
            className={`nf-btn-outline nf-btn-sidebar nf-text-13${!loadingForms ? " admin-refresh-btn" : ""}`}
            onClick={() => refreshForms({ reason: "manual:admin-dashboard", background: false })}
            disabled={loadingForms}
          >
            {loadingForms ? "🔄 更新中..." : "🔄 更新"}
          </button>
        </>
      }
    >
      {loadingForms ? (
        <p className="nf-text-subtle">読み込み中...</p>
      ) : (
        <div className="search-table-wrap">
          <table className="search-table">
            <thead>
              <tr>
                <th className="search-th">
                  <input type="checkbox" checked={adminForms.length > 0 && selected.size === adminForms.length} onChange={(event) => selectAll(event.target.checked)} />
                </th>
                <th className="search-th">名称</th>
                <th className="search-th">フォームID</th>
                <th className="search-th">更新日時</th>
                <th className="search-th">表示項目</th>
                <th className="search-th">状態</th>
              </tr>
            </thead>
            <tbody>
              {adminForms.map((form) => {
                const isLoadError = !!form.loadError;
                const summary = isLoadError ? "" : formatDisplayFieldsSummary(form);
                const loadError = form.loadError || null;
                const lastUpdated = isLoadError
                  ? formatUnixMsValue(loadError?.lastTriedAt)
                  : formatUnixMsValue(form.modifiedAtUnixMs ?? form.modifiedAt);
                return (
                  <tr
                    key={form.id}
                    className="admin-row"
                    data-clickable={isLoadError ? "false" : "true"}
                    data-error={isLoadError ? "true" : "false"}
                    onClick={() => {
                      if (!isLoadError) {
                        goToEditor(form.id);
                      }
                    }}
                  >
                    <td className="search-td" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(form.id)} onChange={() => toggleSelect(form.id)} />
                      {isLoadError && <div className="nf-text-danger-ink nf-text-11 nf-mt-4">削除のみ可能</div>}
                    </td>
                    <td className="search-td">
                      {isLoadError ? (
                        <>
                          <div className="nf-fw-600 nf-text-danger-ink">{loadError?.fileName || "(名称不明)"}</div>
                          <div className="nf-text-danger-ink-strong nf-text-12">フォームID: {form.id}</div>
                          {loadError?.fileId && <div className="nf-text-danger-ink-strong nf-text-12">ファイルID: {loadError.fileId}</div>}
                          {loadError?.driveFileUrl && (
                            <div className="nf-mt-6">
                              <a
                                href={loadError.driveFileUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(event) => event.stopPropagation()}
                                className="admin-link"
                              >
                                Driveで確認
                              </a>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="nf-fw-600">{form.settings?.formTitle || "(無題)"}</div>
                          {form.description && <div className="nf-text-muted nf-text-12 nf-pre-wrap">{form.description}</div>}
                        </>
                      )}
                    </td>
                    <td className="search-td" onClick={(e) => e.stopPropagation()}>
                      <div className="nf-row nf-gap-6">
                        <button
                          type="button"
                          className="admin-form-id admin-form-id-btn"
                          onClick={(e) => handleCopyId(form.id, e)}
                          title="クリックでURLをコピー"
                        >
                          {form.id}
                        </button>
                        <button
                          type="button"
                          className="admin-copy-btn"
                          onClick={(e) => handleCopyId(form.id, e)}
                          title="URLをコピー"
                        >
                          {copiedId === form.id ? "✓" : "📋"}
                        </button>
                      </div>
                    </td>
                    <td className="search-td">{lastUpdated}</td>
                    <td className="search-td">
                      {isLoadError ? (
                        <>
                          <div className="nf-text-danger-ink nf-fw-600">読み込みエラー</div>
                          <div className="nf-text-danger-ink-strong nf-text-12">{loadError?.errorMessage || "読み込みに失敗しました"}</div>
                          {loadError?.errorStage && <div className="nf-text-danger-ink-strong nf-text-11 nf-mt-4">ステージ: {loadError.errorStage}</div>}
                        </>
                      ) : summary ? (
                        summary
                      ) : (
                        <span className="nf-text-subtle nf-text-12">設定なし</span>
                      )}
                    </td>
                    <td className="search-td">
                      {isLoadError ? (
                        <span className="nf-text-danger-strong nf-fw-600">読み込みエラー</span>
                      ) : form.archived ? (
                        <span className="nf-text-danger-strong">アーカイブ済み</span>
                      ) : form.readOnly ? (
                        <span className="nf-text-warning nf-fw-600">参照のみ</span>
                      ) : (
                        <span className="nf-text-success">公開中</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {adminForms.length === 0 && (
                <tr>
                  <td className="search-td nf-text-center" colSpan={6}>
                    フォームが登録されていません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmArchive.open}
        title={confirmArchive.allArchived ? "アーカイブを解除" : "フォームをアーカイブ"}
        message={
          confirmArchive.allArchived
            ? "このフォームのアーカイブを解除して公開中に戻します。よろしいですか？"
            : "このフォームをアーカイブします。検索画面には表示されなくなります。よろしいですか？"
        }
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmArchive({ open: false, formId: null, targetIds: [], multiple: false, allArchived: false, hasPublished: false }),
          },
          {
            label: confirmArchive.allArchived ? "解除" : "アーカイブ",
            value: "archive",
            variant: "primary",
            onSelect: confirmArchiveAction,
          },
        ]}
      />

      <ConfirmDialog
        open={confirmReadOnly.open}
        title={confirmReadOnly.allReadOnly ? "参照のみを解除" : "フォームを参照のみに設定"}
        message={
          confirmReadOnly.allReadOnly
            ? "このフォームの参照のみ設定を解除して編集可能に戻します。よろしいですか？"
            : "このフォームを参照のみに設定します。以降、新規作成・編集・削除ができなくなります（検索・閲覧は可能）。アーカイブ中のフォームは公開中に戻した上で参照のみに設定されます。よろしいですか？"
        }
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmReadOnly({ open: false, formId: null, targetIds: [], multiple: false, allReadOnly: false }),
          },
          {
            label: confirmReadOnly.allReadOnly ? "解除" : "参照のみに設定",
            value: "readOnly",
            variant: "primary",
            onSelect: confirmReadOnlyAction,
          },
        ]}
      />

      <ConfirmDialog
        open={confirmDelete.open}
        title="フォームを削除"
        message={
          confirmDelete.multiple
            ? "選択したフォームのリンクを管理一覧から外します。フォームファイル自体は削除されません。よろしいですか？"
            : "このフォームのリンクを管理一覧から外します。フォームファイル自体は削除されません。よろしいですか？"
        }
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmDelete({ open: false, formId: null, targetIds: [], multiple: false }),
          },
          {
            label: "削除",
            value: "delete",
            variant: "danger",
            onSelect: confirmDeleteAction,
          },
        ]}
      />

      <ConfirmDialog
        open={confirmCopy.open}
        title="フォームをコピー"
        message={
          "コピーしたフォームは、コピー元と同じスプレッドシートにデータが保存されます。" +
          "そのままではデータが混在するため、コピー後にフォーム設定画面から新しいスプレッドシートのURLに変更してください。"
        }
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmCopy({ open: false, formId: null }),
          },
          {
            label: "コピー",
            value: "copy",
            variant: "primary",
            onSelect: confirmCopyAction,
          },
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

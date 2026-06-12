import React, { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import ConfirmDialog from "../../app/components/ConfirmDialog.jsx";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { useFormCacheSync } from "../../app/hooks/useFormCacheSync.js";
import { useSetSelection } from "../../app/hooks/useSetSelection.js";
import { useAlert } from "../../app/hooks/useAlert.js";
import { useBuilderSettings } from "../../features/settings/settingsStore.js";
import { toUnixMs, toComparableUnixMs, formatUnixMsValue } from "../../utils/dateTime.js";
import { buildSharedFormUrl } from "../../utils/formShareUrl.js";
import ImportUrlDialog from "./AdminImportUrlDialog.jsx";
import { AdminListSidebarActions, AdminListFolderDialogs } from "./AdminListShared.jsx";
import { useAdminFormListActions } from "./useAdminFormListActions.js";
import { useFolderBrowser } from "../../features/folders/useFolderBrowser.js";
import FolderSearchBar from "../../features/folders/FolderSearchBar.jsx";
import FolderBreadcrumbs from "../../features/folders/FolderBreadcrumbs.jsx";
import FolderRow from "../../features/folders/FolderRow.jsx";

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

export default function AdminFormListPage() {
  const { forms, loadFailures, loadingForms, lastSyncedAt, registeredFolders, createFolder, moveItems, renameFolder, deleteFolder, archiveForms, unarchiveForms, setFormsReadOnly, clearFormsReadOnly, setFormsChildOnly, clearFormsChildOnly, deleteForms, deleteFormsWithFiles, refreshForms, exportForms, copyForm, registerImportedForm, updateForm } = useAppData();
  useBuilderSettings();
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const { selected, toggle: toggleSelect, selectAll: selectAllRaw, clear: clearSelection, clearByIds: clearSelectionByIds } = useSetSelection();
  const { selected: selectedFolders, toggle: toggleFolder, clear: clearFolderSelection } = useSetSelection();
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

  const browser = useFolderBrowser(adminForms, {
    getFolder: (form) => form.folder,
    getName: (form) => form.settings?.formTitle || "",
    folderPaths: registeredFolders,
    urlParam: "folder",
  });

  // 編集/新規へ遷移するとき、戻り先として現在のフォルダ付き一覧 URL を渡す。
  // 保存・戻る時に editor 側がこの from へ復帰し、直前のフォルダが復元される。
  const listUrlWithFolder = () =>
    `/admin/forms${browser.currentPath ? `?folder=${encodeURIComponent(browser.currentPath)}` : ""}`;
  const visibleForms = browser.visibleItems;
  const allVisibleSelected = visibleForms.length > 0 && visibleForms.every((form) => selected.has(form.id));

  // フォルダ移動で選択が画面外に残らないよう、ナビゲーション時に選択をクリアする。
  const navigateFolder = useCallback((path) => {
    clearSelection();
    clearFolderSelection();
    browser.goTo(path);
  }, [browser, clearSelection, clearFolderSelection]);

  const selectAll = (checked) => {
    if (checked) selectAllRaw(visibleForms.map((form) => form.id));
    else clearSelection();
  };

  // フォーム自体の名前変更。settings を丸ごと置換する updateForm の仕様に合わせ、
  // 既存 settings をマージして formTitle だけ差し替える。一意採番は保存時に委ねる。
  const renameForm = useCallback(async (formId, newName) => {
    const form = sortedForms.find((f) => f.id === formId) || {};
    await updateForm(formId, { settings: { ...(form.settings || {}), formTitle: newName } });
  }, [sortedForms, updateForm]);

  const actions = useAdminFormListActions({
    sortedForms,
    selected,
    clearSelection,
    clearSelectionByIds,
    showAlert,
    archiveForms,
    unarchiveForms,
    setFormsReadOnly,
    clearFormsReadOnly,
    setFormsChildOnly,
    clearFormsChildOnly,
    deleteForms,
    deleteFormsWithFiles,
    exportForms,
    copyForm,
    registerImportedForm,
    allItems: adminForms,
    registeredFolders,
    selectedFolders,
    clearFolderSelection,
    currentPath: browser.currentPath,
    createFolder,
    moveItems,
    renameFolder,
    renameForm,
    deleteFolder,
  });
  const {
    confirmArchive,
    setConfirmArchive,
    confirmReadOnly,
    setConfirmReadOnly,
    confirmChildOnly,
    setConfirmChildOnly,
    confirmDelete,
    setConfirmDelete,
    confirmHardDelete,
    setConfirmHardDelete,
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
    handleChildOnlySelected,
    handleDeleteSelected,
    handleHardDeleteSelected,
    handleExport,
    handleImport,
    handleImportFromDrive,
    confirmArchiveAction,
    confirmReadOnlyAction,
    confirmChildOnlyAction,
    confirmDeleteAction,
    confirmHardDeleteAction,
    handleCopySelected,
    confirmCopyAction,
    handleCreateFolder,
    handleMoveSelected,
    handleRenameSelected,
  } = actions;

  const goToEditor = (formId) => {
    navigate(`/admin/forms/${formId}/edit`, { state: { from: listUrlWithFolder() } });
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
    navigate("/admin/forms/new", { state: { folder: browser.currentPath, from: listUrlWithFolder() } });
  };

  useFormCacheSync({
    enabled: true,
    formsCount: forms.length + (loadFailures || []).length,
    lastSyncedAt,
    loadingForms,
    refreshForms,
    label: "admin-form-list",
  });

  return (
    <AppLayout
      title="フォーム管理"
      badge="管理"
      fallbackPath="/admin"
      actions={null}
      sidebarActions={
        <AdminListSidebarActions
          createLabel="+ 新規フォーム"
          onCreateNew={handleCreateNew}
          onCreateFolder={handleCreateFolder}
          onImport={handleImport}
          importing={importing}
          onMove={handleMoveSelected}
          onRename={handleRenameSelected}
          onCopy={handleCopySelected}
          copying={copying}
          onArchive={handleArchiveSelected}
          afterArchiveSlot={
            <>
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
                className="nf-btn-outline nf-btn-sidebar nf-text-13"
                onClick={handleChildOnlySelected}
                disabled={selected.size === 0}
              >
                子フォーム専用
              </button>
            </>
          }
          onExport={handleExport}
          exporting={exporting}
          onDelete={handleDeleteSelected}
          onHardDelete={handleHardDeleteSelected}
          onRefresh={() => refreshForms({ reason: "manual:admin-form-list", background: false })}
          refreshing={loadingForms}
          selectedCount={selected.size}
          selectedFolderCount={selectedFolders.size}
        />
      }
    >
      {loadingForms ? (
        <p className="nf-text-subtle">読み込み中...</p>
      ) : (
        <>
        <FolderSearchBar value={browser.query} onChange={browser.setQuery} placeholder="フォーム名で検索（例: 売上。正規表現も可）" />
        <FolderBreadcrumbs breadcrumbs={browser.breadcrumbs} onNavigate={navigateFolder} hidden={browser.searching} />
        <div className="search-table-wrap">
          <table className="search-table">
            <thead>
              <tr>
                <th className="search-th">
                  <input type="checkbox" checked={allVisibleSelected} onChange={(event) => selectAll(event.target.checked)} />
                </th>
                <th className="search-th">名称</th>
                <th className="search-th">フォームID</th>
                <th className="search-th">更新日時</th>
                <th className="search-th">表示項目</th>
                <th className="search-th">状態</th>
              </tr>
            </thead>
            <tbody>
              {browser.folders.map((f) => (
                <FolderRow
                  key={f.path}
                  name={f.name}
                  count={f.count}
                  colSpan={6}
                  selectable
                  selected={selectedFolders.has(f.path)}
                  onToggle={() => toggleFolder(f.path)}
                  onOpen={() => navigateFolder(f.path)}
                />
              ))}
              {visibleForms.map((form) => {
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
                      ) : form.childOnly ? (
                        <span className="nf-text-warning nf-fw-600">子フォーム専用</span>
                      ) : form.readOnly ? (
                        <span className="nf-text-warning nf-fw-600">参照のみ</span>
                      ) : (
                        <span className="nf-text-success">公開中</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {browser.folders.length === 0 && visibleForms.length === 0 && (
                <tr>
                  <td className="search-td nf-text-center" colSpan={6}>
                    {browser.searching ? "一致するフォームがありません。" : "フォームが登録されていません。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
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
        open={confirmChildOnly.open}
        title={confirmChildOnly.allChildOnly ? "子フォーム専用を解除" : "フォームを子フォーム専用に設定"}
        message={
          confirmChildOnly.allChildOnly
            ? "このフォームの子フォーム専用設定を解除して公開中に戻します。よろしいですか？"
            : "このフォームを子フォーム専用に設定します。選択画面（一覧）には表示されなくなり、他フォームの子フォームとしてのみ開けるようになります。アーカイブ・参照のみのフォームは公開中に戻した上で子フォーム専用に設定されます。よろしいですか？"
        }
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmChildOnly({ open: false, formId: null, targetIds: [], multiple: false, allChildOnly: false }),
          },
          {
            label: confirmChildOnly.allChildOnly ? "解除" : "子フォーム専用に設定",
            value: "childOnly",
            variant: "primary",
            onSelect: confirmChildOnlyAction,
          },
        ]}
      />

      <ConfirmDialog
        open={confirmDelete.open}
        title={confirmDelete.folderPaths?.length ? "フォルダをリンク解除" : "フォームをリンク解除"}
        message={
          confirmDelete.folderPaths?.length
            ? `選択したフォルダのリンクを解除します。中の ${confirmDelete.folderFormCount} 個のフォームのリンクも併せて解除します。Drive 上のファイル本体は削除されません。よろしいですか？`
            : confirmDelete.multiple
              ? "選択したフォームのリンク（登録）を解除します。Drive 上のファイル本体は削除されません。よろしいですか？"
              : "このフォームのリンク（登録）を解除します。Drive 上のファイル本体は削除されません。よろしいですか？"
        }
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmDelete({ open: false, formId: null, targetIds: [], folderPaths: [], multiple: false, folderFormCount: 0 }),
          },
          {
            label: "リンク解除",
            value: "delete",
            variant: "danger",
            onSelect: confirmDeleteAction,
          },
        ]}
      />

      <ConfirmDialog
        open={confirmHardDelete.open}
        title={confirmHardDelete.multiple ? "フォームを削除" : "フォームを削除"}
        message={
          (confirmHardDelete.multiple
            ? "選択したフォームを削除します。"
            : "このフォームを削除します。") +
          "プロジェクト内（標準フォルダ配下）のファイルは Drive のゴミ箱へ移動します。" +
          "プロジェクト外のファイルはリンク（登録）解除のみで実体は残します。よろしいですか？"
        }
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmHardDelete({ open: false, formId: null, targetIds: [], multiple: false }),
          },
          {
            label: "削除",
            value: "delete",
            variant: "danger",
            onSelect: confirmHardDeleteAction,
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

      <AdminListFolderDialogs
        actions={actions}
        currentPath={browser.currentPath}
        folders={registeredFolders}
        renameItemTexts={{
          title: "フォーム名を変更",
          message: (currentName) => currentName
            ? `フォーム「${currentName}」の名前を変更します。`
            : "フォームの名前を変更します。",
          label: "新しいフォーム名",
          placeholder: "例: 入会申込フォーム",
        }}
      />
    </AppLayout>
  );
}

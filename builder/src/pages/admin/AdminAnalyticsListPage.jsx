import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import ConfirmDialog from "../../app/components/ConfirmDialog.jsx";
import { useAlert } from "../../app/hooks/useAlert.js";
import { useSetSelection } from "../../app/hooks/useSetSelection.js";
import { toComparableUnixMs, formatUnixMsValue } from "../../utils/dateTime.js";
import ImportUrlDialog from "./AdminImportUrlDialog.jsx";
import AdminNewFolderDialog from "./AdminNewFolderDialog.jsx";
import AdminMoveDialog from "./AdminMoveDialog.jsx";
import AdminRenameFolderDialog from "./AdminRenameFolderDialog.jsx";
import { useAdminAnalyticsListActions } from "./useAdminAnalyticsListActions.js";
import { useFolderBrowser } from "../../features/folders/useFolderBrowser.js";
import { buildAppUrl } from "../../utils/appUrl.js";
import FolderSearchBar from "../../features/folders/FolderSearchBar.jsx";
import FolderBreadcrumbs from "../../features/folders/FolderBreadcrumbs.jsx";
import FolderRow from "../../features/folders/FolderRow.jsx";

/**
 * Question / Dashboard 共通の管理リストページ。
 *
 * @param {object} props
 * @param {"questions"|"dashboards"} props.kind
 * @param {string} props.itemLabel "Question" / "Dashboard"
 * @param {string} props.title ページタイトル
 * @param {string} props.fallbackPath 戻り先パス
 * @param {string} props.newItemPath 新規作成パス
 * @param {(id: string) => string} props.buildEditPath 行クリック時の遷移先
 * @param {object} props.store ストア関数群 { list, archive, unarchive, copy, remove, exportItems, importFromDrive, registerImported, listFolders, createFolder, moveItems, deleteFolder }
 * @param {{header: string, render: (item: object) => React.ReactNode}} props.extraColumn ID 列の右隣に表示する種別列
 * @param {(item: object) => React.ReactNode} [props.renderNameCell] 名称セルの描画。未指定なら名前のみ
 * @param {(item: object, ctx: {copiedId: string|null, onCopy: (id: string, e: Event) => void}) => React.ReactNode} [props.renderIdCell] ID セルの描画。未指定なら ID 文字列のみ
 * @param {boolean} [props.enableUrlCopy] true で ID セルクリック→URL コピー機能を有効化
 * @param {string} [props.copyUrlPathPrefix] URL コピー時の SPA パスプレフィックス（例 "/dashboards/"）。buildAppUrl で GAS は ?route= 形式に変換される
 */
export default function AdminAnalyticsListPage({
  kind,
  itemLabel,
  title,
  fallbackPath,
  newItemPath,
  buildEditPath,
  store,
  extraColumn,
  renderNameCell,
  renderIdCell,
  enableUrlCopy = false,
  copyUrlPathPrefix = "",
}) {
  const navigate = useNavigate();
  const { showAlert } = useAlert();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [copiedId, setCopiedId] = useState(null);
  const [registeredFolders, setRegisteredFolders] = useState([]);

  const {
    selected,
    toggle: toggleSelect,
    selectAll: selectAllRaw,
    clear: clearSelection,
    clearByIds: clearSelectionByIds,
  } = useSetSelection();
  const { selected: selectedFolders, toggle: toggleFolder, clear: clearFolderSelection } = useSetSelection();

  const reload = useCallback(({ forceRefresh = false } = {}) => {
    setLoading(true);
    setError(null);
    const listPromise = store.list({ forceRefresh, includeArchived: true })
      .then(setItems)
      .catch((err) => setError(err.message || String(err)));
    // フォルダ一覧も並行して取得（store に listFolders がある場合のみ）
    const foldersPromise = store.listFolders
      ? store.listFolders().then(setRegisteredFolders).catch(() => {})
      : Promise.resolve();
    Promise.all([listPromise, foldersPromise]).finally(() => setLoading(false));
  }, [store]);

  useEffect(() => {
    reload({ forceRefresh: reloadCounter > 0 });
  }, [reloadCounter, reload]);

  const filteredItems = useMemo(() => {
    return showArchived ? items : items.filter((item) => !item.archived);
  }, [items, showArchived]);

  const sortedItems = useMemo(() => {
    const list = filteredItems.slice();
    list.sort(
      (a, b) => toComparableUnixMs(b.modifiedAt) - toComparableUnixMs(a.modifiedAt)
    );
    return list;
  }, [filteredItems]);

  const browser = useFolderBrowser(sortedItems, {
    getFolder: (item) => item.folder,
    getName: (item) => item.name || "",
    folderPaths: registeredFolders,
  });
  const visibleItems = browser.visibleItems;
  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((item) => selected.has(item.id));

  // フォルダ移動で選択が画面外に残らないよう、ナビゲーション時に選択をクリアする。
  const navigateFolder = useCallback((path) => {
    clearSelection();
    clearFolderSelection();
    browser.goTo(path);
  }, [browser, clearSelection, clearFolderSelection]);

  const selectAll = (checked) => {
    if (checked) selectAllRaw(visibleItems.map((item) => item.id));
    else clearSelection();
  };

  const refresh = useCallback(async () => {
    setReloadCounter((n) => n + 1);
  }, []);

  const archive = useCallback(async (ids) => {
    await store.archive(ids);
    await refresh();
  }, [store, refresh]);

  const unarchive = useCallback(async (ids) => {
    await store.unarchive(ids);
    await refresh();
  }, [store, refresh]);

  const copy = useCallback(async (id) => {
    await store.copy(id);
    await refresh();
  }, [store, refresh]);

  const remove = useCallback(async (ids) => {
    await store.remove(ids);
    await refresh();
  }, [store, refresh]);

  const registerImported = useCallback(async (item) => {
    await store.registerImported(item);
  }, [store]);

  // フォルダ操作ラッパ（結果の folders で registeredFolders を更新し、move/delete 後は items も再取得）
  const createFolderWrapper = useCallback(async (path) => {
    if (!store.createFolder) return;
    const folders = await store.createFolder(path);
    setRegisteredFolders(folders);
  }, [store]);

  const moveItemsWrapper = useCallback(async (payload) => {
    if (!store.moveItems) return;
    const result = await store.moveItems(payload);
    setRegisteredFolders(result.folders);
    await refresh();
  }, [store, refresh]);

  const renameFolderWrapper = useCallback(async (payload) => {
    if (!store.renameFolder) return;
    const result = await store.renameFolder(payload);
    setRegisteredFolders(result.folders);
    await refresh();
  }, [store, refresh]);

  const deleteFolderWrapper = useCallback(async (path) => {
    if (!store.deleteFolder) return;
    const result = await store.deleteFolder(path);
    setRegisteredFolders(result.folders);
    await refresh();
  }, [store, refresh]);

  const {
    confirmArchive, setConfirmArchive,
    confirmDelete, setConfirmDelete,
    confirmCopy, setConfirmCopy,
    importDialogOpen, setImportDialogOpen,
    importUrl, setImportUrl,
    importing, exporting, copying,
    handleArchiveSelected,
    handleDeleteSelected,
    handleCopySelected,
    handleExport,
    handleImport,
    handleImportFromDrive,
    confirmArchiveAction,
    confirmDeleteAction,
    confirmCopyAction,
    newFolderDialogState,
    newFolderName,
    setNewFolderName,
    newFolderError,
    setNewFolderError,
    handleCreateFolder,
    confirmCreateFolder,
    closeNewFolderDialog,
    moveDialogState,
    moveDest,
    setMoveDest,
    moveError,
    setMoveError,
    handleMoveSelected,
    confirmMove,
    closeMoveDialog,
    renameDialogState,
    renameName,
    setRenameName,
    renameError,
    setRenameError,
    handleRenameSelectedFolder,
    confirmRenameFolder,
    closeRenameDialog,
  } = useAdminAnalyticsListActions({
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
    exportItems: store.exportItems,
    importFromDrive: store.importFromDrive,
    registerImported,
    allItems: sortedItems,
    registeredFolders,
    selectedFolders,
    clearFolderSelection,
    currentPath: browser.currentPath,
    createFolder: createFolderWrapper,
    moveItems: moveItemsWrapper,
    renameFolder: renameFolderWrapper,
    deleteFolder: deleteFolderWrapper,
  });

  const handleImportFromDriveAndReload = useCallback(async () => {
    await handleImportFromDrive();
    await refresh();
  }, [handleImportFromDrive, refresh]);

  const handleCopyUrl = useCallback((itemId, event) => {
    event.stopPropagation();
    // GAS は二重 iframe 構造で外側 URL のハッシュが内側 React に伝播しないため、
    // 直接 baseUrl + "#/dashboards/id" を作ると閲覧ページに飛べない。
    // buildAppUrl 経由で ?route= 形式に変換し、doGet → __INITIAL_HASH__ で内側へ届ける。
    const fullUrl = buildAppUrl(`${copyUrlPathPrefix}${itemId}`);
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopiedId(itemId);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {
      showAlert("URLのコピーに失敗しました");
    });
  }, [copyUrlPathPrefix, showAlert]);

  const defaultRenderIdCell = (item) => <span className="admin-form-id">{item.id}</span>;
  const urlCopyRenderIdCell = (item) => (
    <div className="nf-row nf-gap-6">
      <button
        type="button"
        className="admin-form-id admin-form-id-btn"
        onClick={(e) => handleCopyUrl(item.id, e)}
        title="クリックで閲覧URLをコピー"
      >
        {item.id}
      </button>
      <button
        type="button"
        className="admin-copy-btn"
        onClick={(e) => handleCopyUrl(item.id, e)}
        title="閲覧URLをコピー"
      >
        {copiedId === item.id ? "✓" : "📋"}
      </button>
    </div>
  );
  const idCellRenderer = renderIdCell || (enableUrlCopy ? urlCopyRenderIdCell : defaultRenderIdCell);
  const nameCellRenderer = renderNameCell || ((item) => <div className="nf-fw-600">{item.name || "(無題)"}</div>);
  const idCellNeedsStopProp = enableUrlCopy || Boolean(renderIdCell);

  return (
    <AppLayout
      title={title}
      badge="管理"
      fallbackPath={fallbackPath}
      sidebarActions={
        <>
          <div className="sidebar-section-label">作成</div>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-13"
            onClick={() => navigate(newItemPath, { state: { folder: browser.currentPath } })}
          >
            + 新規作成
          </button>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-13"
            onClick={handleCreateFolder}
          >
            + 新規フォルダ
          </button>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-13"
            onClick={handleImport}
          >
            {importing ? "インポート中..." : "↓ インポート"}
          </button>

          <div className="nf-spacer-16" />
          <div className="sidebar-section-label">選択中アクション</div>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-13"
            onClick={handleMoveSelected}
            disabled={selected.size === 0 && selectedFolders.size === 0}
          >
            移動
          </button>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-13"
            onClick={handleRenameSelectedFolder}
            disabled={selected.size !== 0 || selectedFolders.size !== 1}
          >
            名前変更
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
            onClick={handleExport}
            disabled={exporting || selected.size === 0}
          >
            {exporting ? "エクスポート中..." : "エクスポート"}
          </button>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-13 admin-danger-btn"
            onClick={handleDeleteSelected}
            disabled={selected.size === 0 && selectedFolders.size === 0}
          >
            削除
          </button>

          <div className="nf-spacer-16" />
          <label className="nf-text-13" style={{ display: "flex", gap: "6px", alignItems: "center", padding: "0 8px" }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            アーカイブ済みも表示
          </label>

          <div className="nf-spacer-16" />
          <button
            type="button"
            className={`nf-btn-outline nf-btn-sidebar nf-text-13${!loading ? " admin-refresh-btn" : ""}`}
            onClick={refresh}
            disabled={loading}
          >
            {loading ? "🔄 更新中..." : "🔄 更新"}
          </button>
        </>
      }
    >
      {error && <p className="nf-text-warning">{error}</p>}
      {loading ? (
        <p className="nf-text-subtle">読み込み中...</p>
      ) : (
        <>
        <FolderSearchBar value={browser.query} onChange={browser.setQuery} placeholder={`${itemLabel} 名で検索（例: 売上。正規表現も可）`} />
        <FolderBreadcrumbs breadcrumbs={browser.breadcrumbs} onNavigate={navigateFolder} hidden={browser.searching} />
        <div className="search-table-wrap">
          <table className="search-table">
            <thead>
              <tr>
                <th className="search-th">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(event) => selectAll(event.target.checked)}
                  />
                </th>
                <th className="search-th">名称</th>
                <th className="search-th">ID</th>
                <th className="search-th">更新日時</th>
                <th className="search-th">{extraColumn.header}</th>
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
              {visibleItems.map((item) => (
                <tr
                  key={item.id}
                  className="admin-row"
                  data-clickable="true"
                  onClick={() => navigate(buildEditPath(item.id))}
                >
                  <td className="search-td" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                    />
                  </td>
                  <td className="search-td">{nameCellRenderer(item)}</td>
                  <td className="search-td" {...(idCellNeedsStopProp ? { onClick: (e) => e.stopPropagation() } : {})}>
                    {idCellRenderer(item)}
                  </td>
                  <td className="search-td">{formatUnixMsValue(item.modifiedAt)}</td>
                  <td className="search-td">{extraColumn.render(item)}</td>
                  <td className="search-td">
                    {item.archived ? (
                      <span className="nf-text-danger-strong">アーカイブ済み</span>
                    ) : (
                      <span className="nf-text-success">公開中</span>
                    )}
                  </td>
                </tr>
              ))}
              {browser.folders.length === 0 && visibleItems.length === 0 && (
                <tr>
                  <td className="search-td nf-text-center" colSpan={6}>
                    {browser.searching ? `一致する ${itemLabel} がありません。` : `${itemLabel} が登録されていません。`}
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
        title={confirmArchive.allArchived ? "アーカイブを解除" : `${itemLabel} をアーカイブ`}
        message={
          confirmArchive.allArchived
            ? `選択した ${itemLabel} のアーカイブを解除して公開中に戻します。よろしいですか？`
            : `選択した ${itemLabel} をアーカイブします。一覧に表示されなくなります。よろしいですか？`
        }
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmArchive({ open: false, id: null, targetIds: [], multiple: false, allArchived: false }),
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
        open={confirmDelete.open}
        title={confirmDelete.folderPaths?.length ? "フォルダを削除" : `${itemLabel} を削除`}
        message={
          confirmDelete.folderPaths?.length
            ? `選択したフォルダを削除します。中の ${confirmDelete.folderItemCount} 個の ${itemLabel} も併せて削除されますがよろしいですか？（Drive上のファイル自体はDriveに残ります）`
            : confirmDelete.multiple
              ? `選択した ${itemLabel} のリンクを管理一覧から外します。Drive 上の JSON ファイル自体は削除されません。よろしいですか？`
              : `この ${itemLabel} のリンクを管理一覧から外します。Drive 上の JSON ファイル自体は削除されません。よろしいですか？`
        }
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmDelete({ open: false, id: null, targetIds: [], folderPaths: [], multiple: false, folderItemCount: 0 }),
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
        title={`${itemLabel} をコピー`}
        message={`同じフォルダに「（コピー）」を付けて新しい ${itemLabel} を作成します。コピー後に名前を変更してください。`}
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmCopy({ open: false, id: null }),
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
        onImport={handleImportFromDriveAndReload}
        onCancel={() => setImportDialogOpen(false)}
        title={`Google Drive から ${itemLabel} をインポート`}
        description="ファイル URL またはフォルダ URL を入力してください。"
        itemLabel={itemLabel}
      />

      <AdminNewFolderDialog
        open={newFolderDialogState.open}
        parentPath={browser.currentPath}
        value={newFolderName}
        onChange={(v) => { setNewFolderName(v); if (newFolderError) setNewFolderError(""); }}
        onConfirm={confirmCreateFolder}
        onCancel={closeNewFolderDialog}
        error={newFolderError}
      />

      <AdminMoveDialog
        open={moveDialogState.open}
        count={moveDialogState.count}
        value={moveDest}
        onChange={(v) => { setMoveDest(v); if (moveError) setMoveError(""); }}
        onConfirm={confirmMove}
        onCancel={closeMoveDialog}
        error={moveError}
      />

      <AdminRenameFolderDialog
        open={renameDialogState.open}
        currentName={renameDialogState.currentName}
        value={renameName}
        onChange={(v) => { setRenameName(v); if (renameError) setRenameError(""); }}
        onConfirm={confirmRenameFolder}
        onCancel={closeRenameDialog}
        error={renameError}
      />
    </AppLayout>
  );
}

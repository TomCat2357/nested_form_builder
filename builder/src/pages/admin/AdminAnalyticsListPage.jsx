import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import ConfirmDialog from "../../app/components/ConfirmDialog.jsx";
import { useAlert } from "../../app/hooks/useAlert.js";
import { useSetSelection } from "../../app/hooks/useSetSelection.js";
import { sortByModifiedDesc, formatUnixMsValue } from "../../utils/dateTime.js";
import ImportUrlDialog from "./AdminImportUrlDialog.jsx";
import { AdminListSidebarActions, AdminListFolderDialogs } from "./AdminListShared.jsx";
import { useAdminAnalyticsListActions } from "./useAdminAnalyticsListActions.js";
import { useAnalyticsList } from "../../features/analytics/useAnalyticsList.js";
import { subscribeAnalyticsFolders } from "../../features/analytics/analyticsCache.js";
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

  const [showArchived, setShowArchived] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [registeredFolders, setRegisteredFolders] = useState([]);

  // 一覧本体は SWR フックで管理（キャッシュ即表示＋鮮度に応じた裏更新）。
  const { items, loading, refreshing, error, refresh } = useAnalyticsList({
    listSWR: store.listSWR,
    includeArchived: true,
  });

  const {
    selected,
    toggle: toggleSelect,
    selectAll: selectAllRaw,
    clear: clearSelection,
    clearByIds: clearSelectionByIds,
  } = useSetSelection();
  const { selected: selectedFolders, toggle: toggleFolder, clear: clearFolderSelection } = useSetSelection();

  // フォルダ一覧は一覧本体と独立に取得する（一覧表示をフォルダ取得完了で待たせない）。
  useEffect(() => {
    if (!store.listFolders) return;
    store.listFolders().then(setRegisteredFolders).catch(() => {});
  }, [store]);

  // op ジョブ（move / rename / deleteFolder）成功後、ワーカーがサーバ確定 folders を通知してくる。
  // kind は複数形（"questions"）、op ジョブの entityType は単数形（"question"）なので合わせる。
  const entityType = kind.endsWith("s") ? kind.slice(0, -1) : kind;
  useEffect(
    () => subscribeAnalyticsFolders((et, folders) => {
      if (et === entityType && Array.isArray(folders)) setRegisteredFolders(folders);
    }),
    [entityType],
  );

  const filteredItems = useMemo(() => {
    return showArchived ? items : items.filter((item) => !item.archived);
  }, [items, showArchived]);

  // Question / Dashboard は modifiedAtUnixMs を持たないため modifiedAt のみで比較する。
  const sortedItems = useMemo(
    () => sortByModifiedDesc(filteredItems, (item) => item.modifiedAt),
    [filteredItems],
  );

  const browser = useFolderBrowser(sortedItems, {
    getFolder: (item) => item.folder,
    getName: (item) => item.name || "",
    folderPaths: registeredFolders,
    urlParam: "folder",
  });
  const visibleItems = browser.visibleItems;

  // 一覧ページ自身のパス（"/admin/questions" など）は newItemPath から導出する。
  // 編集/新規へ遷移時、戻り先として現在のフォルダ付き URL を from に渡す。
  const listBasePath = newItemPath.replace(/\/new$/, "");
  const listUrlWithFolder = () =>
    `${listBasePath}${browser.currentPath ? `?folder=${encodeURIComponent(browser.currentPath)}` : ""}`;
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

  // 楽観的＋遅延: store がキャッシュを即時更新し emitAnalyticsCacheChanged で一覧へ反映する。
  // ここで refresh（forceRefresh）すると未同期のサーバ取得が楽観的変更を巻き戻すため呼ばない。
  const archive = useCallback(async (ids) => {
    await store.archive(ids);
  }, [store]);

  const unarchive = useCallback(async (ids) => {
    await store.unarchive(ids);
  }, [store]);

  const copy = useCallback(async (id) => {
    await store.copy(id);
  }, [store]);

  const remove = useCallback(async (ids) => {
    await store.remove(ids);
    await refresh();
  }, [store, refresh]);

  const removeWithFiles = useCallback(async (ids) => {
    await store.removeWithFiles(ids);
    await refresh();
  }, [store, refresh]);

  const registerImported = useCallback(async (item) => {
    await store.registerImported(item);
  }, [store]);

  // フォルダ操作ラッパ（結果の folders で registeredFolders を更新し、move/delete 後は items も再取得）
  const createFolderWrapper = useCallback(async (path) => {
    if (!store.createFolder) return;
    const folders = await store.createFolder(path, { folders: registeredFolders });
    setRegisteredFolders(folders);
  }, [store, registeredFolders]);

  // 楽観的＋遅延: store 側がエンティティ folder をキャッシュ即時更新（一覧は
  // emitAnalyticsCacheChanged で再読込）し、GAS は write-behind の op ジョブへ。
  // 返り値の folders 登録簿を即時反映する（サーバ往復を待たない）。
  const moveItemsWrapper = useCallback(async (payload) => {
    if (!store.moveItems) return;
    const result = await store.moveItems(payload, { folders: registeredFolders });
    setRegisteredFolders(result.folders);
  }, [store, registeredFolders]);

  const renameFolderWrapper = useCallback(async (payload) => {
    if (!store.renameFolder) return;
    const result = await store.renameFolder(payload, { folders: registeredFolders });
    setRegisteredFolders(result.folders);
  }, [store, registeredFolders]);

  const deleteFolderWrapper = useCallback(async (path) => {
    if (!store.deleteFolder) return;
    const result = await store.deleteFolder(path, { folders: registeredFolders });
    setRegisteredFolders(result.folders);
  }, [store, registeredFolders]);

  // アイテム自体の名前変更。完全オブジェクトを読み込み name だけ差し替えて再保存する
  // （Question/Dashboard には rename 専用 API がないため）。一意採番は保存時に委ねる。
  const renameItemWrapper = useCallback(async (id, newName) => {
    if (!store.save) return;
    const current = items.find((it) => it.id === id);
    if (!current) throw new Error("対象が見つかりません");
    await store.save({ ...current, name: newName });
    await refresh();
  }, [store, items, refresh]);

  const actions = useAdminAnalyticsListActions({
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
    renameItem: renameItemWrapper,
    deleteFolder: deleteFolderWrapper,
  });
  const {
    confirmArchive, setConfirmArchive,
    confirmDelete, setConfirmDelete,
    confirmHardDelete, setConfirmHardDelete,
    confirmCopy, setConfirmCopy,
    importDialogOpen, setImportDialogOpen,
    importUrl, setImportUrl,
    importing, exporting, copying,
    handleArchiveSelected,
    handleDeleteSelected,
    handleHardDeleteSelected,
    handleCopySelected,
    handleExport,
    handleImport,
    handleImportFromDrive,
    confirmArchiveAction,
    confirmDeleteAction,
    confirmHardDeleteAction,
    confirmCopyAction,
    handleCreateFolder,
    handleMoveSelected,
    handleRenameSelected,
  } = actions;

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
        <AdminListSidebarActions
          createLabel="+ 新規作成"
          onCreateNew={() => navigate(newItemPath, { state: { folder: browser.currentPath, from: listUrlWithFolder() } })}
          onCreateFolder={handleCreateFolder}
          onImport={handleImport}
          importing={importing}
          onMove={handleMoveSelected}
          onRename={handleRenameSelected}
          onCopy={handleCopySelected}
          copying={copying}
          onArchive={handleArchiveSelected}
          onExport={handleExport}
          exporting={exporting}
          onDelete={handleDeleteSelected}
          onHardDelete={handleHardDeleteSelected}
          beforeRefreshSlot={
            <>
              <div className="nf-spacer-16" />
              <label className="nf-text-13" style={{ display: "flex", gap: "6px", alignItems: "center", padding: "0 8px" }}>
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
                アーカイブ済みも表示
              </label>
            </>
          }
          onRefresh={refresh}
          refreshing={loading || refreshing}
          selectedCount={selected.size}
          selectedFolderCount={selectedFolders.size}
        />
      }
    >
      {error && <p className="nf-text-warning">{error}</p>}
      {loading ? (
        <p className="nf-text-subtle">読み込み中...</p>
      ) : (
        <>
        {refreshing && <p className="nf-text-subtle nf-text-12 nf-m-0">更新中...</p>}
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
                  onClick={() => navigate(buildEditPath(item.id), { state: { from: listUrlWithFolder() } })}
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
        title={confirmDelete.folderPaths?.length ? "フォルダをリンク解除" : `${itemLabel} をリンク解除`}
        message={
          confirmDelete.folderPaths?.length
            ? `選択したフォルダのリンクを解除します。中の ${confirmDelete.folderItemCount} 個の ${itemLabel} のリンクも併せて解除します。Drive 上のファイル本体は削除されません。よろしいですか？`
            : confirmDelete.multiple
              ? `選択した ${itemLabel} のリンク（登録）を解除します。Drive 上のファイル本体は削除されません。よろしいですか？`
              : `この ${itemLabel} のリンク（登録）を解除します。Drive 上のファイル本体は削除されません。よろしいですか？`
        }
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmDelete({ open: false, id: null, targetIds: [], folderPaths: [], multiple: false, folderItemCount: 0 }),
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
        title={`${itemLabel} を削除`}
        message={
          (confirmHardDelete.multiple
            ? `選択した ${itemLabel} を削除します。`
            : `この ${itemLabel} を削除します。`) +
          "プロジェクト内（標準フォルダ配下）のファイルは Drive のゴミ箱へ移動します。" +
          "プロジェクト外のファイルはリンク（登録）解除のみで実体は残します。よろしいですか？"
        }
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmHardDelete({ open: false, id: null, targetIds: [], multiple: false }),
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

      <AdminListFolderDialogs
        actions={actions}
        currentPath={browser.currentPath}
        folders={registeredFolders}
        renameItemTexts={{
          title: `${itemLabel} 名を変更`,
          message: (currentName) => currentName
            ? `${itemLabel}「${currentName}」の名前を変更します。`
            : `${itemLabel} の名前を変更します。`,
          label: "新しい名前",
          placeholder: "例: 月次集計",
        }}
      />
    </AppLayout>
  );
}

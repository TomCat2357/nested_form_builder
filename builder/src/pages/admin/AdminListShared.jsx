import React from "react";
import AdminFolderNameDialog from "./AdminFolderNameDialog.jsx";
import AdminMoveDialog from "./AdminMoveDialog.jsx";

const SIDEBAR_BTN = "nf-btn-outline nf-btn-sidebar nf-text-13";

/**
 * フォーム / Question / Dashboard 管理一覧で共通のサイドバーアクション群。
 * ページ固有の要素はスロットで差し込む:
 *   afterArchiveSlot  … アーカイブの直後（Forms の「参照のみ」「子フォーム専用」）
 *   beforeRefreshSlot … 更新ボタンの直前（Analytics の「アーカイブ済みも表示」）
 */
export function AdminListSidebarActions({
  createLabel,
  onCreateNew,
  onCreateFolder,
  onImport,
  importing,
  onMove,
  onRename,
  onCopy,
  copying,
  onArchive,
  afterArchiveSlot = null,
  onExport,
  exporting,
  onDelete,
  onHardDelete,
  beforeRefreshSlot = null,
  onRefresh,
  refreshing,
  selectedCount,
  selectedFolderCount,
}) {
  const nothingSelected = selectedCount === 0 && selectedFolderCount === 0;
  const exactlyOneSelected =
    (selectedFolderCount === 1 && selectedCount === 0) || (selectedCount === 1 && selectedFolderCount === 0);
  return (
    <>
      <div className="sidebar-section-label">作成</div>
      <button type="button" className={SIDEBAR_BTN} onClick={onCreateNew}>
        {createLabel}
      </button>
      <button type="button" className={SIDEBAR_BTN} onClick={onCreateFolder}>
        + 新規フォルダ
      </button>
      <button type="button" className={SIDEBAR_BTN} onClick={onImport}>
        {importing ? "↑ インポート中..." : "↑ インポート"}
      </button>

      <div className="nf-spacer-16" />
      <div className="sidebar-section-label">選択中アクション</div>
      <button type="button" className={SIDEBAR_BTN} onClick={onMove} disabled={nothingSelected}>
        移動
      </button>
      <button type="button" className={SIDEBAR_BTN} onClick={onRename} disabled={!exactlyOneSelected}>
        名前変更
      </button>
      <button type="button" className={SIDEBAR_BTN} onClick={onCopy} disabled={copying || selectedCount !== 1}>
        {copying ? "コピー中..." : "コピー"}
      </button>
      <button type="button" className={SIDEBAR_BTN} onClick={onArchive} disabled={selectedCount === 0}>
        アーカイブ
      </button>
      {afterArchiveSlot}
      <button type="button" className={SIDEBAR_BTN} onClick={onExport} disabled={exporting || selectedCount === 0}>
        {exporting ? "↓ エクスポート中..." : "↓ エクスポート"}
      </button>
      <button
        type="button"
        className={`${SIDEBAR_BTN} admin-danger-btn`}
        onClick={onDelete}
        disabled={nothingSelected}
      >
        リンク解除
      </button>
      <button
        type="button"
        className={`${SIDEBAR_BTN} admin-danger-btn`}
        onClick={onHardDelete}
        disabled={selectedCount === 0}
      >
        削除
      </button>

      {beforeRefreshSlot}
      <div className="nf-spacer-16" />
      <button
        type="button"
        className={`${SIDEBAR_BTN}${!refreshing ? " admin-refresh-btn" : ""}`}
        onClick={onRefresh}
        disabled={refreshing}
      >
        {refreshing ? "🔄 更新中..." : "🔄 更新"}
      </button>
    </>
  );
}

/**
 * 新規フォルダ / 移動 / 名前変更ダイアログの共通 3 点セット。
 * actions は useAdminFormListActions / useAdminAnalyticsListActions の戻り値
 * （newFolderDialogState〜closeRenameDialog を含む）をそのまま渡す。
 * renameItemTexts はアイテム名変更時（renameDialogState.kind === "item"）の文言差分:
 *   { title, message: (currentName) => string, label, placeholder }
 */
export function AdminListFolderDialogs({ actions, currentPath, folders, renameItemTexts }) {
  const {
    newFolderDialogState,
    newFolderName,
    setNewFolderName,
    newFolderError,
    setNewFolderError,
    confirmCreateFolder,
    closeNewFolderDialog,
    moveDialogState,
    moveDest,
    setMoveDest,
    moveError,
    setMoveError,
    confirmMove,
    closeMoveDialog,
    renameDialogState,
    renameName,
    setRenameName,
    renameError,
    setRenameError,
    confirmRename,
    closeRenameDialog,
  } = actions;

  return (
    <>
      <AdminFolderNameDialog
        open={newFolderDialogState.open}
        value={newFolderName}
        onChange={(v) => { setNewFolderName(v); if (newFolderError) setNewFolderError(""); }}
        onConfirm={confirmCreateFolder}
        onCancel={closeNewFolderDialog}
        error={newFolderError}
        title="新規フォルダ"
        confirmLabel="作成"
        label="フォルダ名"
        placeholder="例: 苦情・通報"
        message={currentPath
          ? `「${currentPath}」の中に新しいフォルダを作成します。`
          : "最上位に新しいフォルダを作成します。"}
        note="スラッシュ区切りで複数階層も作成できます（例: 苦情・通報/クマ）。"
      />

      <AdminMoveDialog
        open={moveDialogState.open}
        count={moveDialogState.count}
        value={moveDest}
        onChange={(v) => { setMoveDest(v); if (moveError) setMoveError(""); }}
        onConfirm={confirmMove}
        onCancel={closeMoveDialog}
        error={moveError}
        folders={folders}
        excludePaths={moveDialogState.folderPaths}
      />

      <AdminFolderNameDialog
        open={renameDialogState.open}
        currentName={renameDialogState.currentName}
        value={renameName}
        onChange={(v) => { setRenameName(v); if (renameError) setRenameError(""); }}
        onConfirm={confirmRename}
        onCancel={closeRenameDialog}
        error={renameError}
        {...(renameDialogState.kind === "item"
          ? {
              title: renameItemTexts.title,
              message: renameItemTexts.message(renameDialogState.currentName),
              label: renameItemTexts.label,
              placeholder: renameItemTexts.placeholder,
              note: "",
            }
          : {})}
      />
    </>
  );
}

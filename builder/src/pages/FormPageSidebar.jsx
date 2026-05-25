/**
 * FormPage の sidebarActions 全体。
 *
 * - 編集 / 戻る (View モード)
 * - 保存 / キャンセル (Edit モード)
 * - 印刷様式出力
 * - 削除 / 削除取消し
 * - 既存レコードからコピー
 * - 前へ / 次へ ナビゲーション
 * - SchemaMapNav
 *
 * 業務ロジックを持たない純粋な JSX 塊。すべて props で動作する。
 */

import React from "react";
import SchemaMapNav from "../features/nav/SchemaMapNav.jsx";

export default function FormPageSidebar({
  isViewMode,
  isDirectRecordMode,
  isFormReadOnly,
  isReadLocked,
  isSaving,
  isAdmin,
  isCreatingPrintDocument,
  isCopySourceLoading,
  loading,
  editDisabled,
  entry,
  entryId,
  entryIds,
  currentIndex,
  hasPrev,
  hasNext,
  canCopyFromExistingRecord,
  copySourceId,
  primarySaveOptions,
  normalizedSchema,
  responses,
  // handlers
  handleEditMode,
  navigateBack,
  triggerSave,
  attemptLeave,
  handleCreatePrintDocument,
  handleUndeleteEntry,
  handleDeleteEntry,
  handleFetchCopySource,
  navigateToEntry,
  setCopySourceId,
}) {
  return (
    <>
      {isViewMode ? (
        <>
          {!isDirectRecordMode && (
            <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={() => navigateBack()}>
              ← 戻る
            </button>
          )}
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={handleEditMode} disabled={editDisabled}>
            編集
          </button>
        </>
      ) : (
        <>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={() => attemptLeave("cancel-edit")}>
            キャンセル
          </button>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" disabled={isSaving || isReadLocked || isFormReadOnly} onClick={() => triggerSave(primarySaveOptions)}>
            保存
          </button>
        </>
      )}
      <button
        type="button"
        className="nf-btn-outline nf-btn-sidebar nf-text-14"
        disabled={loading || isCreatingPrintDocument}
        onClick={() => {
          void handleCreatePrintDocument();
        }}
      >
        {isCreatingPrintDocument ? "出力中..." : "印刷様式を出力"}
      </button>
      {entryId && (
        <>
          <hr className="nf-sidebar-divider" />
          {isAdmin && entry?.deletedAt ? (
            <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={handleUndeleteEntry}>
              削除取消し
            </button>
          ) : (
            <button type="button" className="nf-btn-outline nf-btn-sidebar nf-btn-danger nf-text-14" onClick={handleDeleteEntry} disabled={isFormReadOnly}>
              削除
            </button>
          )}
        </>
      )}
      {canCopyFromExistingRecord && (
        <>
          <hr className="nf-sidebar-divider" />
          <div className="record-copy-sidebar">
            <div className="record-copy-sidebar__title">既存レコードからコピー</div>
            <div className="record-copy-sidebar__controls">
              <input
                type="text"
                className="nf-input nf-text-13 record-copy-sidebar__input"
                value={copySourceId}
                onChange={(event) => setCopySourceId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleFetchCopySource();
                  }
                }}
                placeholder="レコードID"
              />
              <button
                type="button"
                className="nf-btn-outline nf-text-13 record-copy-sidebar__fetch"
                disabled={isCopySourceLoading || isSaving || isReadLocked}
                onClick={() => {
                  void handleFetchCopySource();
                }}
              >
                {isCopySourceLoading ? "取得中..." : "取得"}
              </button>
            </div>
          </div>
        </>
      )}
      {entryIds.length > 0 && (
        <>
          <hr className="nf-sidebar-divider" />
          <div className="nf-flex nf-gap-8 nf-items-center">
            <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" disabled={!hasPrev} onClick={() => navigateToEntry(entryIds[currentIndex - 1])}>
              ← 前へ
            </button>
            <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" disabled={!hasNext} onClick={() => navigateToEntry(entryIds[currentIndex + 1])}>
              次へ →
            </button>
          </div>
          <span className="nf-text-11 nf-text-muted">{currentIndex + 1} / {entryIds.length}</span>
        </>
      )}
      <SchemaMapNav schema={normalizedSchema} responses={responses} scope="visible" />
    </>
  );
}

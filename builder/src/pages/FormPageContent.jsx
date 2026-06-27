/**
 * FormPage の本体（AppLayout の children 部分）。
 *
 * 同期ステータスを示す SearchToolbar と、読み込み中表示 / PreviewPage を内包する
 * プレゼンテーショナルな塊。業務ロジックは持たず、すべて props で動作する。
 */

import React, { forwardRef } from "react";
import PreviewPage from "../features/preview/PreviewPage.jsx";
import SearchToolbar from "../features/search/components/SearchToolbar.jsx";

const FormPageContent = forwardRef(function FormPageContent(
  {
    lastSyncedAt,
    useCache,
    cacheDisabled,
    listBackgroundLoading,
    waitingForLock,
    hasUnsynced,
    unsyncedCount,
    listLoading,
    loading,
    normalizedSchema,
    responses,
    handleResponsesChange,
    isAdmin,
    previewSettings,
    setRecordNoInput,
    handleSaveToStore,
    isViewMode,
    isReadLocked,
    isFormReadOnly,
    currentRecordId,
    driveFolderStates,
    updateFieldDriveFolderState,
    canDeleteDriveFolder,
    onDeleteDriveFolder,
  },
  previewRef,
) {
  return (
    <>
      <SearchToolbar
        showSearch={false}
        lastSyncedAt={lastSyncedAt}
        useCache={useCache}
        cacheDisabled={cacheDisabled}
        backgroundLoading={listBackgroundLoading}
        lockWaiting={waitingForLock}
        hasUnsynced={hasUnsynced}
        unsyncedCount={unsyncedCount}
        syncInProgress={listLoading || listBackgroundLoading || waitingForLock}
      />
      {loading ? (
        <p className="nf-text-subtle">読み込み中...</p>
      ) : (
        <PreviewPage
          ref={previewRef}
          schema={normalizedSchema}
          responses={responses}
          setResponses={handleResponsesChange}
          isAdmin={isAdmin}
          settings={previewSettings}
          onRecordNoChange={setRecordNoInput}
          onSave={handleSaveToStore}
          showOutputJson={false}
          showSaveButton={false}
          readOnly={isViewMode || isReadLocked || isFormReadOnly}
          entryId={currentRecordId}
          driveFolderStates={driveFolderStates}
          onFieldDriveFolderStateChange={updateFieldDriveFolderState}
          canDeleteDriveFolder={!isViewMode && canDeleteDriveFolder}
          onDeleteDriveFolder={onDeleteDriveFolder}
        />
      )}
    </>
  );
});

export default FormPageContent;

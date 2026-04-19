import React from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useAuth } from "../app/state/authContext.jsx";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { useAlert } from "../app/hooks/useAlert.js";
import SearchToolbar from "../features/search/components/SearchToolbar.jsx";
import SearchSidebar from "../features/search/components/SearchSidebar.jsx";
import SearchTable from "../features/search/components/SearchTable.jsx";
import SearchPagination from "../features/search/components/SearchPagination.jsx";
import SearchDisplaySettingsDialog from "../features/search/components/SearchDisplaySettingsDialog.jsx";
import { useSearchPageState } from "../features/search/useSearchPageState.js";

export default function SearchPage() {
  const { getFormById } = useAppData();
  const { settings } = useBuilderSettings({ applyGlobalTheme: false });
  const { isAdmin, userEmail, formId: scopedFormId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { showAlert, showOutputAlert } = useAlert();

  const {
    effectiveFormId,
    isScopedByAuth,
    form,
    showDeleteConfirm,
    setShowDeleteConfirm,
    showUndeleteConfirm,
    setShowUndeleteConfirm,
    selectedEntries,
    exporting,
    isCreatingPrintDocument,
    showDeleted,
    setShowDeleted,
    showDisplaySettings,
    setShowDisplaySettings,
    query,
    page,
    activeSort,
    searchOverrides,
    updateOverride,
    TABLE_MAX_WIDTH,
    cellDisplayLimit,
    entries,
    columns,
    headerRows,
    loading,
    backgroundLoading,
    waitingForLock,
    useCache,
    lastSyncedAt,
    hasUnsynced,
    unsyncedCount,
    cacheDisabled,
    forceRefreshAll,
    sortedEntries,
    pagedEntries,
    totalPages,
    totalEntries,
    startIndex,
    endIndex,
    badge,
    allSelectedAreDeleted,
    handleSearchChange,
    handleSortToggle,
    handlePageChange,
    handleRowClick,
    handleCreateNew,
    handleOpenFormConfig,
    handleBackToMain,
    toggleSelectEntry,
    selectAllEntries,
    handleDeleteSelected,
    handleUndeleteSelected,
    handleExportResults,
    handleCellAction,
    handleCreatePrintDocument,
    confirmDelete,
    confirmUndelete,
  } = useSearchPageState({
    searchParams,
    setSearchParams,
    location,
    navigate,
    showAlert,
    showOutputAlert,
    isAdmin,
    userEmail,
    scopedFormId,
    getFormById,
    settings,
  });

  if (!effectiveFormId || !form) {
    return (
      <AppLayout themeOverride={form?.settings?.theme} title="検索" fallbackPath="/" backHidden={false}>
        <p className="search-empty">
          {isAdmin
            ? "フォームが選択されていません。メイン画面からフォームを選択してください。"
            : "フォームが見つかりません。正しいURLでアクセスしているか確認してください。"}
        </p>
      </AppLayout>
    );
  }

  return (
    <AppLayout themeOverride={form?.settings?.theme}       title={`検索 - ${form.settings?.formTitle || "(無題)"}`}
      fallbackPath="/"
      backHidden
      badge={badge}
      sidebarActions={(
        <>
          <SearchSidebar
          onBack={handleBackToMain}
          showBack={!isScopedByAuth}
          onCreate={handleCreateNew}
          onConfig={handleOpenFormConfig}
          onDelete={handleDeleteSelected}
          onUndelete={handleUndeleteSelected}
          isUndoDelete={isAdmin && allSelectedAreDeleted}
          onPrint={handleCreatePrintDocument}
          onRefresh={forceRefreshAll}
          onExport={handleExportResults}
          useCache={useCache}
          refreshBusy={loading || backgroundLoading || waitingForLock}
          refreshDisabled={waitingForLock}
          exporting={exporting}
          printing={isCreatingPrintDocument}
          selectedCount={selectedEntries.size}
          filteredCount={sortedEntries.length}
          readOnly={!!form?.readOnly}
        />
        </>
      )}
    >
      <SearchToolbar
        query={query}
        onChange={handleSearchChange}
        lastSyncedAt={lastSyncedAt}
        useCache={useCache}
        cacheDisabled={cacheDisabled}
        backgroundLoading={backgroundLoading}
        lockWaiting={waitingForLock}
        hasUnsynced={hasUnsynced}
        unsyncedCount={unsyncedCount}
        syncInProgress={loading || backgroundLoading || waitingForLock}
        onSettingsClick={() => setShowDisplaySettings(true)}
      />
      {isAdmin && (
        <div className="nf-row nf-gap-16 nf-items-center nf-mb-12 nf-wrap">
          <label className="nf-row nf-gap-6 nf-items-center">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
            <span className="nf-text-13">削除済みデータを表示する</span>
          </label>
        </div>
      )}

      {(waitingForLock || loading) && entries.length === 0 ? (
        <p className="search-loading">{waitingForLock ? "ロック解除待ち..." : "読み込み中..."}</p>
      ) : (
        <SearchTable
          columns={columns}
          headerRows={headerRows}
          pagedEntries={pagedEntries}
          selectedEntries={selectedEntries}
          activeSort={activeSort}
          cellDisplayLimit={cellDisplayLimit}
          tableMaxWidth={TABLE_MAX_WIDTH}
          onSortToggle={handleSortToggle}
          onSelectAll={selectAllEntries}
          onToggleSelect={toggleSelectEntry}
          onRowClick={handleRowClick}
          onCellAction={handleCellAction}
        />
      )}

      <SearchPagination
        page={page}
        totalPages={totalPages}
        totalEntries={totalEntries}
        startIndex={startIndex}
        endIndex={endIndex}
        onChange={handlePageChange}
      />

      <SearchDisplaySettingsDialog
        open={showDisplaySettings}
        onClose={() => setShowDisplaySettings(false)}
        overrides={searchOverrides}
        onUpdateOverride={updateOverride}
        formSettings={form?.settings}
        globalSettings={settings}
      />
      <ConfirmDialog
        open={showDeleteConfirm.open}
        title="レコードを削除"
        message={`選択した${showDeleteConfirm.entryIds.length}件の回答を削除します。よろしいですか？`}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: () => setShowDeleteConfirm({ open: false, entryIds: [] }) },
          { label: "削除", value: "delete", variant: "danger", onSelect: confirmDelete },
        ]}
      />
      <ConfirmDialog
        open={showUndeleteConfirm.open}
        title="削除取消し"
        message={`選択した${showUndeleteConfirm.entryIds.length}件の削除済みデータを復活させます。よろしいですか？`}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: () => setShowUndeleteConfirm({ open: false, entryIds: [] }) },
          { label: "削除取消し", value: "undelete", variant: "primary", onSelect: confirmUndelete },
        ]}
      />

</AppLayout>
  );
}

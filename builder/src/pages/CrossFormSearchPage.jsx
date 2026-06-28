import React from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { useAlert } from "../app/hooks/useAlert.js";
import SearchToolbar from "../features/search/components/SearchToolbar.jsx";
import SearchTable from "../features/search/components/SearchTable.jsx";
import SearchPagination from "../features/search/components/SearchPagination.jsx";
import { useCrossFormSearchState } from "../features/analytics/crossSearch/useCrossFormSearchState.js";

export default function CrossFormSearchPage() {
  const { getFormById, forms } = useAppData();
  const { settings } = useBuilderSettings({ applyGlobalTheme: false });
  const manualSearch = settings?.searchDebounceMs === "" || settings?.searchDebounceMs == null;
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { showAlert, showOutputAlert } = useAlert();

  const {
    cfs,
    cfsError,
    loading,
    query,
    activeSort,
    displayColumns,
    headerRows,
    pagedEntries,
    selectedEntries,
    filterError,
    totalPages,
    page,
    totalEntries,
    startIndex,
    endIndex,
    badge,
    isCreatingPrintDocument,
    handleSearchChange,
    handleSortToggle,
    handlePageChange,
    handleRowClick,
    handleBack,
    handleRefresh,
    selectedCount,
    toggleSelectEntry,
    selectAllEntries,
    handleCellAction,
    handleCreatePrintDocument,
  } = useCrossFormSearchState({
    searchParams,
    setSearchParams,
    location,
    navigate,
    showAlert,
    showOutputAlert,
    getFormById,
    forms,
    settings,
  });

  if (cfsError) {
    return (
      <AppLayout title="串刺し検索" fallbackPath="/" backHidden={false}>
        <p className="search-empty">{cfsError}</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title={`串刺し検索 - ${cfs?.name || "(無題)"}`}
      fallbackPath="/"
      backHidden
      badge={badge}
      sidebarActions={(
        <>
          <button type="button" className="search-input search-sidebar-btn" onClick={handleBack}>← 戻る</button>
          <button
            type="button"
            className="search-input search-sidebar-btn"
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading ? "🔄 更新中..." : "🔄 更新"}
          </button>
          <button
            type="button"
            className="search-input search-sidebar-btn"
            onClick={handleCreatePrintDocument}
            disabled={isCreatingPrintDocument}
            title={selectedCount === 0 ? "出力するレコードを選択してください" : `選択中の${selectedCount}件を印刷様式として出力`}
          >
            {isCreatingPrintDocument ? "出力中..." : "印刷様式を出力"}
          </button>
        </>
      )}
    >
      <SearchToolbar
        query={query}
        onChange={handleSearchChange}
        backgroundLoading={loading}
        syncInProgress={loading}
        filterError={filterError}
        debounceMs={manualSearch ? 0 : (Number(settings?.searchDebounceMs) || 0)}
        manualSearch={manualSearch}
      />

      {loading && pagedEntries.length === 0 ? (
        <p className="search-loading">読み込み中...</p>
      ) : (
        <SearchTable
          columns={displayColumns}
          headerRows={headerRows}
          pagedEntries={pagedEntries}
          selectedEntries={selectedEntries}
          activeSort={activeSort}
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
    </AppLayout>
  );
}

import React, { useMemo, useState, useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import AlertDialog from "../app/components/AlertDialog.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { dataStore } from "../app/state/dataStore.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { useAlert } from "../app/hooks/useAlert.js";
import {
  buildSearchColumns,
  buildHeaderRows,
  buildHeaderRowsFromCsv,
  buildColumnsFromHeaderMatrix,
  computeRowValues,
  compareByColumn,
  matchesKeyword,
  parseSearchCellDisplayLimit,
} from "../features/search/searchTable.js";
import { useEntriesWithCache } from "../features/search/useEntriesWithCache.js";
import SearchToolbar from "../features/search/components/SearchToolbar.jsx";
import SearchSidebar from "../features/search/components/SearchSidebar.jsx";
import SearchTable from "../features/search/components/SearchTable.jsx";
import SearchPagination from "../features/search/components/SearchPagination.jsx";

const buildInitialSort = (params) => {
  const raw = params.get("sort");
  if (!raw) return { key: "No.", order: "desc" };
  const lastColonIndex = raw.lastIndexOf(":");
  if (lastColonIndex === -1) return { key: raw, order: "desc" };
  const key = raw.slice(0, lastColonIndex);
  const order = raw.slice(lastColonIndex + 1);
  return { key: key || "No.", order: order === "asc" ? "asc" : "desc" };
};

export default function SearchPage() {
  const { getFormById } = useAppData();
  const { settings } = useBuilderSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { alertState, showAlert, closeAlert } = useAlert();
  const formId = searchParams.get("formId");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState({ open: false, entryIds: [] });
  const [selectedEntries, setSelectedEntries] = useState(new Set());

  const form = useMemo(() => (formId ? getFormById(formId) : null), [formId, getFormById]);
  const activeSort = useMemo(() => buildInitialSort(searchParams), [searchParams]);
  const query = searchParams.get("q") || "";
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const PAGE_SIZE = Number(settings?.pageSize) || 20;
  const TABLE_MAX_WIDTH = settings?.searchTableMaxWidth ? Number(settings.searchTableMaxWidth) : null;
  const cellDisplayLimit = parseSearchCellDisplayLimit(form?.settings?.searchCellMaxChars);

  const {
    entries,
    headerMatrix,
    loading,
    backgroundLoading,
    useCache,
    lastSyncedAt,
    cacheDisabled,
    fetchAndCacheData,
  } = useEntriesWithCache({
    formId,
    form,
    locationKey: location.key,
    locationState: location.state,
    showAlert,
  });

  const columns = useMemo(() => {
    const baseColumns = buildSearchColumns(form, { includeOperations: false });
    if (headerMatrix && headerMatrix.length > 0) {
      return buildColumnsFromHeaderMatrix(headerMatrix, baseColumns);
    }
    return baseColumns;
  }, [form, headerMatrix]);

  const headerRows = useMemo(() => {
    if (headerMatrix && headerMatrix.length > 0) {
      const rows = buildHeaderRowsFromCsv(headerMatrix, columns);
      if (rows && rows.length > 0) return rows;
    }
    return buildHeaderRows(columns);
  }, [columns, headerMatrix]);

  const handleSearchChange = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("q", value);
    else next.delete("q");
    next.set("page", "1");
    setSearchParams(next);
  };

  const handleSortToggle = (key) => {
    const next = new URLSearchParams(searchParams);
    const current = buildInitialSort(next);
    const order = current.key === key ? (current.order === "desc" ? "asc" : "desc") : "desc";
    next.set("sort", `${key}:${order}`);
    setSearchParams(next);
  };

  const handlePageChange = (nextPage) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(nextPage));
    setSearchParams(next);
  };

  const processedEntries = useMemo(() => entries.map((entry) => ({ entry, values: computeRowValues(entry, columns) })), [entries, columns]);

  const filteredEntries = useMemo(() => {
    const keyword = query.trim();
    if (!keyword) return processedEntries;
    return processedEntries.filter((row) => matchesKeyword(row, columns, keyword));
  }, [processedEntries, columns, query]);

  const sortedEntries = useMemo(() => {
    const list = filteredEntries.slice();
    const targetColumn = columns.find((column) => column.key === activeSort.key && column.sortable !== false);
    if (targetColumn) {
      list.sort((a, b) => compareByColumn(a, b, targetColumn, activeSort.order));
    }
    return list;
  }, [filteredEntries, columns, activeSort]);

  const pagedEntries = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedEntries.slice(start, start + PAGE_SIZE);
  }, [sortedEntries, page, PAGE_SIZE]);

  const totalPages = Math.max(1, Math.ceil(sortedEntries.length / PAGE_SIZE));
  const totalEntries = sortedEntries.length;
  const startIndex = totalEntries === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endIndex = totalEntries === 0 ? 0 : Math.min(page * PAGE_SIZE, totalEntries);

  const handleRowClick = (entryId) => {
    if (!formId) return;
    navigate(`/form/${formId}/entry/${entryId}`, {
      state: { from: `${location.pathname}${location.search}` },
    });
  };

  const handleCreateNew = () => {
    if (!formId) return;
    navigate(`/form/${formId}/new`, {
      state: { from: `${location.pathname}${location.search}` },
    });
  };

  const toggleSelectEntry = (entryId) => {
    setSelectedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const selectAllEntries = (checked) => {
    if (checked) setSelectedEntries(new Set(pagedEntries.map((item) => item.entry.id)));
    else setSelectedEntries(new Set());
  };

  const handleDeleteSelected = () => {
    if (selectedEntries.size === 0) {
      showAlert("削除する項目を選択してください。");
      return;
    }
    setShowDeleteConfirm({ open: true, entryIds: Array.from(selectedEntries) });
  };

  const confirmDelete = useCallback(async () => {
    if (!formId || showDeleteConfirm.entryIds.length === 0) return;
    for (const entryId of showDeleteConfirm.entryIds) {
      await dataStore.deleteEntry(formId, entryId);
    }
    await fetchAndCacheData();
    setSelectedEntries(new Set());
    setShowDeleteConfirm({ open: false, entryIds: [] });
  }, [formId, showDeleteConfirm.entryIds, fetchAndCacheData]);

  if (!formId || !form) {
    return (
      <AppLayout title="検索" fallbackPath="/">
        <p className="search-empty">フォームが選択されていません。メイン画面からフォームを選択してください。</p>
      </AppLayout>
    );
  }

  const badge = useMemo(() => {
    if (loading || backgroundLoading) return { label: "読み取り中...", variant: "loading" };
    return { label: "検索画面", variant: "view" };
  }, [loading, backgroundLoading]);

  return (
    <AppLayout
      title={`検索 - ${form.settings?.formTitle || "(無題)"}`}
      fallbackPath="/"
      badge={badge}
      sidebarActions={(
        <SearchSidebar
          onCreate={handleCreateNew}
          onDelete={handleDeleteSelected}
          onRefresh={fetchAndCacheData}
          useCache={useCache}
          loading={loading}
          selectedCount={selectedEntries.size}
        />
      )}
    >
      <SearchToolbar
        query={query}
        onChange={handleSearchChange}
        lastSyncedAt={lastSyncedAt}
        useCache={useCache}
        cacheDisabled={cacheDisabled}
      />

      {loading ? (
        <p className="search-loading">読み込み中...</p>
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

      <ConfirmDialog
        open={showDeleteConfirm.open}
        title="レコードを削除"
        message={`選択した${showDeleteConfirm.entryIds.length}件の回答を削除します。よろしいですか？`}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: () => setShowDeleteConfirm({ open: false, entryIds: [] }) },
          { label: "削除", value: "delete", variant: "danger", onSelect: confirmDelete },
        ]}
      />

      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </AppLayout>
  );
}

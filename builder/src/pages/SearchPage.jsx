import React, { useMemo, useState, useCallback, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useAuth } from "../app/state/authContext.jsx";
import { dataStore } from "../app/state/dataStore.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { useAlert } from "../app/hooks/useAlert.js";
import {
  buildSearchTableLayout,
  buildExportTableData,
  computeRowValues,
  compareByColumn,
  matchesKeyword,
  parseSearchCellDisplayLimit,
} from "../features/search/searchTable.js";
// exportSearchResults from gasClient is removed in favor of frontend Excel generation
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { createExcelBlob, getThemeColors } from "../utils/excelExport.js";
import { useEntriesWithCache } from "../features/search/useEntriesWithCache.js";
import { saveExcelToDrive } from "../services/gasClient.js";
import SearchToolbar from "../features/search/components/SearchToolbar.jsx";
import SearchSidebar from "../features/search/components/SearchSidebar.jsx";
import SearchTable from "../features/search/components/SearchTable.jsx";
import SearchPagination from "../features/search/components/SearchPagination.jsx";
import { DEFAULT_THEME, applyThemeWithFallback } from "../app/theme/theme.js";
import { DEFAULT_PAGE_SIZE } from "../core/constants.js";



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
  const { isAdmin, userEmail, formId: scopedFormId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const queryFormId = (searchParams.get("form") || "").trim();
  const effectiveFormId = queryFormId || scopedFormId;
  const isScopedByAuth = scopedFormId !== "";
  const [showDeleteConfirm, setShowDeleteConfirm] = useState({ open: false, entryIds: [] });
  const [selectedEntries, setSelectedEntries] = useState(new Set());
  const [exporting, setExporting] = useState(false);

  const form = useMemo(() => (effectiveFormId ? getFormById(effectiveFormId) : null), [effectiveFormId, getFormById]);
  const activeSort = useMemo(() => buildInitialSort(searchParams), [searchParams]);
  const query = searchParams.get("q") || "";
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const PAGE_SIZE = Number(form?.settings?.pageSize) || Number(settings?.pageSize) || DEFAULT_PAGE_SIZE;
  const TABLE_MAX_WIDTH = Number(form?.settings?.searchTableMaxWidth) || Number(settings?.searchTableMaxWidth) || null;
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
    forceRefreshAll,
  } = useEntriesWithCache({
    formId: effectiveFormId,
    form,
    locationKey: location.key,
    locationState: location.state,
    showAlert,
  });

  const { columns, headerRows } = useMemo(
    () => buildSearchTableLayout(form, { headerMatrix, includeOperations: false }),
    [form, headerMatrix],
  );

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

  useEffect(() => {
    if (!form) return;
    const theme = form?.settings?.theme || DEFAULT_THEME;
    void applyThemeWithFallback(theme, { persist: false });
  }, [form?.id, form?.settings?.theme, settings?.theme]);

  const processedEntries = useMemo(() => entries.map((entry) => ({ entry, values: computeRowValues(entry, columns) })), [entries, columns]);

  const ownerFilteredEntries = useMemo(() => {
    if (isAdmin) return processedEntries;
    if (!form?.settings?.showOwnRecordsOnly) return processedEntries;
    if (!userEmail) return processedEntries;
    return processedEntries.filter((row) => (row.entry?.createdBy || row.entry?.modifiedBy) === userEmail);
  }, [processedEntries, isAdmin, userEmail, form?.settings?.showOwnRecordsOnly]);

  const filteredEntries = useMemo(() => {
    const keyword = query.trim();
    if (!keyword) return ownerFilteredEntries;
    return ownerFilteredEntries.filter((row) => matchesKeyword(row, columns, keyword));
  }, [ownerFilteredEntries, columns, query]);

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

  const badge = useMemo(() => {
    if (loading || backgroundLoading) return { label: "読み取り中...", variant: "loading" };
    return { label: "検索画面", variant: "view" };
  }, [loading, backgroundLoading]);

  const handleRowClick = (entryId) => {
    if (!effectiveFormId) return;
    const entryIds = sortedEntries.map((row) => row.entry.id);
    navigate(`/form/${effectiveFormId}/entry/${entryId}`, {
      state: { from: `${location.pathname}${location.search}`, entryIds },
    });
  };

  const handleCreateNew = () => {
    if (!effectiveFormId) return;
    navigate(`/form/${effectiveFormId}/new`, {
      state: { from: `${location.pathname}${location.search}` },
    });
  };

  const handleOpenFormConfig = () => {
    if (!effectiveFormId) return;
    navigate(`/config?form=${encodeURIComponent(effectiveFormId)}`, {
      state: { from: `${location.pathname}${location.search}` },
    });
  };

  const handleBackToMain = () => {
    navigate("/");
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

  const handleExportResults = useCallback(async () => {
    if (sortedEntries.length === 0) return;
    setExporting(true);
    try {
      const exportingEntries = sortedEntries.map((row) => row.entry);
      const exportTable = buildExportTableData({ form, entries: exportingEntries });

      const blob = await createExcelBlob(exportTable, themeColors);
      const base64data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const result = await saveExcelToDrive({ filename, base64: base64data });

      showAlert(
        <div className="nf-col nf-gap-8">
          <div>マイドライブにエクセルファイルを保存しました。</div>
          <a href={result.fileUrl} target="_blank" rel="noopener noreferrer" className="nf-link nf-fw-600">
            ファイルを開く
          </a>
        </div>,
        "出力完了"
      );
    } catch (err) {
      console.error(err);
      showAlert(`出力に失敗しました: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }, [form, sortedEntries, showAlert]);

  const confirmDelete = useCallback(async () => {
    if (!effectiveFormId || showDeleteConfirm.entryIds.length === 0) return;
    for (const entryId of showDeleteConfirm.entryIds) {
      await dataStore.deleteEntry(effectiveFormId, entryId);
    }
    await fetchAndCacheData();
    setSelectedEntries(new Set());
    setShowDeleteConfirm({ open: false, entryIds: [] });
  }, [effectiveFormId, showDeleteConfirm.entryIds, fetchAndCacheData]);

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
        <SearchSidebar
          onBack={handleBackToMain}
          showBack={!isScopedByAuth}
          onCreate={handleCreateNew}
          onConfig={settings?.syncAllFormsTheme ? undefined : handleOpenFormConfig}
          onDelete={handleDeleteSelected}
          onRefresh={forceRefreshAll}
          onExport={handleExportResults}
          useCache={useCache}
          loading={loading || backgroundLoading}
          exporting={exporting}
          selectedCount={selectedEntries.size}
          filteredCount={sortedEntries.length}
        />
      )}
    >
      <SearchToolbar
        query={query}
        onChange={handleSearchChange}
        lastSyncedAt={lastSyncedAt}
        useCache={useCache}
        cacheDisabled={cacheDisabled}
        backgroundLoading={backgroundLoading}
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

</AppLayout>
  );
}

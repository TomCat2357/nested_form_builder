import { useBeforeUnloadGuard } from "../app/hooks/useBeforeUnloadGuard.js";
import { useConfirmDialog } from "../app/hooks/useConfirmDialog.js";
import { useSetSelection } from "../app/hooks/useSetSelection.js";
import { useMemo, useState, useCallback, useEffect } from "react";
import { dataStore } from "../app/state/dataStore.js";
import { normalizeSchemaIDs } from "../core/schema.js";
import {
  buildSearchTableLayout,
  buildExportTableData,
  computeRowValues,
  compareByColumn,
  getKeywordMatchDetail,
  parseSearchCellDisplayLimit,
} from "../features/search/searchTable.js";
import {
  buildFieldLabelsMap,
  resolveOmitEmptyRowsOnPrint,
} from "../features/preview/printDocument.js";
import { createExcelBlob, getThemeColors } from "../utils/excelExport.js";
import { useEntriesWithCache } from "../features/search/useEntriesWithCache.js";
import { saveExcelToDrive } from "../services/gasClient.js";
import { useSearchDisplayOverrides } from "../features/search/useSearchDisplayOverrides.js";
import { DEFAULT_THEME, applyThemeWithFallback } from "../app/theme/theme.js";
import { DEFAULT_PAGE_SIZE } from "../core/constants.js";
import { useSearchPagePrintActions } from "./useSearchPagePrintActions.js";

export const buildInitialSort = (params) => {
  const raw = params.get("sort");
  if (!raw) return { key: "No.", order: "desc" };
  const lastColonIndex = raw.lastIndexOf(":");
  if (lastColonIndex === -1) return { key: raw, order: "desc" };
  const key = raw.slice(0, lastColonIndex);
  const order = raw.slice(lastColonIndex + 1);
  return { key: key || "No.", order: order === "asc" ? "asc" : "desc" };
};

export function useSearchPageState({
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
}) {
  const queryFormId = (searchParams.get("form") || "").trim();
  const effectiveFormId = queryFormId || scopedFormId;
  const isScopedByAuth = scopedFormId !== "";
  const currentSearchUrl = `${location.pathname}${location.search}`;

  const deleteDialog = useConfirmDialog({ entryIds: [] });
  const undeleteDialog = useConfirmDialog({ entryIds: [] });
  const { selected: selectedEntries, toggle: toggleSelectEntry, selectAll: selectAllEntriesRaw, clear: clearSelectedEntries } = useSetSelection();
  const [exporting, setExporting] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [showDisplaySettings, setShowDisplaySettings] = useState(false);

  const form = useMemo(() => (effectiveFormId ? getFormById(effectiveFormId) : null), [effectiveFormId, getFormById]);
  const normalizedSchema = useMemo(() => normalizeSchemaIDs(form?.schema || []), [form?.schema]);
  const omitEmptyRowsOnPrint = resolveOmitEmptyRowsOnPrint(form?.settings);
  const fieldLabels = useMemo(() => buildFieldLabelsMap(normalizedSchema), [normalizedSchema]);
  const activeSort = useMemo(() => buildInitialSort(searchParams), [searchParams]);
  const query = searchParams.get("q") || "";
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const { overrides: searchOverrides, updateOverride } = useSearchDisplayOverrides(effectiveFormId);
  const PAGE_SIZE = Number(searchOverrides?.pageSize) || Number(form?.settings?.pageSize) || Number(settings?.pageSize) || DEFAULT_PAGE_SIZE;
  const TABLE_MAX_WIDTH = Number(searchOverrides?.searchTableMaxWidth) || Number(form?.settings?.searchTableMaxWidth) || Number(settings?.searchTableMaxWidth) || null;
  const cellDisplayLimit = parseSearchCellDisplayLimit(searchOverrides?.searchCellMaxChars ?? form?.settings?.searchCellMaxChars);

  const {
    entries,
    headerMatrix,
    loading,
    backgroundLoading,
    waitingForLock,
    useCache,
    lastSyncedAt,
    hasUnsynced,
    unsyncedCount,
    cacheDisabled,
    forceRefreshAll,
    reloadFromCache,
  } = useEntriesWithCache({
    formId: effectiveFormId,
    form,
    locationKey: location.key,
    locationState: location.state,
    showAlert,
  });

  const { columns, headerRows } = useMemo(
    () => buildSearchTableLayout(form, {
      headerMatrix,
      includeOperations: false,
    }),
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

  const isDeletedEntry = useCallback((entry) => Boolean(entry?.deletedAtUnixMs || entry?.deletedAt), []);

  const processedEntries = useMemo(() => {
    return entries.map((entry) => {
      return {
        entry,
        values: computeRowValues(entry, columns),
      };
    });
  }, [entries, columns]);

  const ownerFilteredEntries = useMemo(() => {
    if (isAdmin) return processedEntries;
    if (!form?.settings?.showOwnRecordsOnly) return processedEntries;
    if (!userEmail) return processedEntries;
    return processedEntries.filter((row) => (row.entry?.createdBy || row.entry?.modifiedBy) === userEmail);
  }, [processedEntries, isAdmin, userEmail, form?.settings?.showOwnRecordsOnly]);

  const filteredEntries = useMemo(() => {
    let base = ownerFilteredEntries;
    if (!showDeleted) {
      base = base.filter((row) => !isDeletedEntry(row.entry));
    }
    const keyword = query.trim();
    if (!keyword) {
      return base;
    }
    return base
      .map((row) => {
        const matchDetail = getKeywordMatchDetail(row, columns, keyword);
        if (!matchDetail.matched) return null;
        return row;
      })
      .filter(Boolean);
  }, [ownerFilteredEntries, columns, query, showDeleted, isDeletedEntry]);

  const sortedEntries = useMemo(() => {
    const list = filteredEntries.slice();
    const targetColumn = columns.find((column) => column.key === activeSort.key && column.sortable !== false);
    if (targetColumn) {
      list.sort((a, b) => compareByColumn(a, b, targetColumn, activeSort.order));
    }
    return list;
  }, [filteredEntries, columns, activeSort]);

  const selectedPrintableRows = useMemo(
    () => sortedEntries.filter((row) => selectedEntries.has(row.entry.id)),
    [selectedEntries, sortedEntries],
  );

  const pagedEntries = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedEntries.slice(start, start + PAGE_SIZE);
  }, [sortedEntries, page, PAGE_SIZE]);

  useBeforeUnloadGuard(hasUnsynced);
  const totalPages = Math.max(1, Math.ceil(sortedEntries.length / PAGE_SIZE));
  const totalEntries = sortedEntries.length;
  const startIndex = totalEntries === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endIndex = totalEntries === 0 ? 0 : Math.min(page * PAGE_SIZE, totalEntries);

  const badge = useMemo(() => {
    if (loading || backgroundLoading || waitingForLock) return { label: "読み取り中...", variant: "loading" };
    return { label: "検索画面", variant: "view" };
  }, [loading, backgroundLoading, waitingForLock]);

  const {
    isCreatingPrintDocument,
    handleCellAction,
    handleCreatePrintDocument,
  } = useSearchPagePrintActions({
    form,
    normalizedSchema,
    fieldLabels,
    omitEmptyRowsOnPrint,
    selectedPrintableRows,
    showAlert,
    showOutputAlert,
  });

  const handleRowClick = (entryId) => {
    if (!effectiveFormId) return;
    const entryIds = sortedEntries.map((row) => row.entry.id);
    navigate(`/form/${effectiveFormId}/entry/${entryId}`, {
      state: { from: currentSearchUrl, entryIds },
    });
  };

  const handleCreateNew = () => {
    if (!effectiveFormId) return;
    navigate(`/form/${effectiveFormId}/new`, {
      state: {
        from: currentSearchUrl,
      },
    });
  };

  const handleOpenFormConfig = () => {
    if (!effectiveFormId) return;
    navigate(`/config?form=${encodeURIComponent(effectiveFormId)}`, {
      state: { from: currentSearchUrl },
    });
  };

  const handleBackToMain = () => {
    if (location.state?.from) {
      navigate(location.state.from);
      return;
    }
    navigate("/");
  };

  const selectAllEntries = (checked) => {
    if (checked) selectAllEntriesRaw(pagedEntries.map((item) => item.entry.id));
    else clearSelectedEntries();
  };

  const allSelectedAreDeleted = useMemo(() => {
    if (selectedEntries.size === 0) return false;
    const selectedRows = sortedEntries.filter((row) => selectedEntries.has(row.entry.id));
    if (selectedRows.length === 0) return false;
    return selectedRows.every((row) => isDeletedEntry(row.entry));
  }, [selectedEntries, sortedEntries, isDeletedEntry]);

  const handleDeleteSelected = () => {
    if (selectedEntries.size === 0) {
      showAlert("削除する項目を選択してください。");
      return;
    }
    deleteDialog.open({ entryIds: Array.from(selectedEntries) });
  };

  const handleUndeleteSelected = () => {
    if (selectedEntries.size === 0) return;
    undeleteDialog.open({ entryIds: Array.from(selectedEntries) });
  };

  const handleExportResults = useCallback(async () => {
    if (sortedEntries.length === 0) return;
    setExporting(true);
    try {
      const exportingEntries = sortedEntries.map((row) => row.entry);
      const exportTable = buildExportTableData({ form, entries: exportingEntries });
      const themeColors = getThemeColors();

      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const filename = `検索結果_${form?.settings?.formTitle || form?.id || "form"}_${timestamp}.xlsx`;

      const blob = await createExcelBlob(exportTable, themeColors);
      const base64data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const result = await saveExcelToDrive({ filename, base64: base64data });

      showOutputAlert({ message: "マイドライブにエクセルファイルを保存しました。", url: result.fileUrl, linkLabel: "ファイルを開く" });
    } catch (err) {
      console.error(err);
      showAlert(`出力に失敗しました: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }, [form, sortedEntries, showAlert]);

  const confirmDelete = useCallback(async () => {
    if (!effectiveFormId || deleteDialog.state.entryIds.length === 0) return;
    const targetIds = [...deleteDialog.state.entryIds];
    deleteDialog.reset();
    for (const entryId of targetIds) {
      await dataStore.deleteEntry(effectiveFormId, entryId, { deletedBy: userEmail || "" });
    }
    await reloadFromCache();
    forceRefreshAll();
    clearSelectedEntries();
  }, [effectiveFormId, forceRefreshAll, reloadFromCache, deleteDialog.state.entryIds, userEmail]);

  const confirmUndelete = useCallback(async () => {
    if (!effectiveFormId || undeleteDialog.state.entryIds.length === 0) return;
    const targetIds = [...undeleteDialog.state.entryIds];
    undeleteDialog.reset();
    for (const entryId of targetIds) {
      await dataStore.undeleteEntry(effectiveFormId, entryId, { modifiedBy: userEmail || "" });
    }
    await reloadFromCache();
    forceRefreshAll();
    clearSelectedEntries();
  }, [effectiveFormId, forceRefreshAll, reloadFromCache, undeleteDialog.state.entryIds, userEmail]);

  return {
    // Derived IDs / flags
    effectiveFormId,
    isScopedByAuth,

    // Form data
    form,

    // State
    showDeleteConfirm: deleteDialog.state,
    setShowDeleteConfirm: deleteDialog.setState,
    showUndeleteConfirm: undeleteDialog.state,
    setShowUndeleteConfirm: undeleteDialog.setState,
    selectedEntries,
    exporting,
    isCreatingPrintDocument,
    showDeleted,
    setShowDeleted,
    showDisplaySettings,
    setShowDisplaySettings,

    // Search / pagination
    query,
    page,
    activeSort,
    searchOverrides,
    updateOverride,
    PAGE_SIZE,
    TABLE_MAX_WIDTH,
    cellDisplayLimit,

    // Entries data
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

    // Pagination computed
    totalPages,
    totalEntries,
    startIndex,
    endIndex,

    // UI
    badge,
    allSelectedAreDeleted,
    isDeletedEntry,

    // Callbacks
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
  };
}

import { useBeforeUnloadGuard } from "../app/hooks/useBeforeUnloadGuard.js";
import React, { useMemo, useState, useCallback, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useAuth } from "../app/state/authContext.jsx";
import { dataStore } from "../app/state/dataStore.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { useAlert } from "../app/hooks/useAlert.js";
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
  buildPrintDocumentBundlePayload,
  buildPrintDocumentPayload,
  resolveOmitEmptyRowsOnPrint,
} from "../features/preview/printDocument.js";
import { createExcelBlob, getThemeColors } from "../utils/excelExport.js";
import { restoreResponsesFromData } from "../utils/responses.js";
import { useEntriesWithCache } from "../features/search/useEntriesWithCache.js";
import { useChildEntriesWithCache } from "../features/search/useChildEntriesWithCache.js";
import { collectChildFormLinks, mergeChildFormLinksByFormId } from "../features/search/childFormIntegration.js";
import { createRecordPrintDocument, saveExcelToDrive } from "../services/gasClient.js";
import SearchToolbar from "../features/search/components/SearchToolbar.jsx";
import SearchSidebar from "../features/search/components/SearchSidebar.jsx";
import SearchTable from "../features/search/components/SearchTable.jsx";
import SearchPagination from "../features/search/components/SearchPagination.jsx";
import PrintChildFormDialog from "../features/search/components/PrintChildFormDialog.jsx";
import { DEFAULT_THEME, applyThemeWithFallback } from "../app/theme/theme.js";
import { DEFAULT_PAGE_SIZE } from "../core/constants.js";
import BreadcrumbNav from "../app/components/BreadcrumbNav.jsx";



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
  const { settings } = useBuilderSettings({ applyGlobalTheme: false });
  const { isAdmin, userEmail, formId: scopedFormId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const queryFormId = (searchParams.get("form") || "").trim();
  const effectiveFormId = queryFormId || scopedFormId;
  const isScopedByAuth = scopedFormId !== "";
  const parentRecordId = searchParams.get("parentRecordId") || "";
  const breadcrumbTrail = location.state?.breadcrumbTrail || [];
  const [showDeleteConfirm, setShowDeleteConfirm] = useState({ open: false, entryIds: [] });
  const [showUndeleteConfirm, setShowUndeleteConfirm] = useState({ open: false, entryIds: [] });
  const [selectedEntries, setSelectedEntries] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const [isCreatingPrintDocument, setIsCreatingPrintDocument] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [includeChildren, setIncludeChildren] = useState(false);
  const [showPrintChildFormDialog, setShowPrintChildFormDialog] = useState(false);

  const form = useMemo(() => (effectiveFormId ? getFormById(effectiveFormId) : null), [effectiveFormId, getFormById]);
  const normalizedSchema = useMemo(() => normalizeSchemaIDs(form?.schema || []), [form?.schema]);
  const childFormLinks = useMemo(() => collectChildFormLinks(normalizedSchema), [normalizedSchema]);
  const childForms = useMemo(
    () => mergeChildFormLinksByFormId(childFormLinks, getFormById),
    [childFormLinks, getFormById],
  );
  const canIncludeChildren = !parentRecordId && childForms.length > 0;
  const omitEmptyRowsOnPrint = resolveOmitEmptyRowsOnPrint(form?.settings);
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

  const {
    childEntriesByFormId,
    loading: childEntriesLoading,
  } = useChildEntriesWithCache({
    parentFormId: effectiveFormId,
    childFormLinks: childForms,
    enabled: includeChildren && canIncludeChildren,
    getFormById,
    showAlert,
  });

  const { columns, headerRows } = useMemo(
    () => buildSearchTableLayout(form, {
      headerMatrix,
      includeOperations: false,
      childForms: includeChildren && canIncludeChildren ? childForms : [],
    }),
    [form, headerMatrix, includeChildren, canIncludeChildren, childForms],
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

  const parentEntriesMap = useMemo(() => {
    const next = new Map();
    if (!includeChildren || !canIncludeChildren) return next;

    childForms.forEach((childForm) => {
      const childFormId = String(childForm?.childFormId || "");
      const childEntries = childEntriesByFormId.get(childFormId)?.entries || [];
      childEntries.forEach((childEntry) => {
        if (!childEntry?.parentRecordId) return;
        if (!showDeleted && isDeletedEntry(childEntry)) return;
        if (!next.has(childEntry.parentRecordId)) {
          next.set(childEntry.parentRecordId, {});
        }
        const grouped = next.get(childEntry.parentRecordId);
        if (!Array.isArray(grouped[childFormId])) {
          grouped[childFormId] = [];
        }
        grouped[childFormId].push(childEntry);
      });
    });

    return next;
  }, [canIncludeChildren, childEntriesByFormId, childForms, includeChildren, isDeletedEntry, showDeleted]);

  const processedEntries = useMemo(() => {
    return entries.map((entry) => {
      const childEntriesByLinkedForm = parentEntriesMap.get(entry?.id) || {};
      const childRows = includeChildren && canIncludeChildren
        ? childForms.flatMap((childForm) => {
            const childFormId = String(childForm?.childFormId || "");
            const linkedEntries = Array.isArray(childEntriesByLinkedForm[childFormId]) ? childEntriesByLinkedForm[childFormId] : [];
            return linkedEntries.map((childEntry) => ({
              scope: "child",
              childFormId,
              entry: childEntry,
              values: computeRowValues(childEntry, columns, { scope: "child", childFormId }),
            }));
          })
        : [];

      return {
        scope: "parent",
        entry,
        values: computeRowValues(entry, columns, { scope: "parent" }),
        childRows,
        childEntriesByFormId: childEntriesByLinkedForm,
        matchedChildEntryIds: new Set(),
      };
    });
  }, [entries, parentEntriesMap, includeChildren, canIncludeChildren, childForms, columns]);

  const ownerFilteredEntries = useMemo(() => {
    if (isAdmin) return processedEntries;
    if (!form?.settings?.showOwnRecordsOnly) return processedEntries;
    if (!userEmail) return processedEntries;
    return processedEntries.filter((row) => (row.entry?.createdBy || row.entry?.modifiedBy) === userEmail);
  }, [processedEntries, isAdmin, userEmail, form?.settings?.showOwnRecordsOnly]);

  const parentFilteredEntries = useMemo(() => {
    if (!parentRecordId) return ownerFilteredEntries;
    return ownerFilteredEntries.filter((row) => row.entry?.parentRecordId === parentRecordId);
  }, [ownerFilteredEntries, parentRecordId]);

  const filteredEntries = useMemo(() => {
    let base = parentFilteredEntries;
    if (!showDeleted) {
      base = base.filter((row) => !isDeletedEntry(row.entry));
    }
    const keyword = query.trim();
    if (!keyword) {
      return base.map((row) => ({ ...row, matchedChildEntryIds: new Set() }));
    }
    return base
      .map((row) => {
        const matchDetail = getKeywordMatchDetail(row, columns, keyword, { childRows: row.childRows });
        if (!matchDetail.matched) return null;
        return {
          ...row,
          matchedChildEntryIds: matchDetail.matchedChildEntryIds,
        };
      })
      .filter(Boolean);
  }, [parentFilteredEntries, columns, query, showDeleted, isDeletedEntry]);

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
    if (loading || backgroundLoading || waitingForLock || childEntriesLoading) return { label: "読み取り中...", variant: "loading" };
    return { label: "検索画面", variant: "view" };
  }, [loading, backgroundLoading, waitingForLock, childEntriesLoading]);

  const handleRowClick = (entryId) => {
    if (!effectiveFormId) return;
    const entryIds = sortedEntries.map((row) => row.entry.id);
    navigate(`/form/${effectiveFormId}/entry/${entryId}`, {
      state: { from: `${location.pathname}${location.search}`, entryIds, breadcrumbTrail },
    });
  };

  const handleChildRowClick = (childFormId, parentEntryId) => {
    if (!childFormId || !parentEntryId) return;
    const parentEntry = entries.find((e) => e.id === parentEntryId);
    const representativeFieldId = form?.settings?.representativeFieldId;
    const representativeValue = representativeFieldId
      ? (parentEntry?.data?.[representativeFieldId] || parentEntryId)
      : parentEntryId;
    const nextTrail = [
      ...breadcrumbTrail,
      { formId: effectiveFormId, recordId: parentEntryId, representativeValue },
    ];
    navigate(`/search?form=${childFormId}&parentRecordId=${parentEntryId}`, {
      state: { breadcrumbTrail: nextTrail },
    });
  };

  const handleCreateNew = () => {
    if (!effectiveFormId) return;
    const url = parentRecordId
      ? `/form/${effectiveFormId}/new?parentRecordId=${parentRecordId}`
      : `/form/${effectiveFormId}/new`;
    navigate(url, {
      state: {
        from: `${location.pathname}${location.search}`,
        ...(parentRecordId ? { parentRecordId } : {}),
        breadcrumbTrail,
      },
    });
  };

  const handleOpenFormConfig = () => {
    if (!effectiveFormId) return;
    navigate(`/config?form=${encodeURIComponent(effectiveFormId)}`, {
      state: { from: `${location.pathname}${location.search}` },
    });
  };

  const handleBackToMain = () => {
    if (breadcrumbTrail.length > 0) {
      const lastCrumb = breadcrumbTrail[breadcrumbTrail.length - 1];
      navigate(`/form/${lastCrumb.formId}/entry/${lastCrumb.recordId}`, {
        state: { breadcrumbTrail: breadcrumbTrail.slice(0, -1) },
      });
    } else {
      navigate("/");
    }
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
    setShowDeleteConfirm({ open: true, entryIds: Array.from(selectedEntries) });
  };

  const handleUndeleteSelected = () => {
    if (selectedEntries.size === 0) return;
    setShowUndeleteConfirm({ open: true, entryIds: Array.from(selectedEntries) });
  };

  const handleExportResults = useCallback(async () => {
    if (sortedEntries.length === 0) return;
    setExporting(true);
    try {
      const exportingEntries = sortedEntries.map((row) => row.entry);
      const exportTable = buildExportTableData({
        form,
        entries: exportingEntries,
        childForms: includeChildren && canIncludeChildren ? childForms : [],
        childEntriesMap: includeChildren && canIncludeChildren ? parentEntriesMap : new Map(),
      });
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
  }, [form, sortedEntries, showAlert, includeChildren, canIncludeChildren, childForms, parentEntriesMap]);

  const loadChildEntriesForPrint = useCallback(async (targetChildForms) => {
    const pairs = await Promise.all(
      (targetChildForms || []).map(async (childForm) => {
        const childFormId = String(childForm?.childFormId || "");
        if (!childFormId) return null;

        const cached = childEntriesByFormId.get(childFormId);
        if (cached?.entries && includeChildren) {
          return [childFormId, cached];
        }

        const formRecord = childForm?.form || getFormById(childFormId);
        const result = await dataStore.listEntries(childFormId);
        const entries = Array.isArray(result?.entries) ? result.entries : [];
        return [
          childFormId,
          {
            entries: entries.map((entry) => ({ ...entry, __childFormId: childFormId })),
            form: formRecord,
            loading: false,
          },
        ];
      }),
    );

    return new Map(pairs.filter(Boolean));
  }, [childEntriesByFormId, getFormById, includeChildren]);

  const parentInfo = useMemo(() => {
    if (!parentRecordId) return null;
    const lastCrumb = breadcrumbTrail.length > 0 ? breadcrumbTrail[breadcrumbTrail.length - 1] : null;
    const repValue = lastCrumb?.representativeValue || "";
    return {
      parentRecordId,
      parentRepresentativeValue: repValue && repValue !== parentRecordId ? repValue : "",
    };
  }, [parentRecordId, breadcrumbTrail]);

  const createPrintDocument = useCallback(async (selectedChildFormIds = []) => {
    setIsCreatingPrintDocument(true);
    try {
      const exportedAt = new Date();
      const targetChildForms = childForms.filter((childForm) => selectedChildFormIds.includes(childForm.childFormId));
      const printChildEntries = targetChildForms.length > 0
        ? await loadChildEntriesForPrint(targetChildForms)
        : new Map();

      const records = selectedPrintableRows.map(({ entry }) => {
        const restoredResponses = restoreResponsesFromData(normalizedSchema, entry?.data || {}, entry?.dataUnixMs || {});
        const childSections = targetChildForms
          .map((childForm) => {
            const childFormId = String(childForm?.childFormId || "");
            const childFormRecord = childForm?.form || printChildEntries.get(childFormId)?.form || getFormById(childFormId);
            const childSchema = normalizeSchemaIDs(childFormRecord?.schema || []);
            const entries = (printChildEntries.get(childFormId)?.entries || [])
              .filter((childEntry) => childEntry?.parentRecordId === entry?.id)
              .filter((childEntry) => !isDeletedEntry(childEntry))
              .map((childEntry, index) => ({
                recordNo: childEntry?.["No."] === undefined || childEntry?.["No."] === null || childEntry?.["No."] === ""
                  ? String(index + 1)
                  : String(childEntry["No."]),
                schema: childSchema,
                responses: restoreResponsesFromData(childSchema, childEntry?.data || {}, childEntry?.dataUnixMs || {}),
              }));

            return {
              title: childForm?.formTitle || childFormRecord?.settings?.formTitle || childFormId,
              entries,
            };
          })
          .filter((section) => section.entries.length > 0);

        return buildPrintDocumentPayload({
          schema: normalizedSchema,
          responses: restoredResponses,
          settings: {
            ...(form?.settings || {}),
            recordNo: entry?.["No."],
            modifiedAt: entry?.modifiedAt,
            modifiedAtUnixMs: entry?.modifiedAtUnixMs,
          },
          recordId: entry?.id,
          exportedAt,
          omitEmptyRows: omitEmptyRowsOnPrint,
          childSections,
          parentInfo,
        });
      });
      const payload = buildPrintDocumentBundlePayload({
        formTitle: form?.settings?.formTitle,
        records,
        exportedAt,
      });
      const result = await createRecordPrintDocument(payload);
      showAlert(
        <div className="nf-col nf-gap-8">
          <div>マイドライブに Google ドキュメントを保存しました。</div>
          <a href={result.fileUrl} target="_blank" rel="noopener noreferrer" className="nf-link nf-fw-600">
            ファイルを開く
          </a>
        </div>,
        "出力完了",
      );
    } catch (error) {
      console.error("[SearchPage] failed to create print document:", error);
      showAlert(`印刷様式の出力に失敗しました: ${error?.message || error}`);
    } finally {
      setIsCreatingPrintDocument(false);
    }
  }, [
    childForms,
    form?.settings,
    getFormById,
    isDeletedEntry,
    loadChildEntriesForPrint,
    normalizedSchema,
    omitEmptyRowsOnPrint,
    parentInfo,
    selectedPrintableRows,
    showAlert,
  ]);

  const handleCreatePrintDocument = useCallback(async () => {
    if (selectedPrintableRows.length === 0) {
      showAlert("印刷するレコードを選択してください。");
      return;
    }

    if (canIncludeChildren) {
      setShowPrintChildFormDialog(true);
      return;
    }

    await createPrintDocument([]);
  }, [selectedPrintableRows.length, showAlert, canIncludeChildren, createPrintDocument]);

  const confirmDelete = useCallback(async () => {
    if (!effectiveFormId || showDeleteConfirm.entryIds.length === 0) return;
    const targetIds = [...showDeleteConfirm.entryIds];
    setShowDeleteConfirm({ open: false, entryIds: [] });
    for (const entryId of targetIds) {
      await dataStore.deleteEntry(effectiveFormId, entryId, { deletedBy: userEmail || "" });
    }
    await reloadFromCache();
    forceRefreshAll();
    setSelectedEntries(new Set());
  }, [effectiveFormId, forceRefreshAll, reloadFromCache, showDeleteConfirm.entryIds, userEmail]);

  const confirmUndelete = useCallback(async () => {
    if (!effectiveFormId || showUndeleteConfirm.entryIds.length === 0) return;
    const targetIds = [...showUndeleteConfirm.entryIds];
    setShowUndeleteConfirm({ open: false, entryIds: [] });
    for (const entryId of targetIds) {
      await dataStore.undeleteEntry(effectiveFormId, entryId, { modifiedBy: userEmail || "" });
    }
    await reloadFromCache();
    forceRefreshAll();
    setSelectedEntries(new Set());
  }, [effectiveFormId, forceRefreshAll, reloadFromCache, showUndeleteConfirm.entryIds, userEmail]);

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
          onConfig={parentRecordId ? undefined : handleOpenFormConfig}
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
        />
        </>
      )}
    >
      <BreadcrumbNav
        trail={breadcrumbTrail}
        currentFormId={effectiveFormId}
        currentFormTitle={form?.settings?.formTitle || "(無題)"}
        parentRecordId={parentRecordId}
        getFormById={getFormById}
        onNavigate={(path, state) => navigate(path, { state })}
      />
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
      />
      {(canIncludeChildren || isAdmin) && (
        <div className="nf-row nf-gap-16 nf-items-center nf-mb-12 nf-wrap">
          {canIncludeChildren && (
            <label className="nf-row nf-gap-6 nf-items-center">
              <input type="checkbox" checked={includeChildren} onChange={(e) => setIncludeChildren(e.target.checked)} />
              <span className="nf-text-13">子フォームを含める</span>
            </label>
          )}
          {isAdmin && (
            <label className="nf-row nf-gap-6 nf-items-center">
              <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
              <span className="nf-text-13">削除済みデータを表示する</span>
            </label>
          )}
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
          onChildRowClick={handleChildRowClick}
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
      <ConfirmDialog
        open={showUndeleteConfirm.open}
        title="削除取消し"
        message={`選択した${showUndeleteConfirm.entryIds.length}件の削除済みデータを復活させます。よろしいですか？`}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: () => setShowUndeleteConfirm({ open: false, entryIds: [] }) },
          { label: "削除取消し", value: "undelete", variant: "primary", onSelect: confirmUndelete },
        ]}
      />
      <PrintChildFormDialog
        open={showPrintChildFormDialog}
        childForms={childForms}
        onCancel={() => setShowPrintChildFormDialog(false)}
        onSubmit={async (selectedChildFormIds) => {
          setShowPrintChildFormDialog(false);
          await createPrintDocument(selectedChildFormIds);
        }}
      />

</AppLayout>
  );
}

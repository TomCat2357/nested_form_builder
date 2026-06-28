import { useCallback, useEffect, useMemo, useState } from "react";
import { dataStore } from "../../../app/state/dataStore.js";
import { useSetSelection } from "../../../app/hooks/useSetSelection.js";
import { useCancellable } from "../../../app/hooks/useCancellable.js";
import { normalizeSchemaIDs } from "../../../core/schema.js";
import { getCrossSearchById } from "../crossFormSearchStore.js";
import { buildCrossSearchColumns } from "./crossSearchTable.js";
import { mergeCrossFormRows } from "./mergeCrossFormRows.js";
import { buildSearchExpression, buildSearchRow } from "../../search/searchExpressionBuilder.js";
import { compareByColumn } from "../../search/searchTableValues.js";
import { filterRowsByExpr } from "../analyticsAlaSql.js";
import { runSearchSelect } from "../analyticsStore.js";
import { SQL_MODE_RE } from "../../search/searchSyntaxPreprocessor.js";
import { buildInitialSort, resolvePageSize, computePagination } from "../../search/searchPageSettings.js";
import {
  buildSearchChangeParams,
  buildSortToggleParams,
  buildPageChangeParams,
} from "../../search/searchPageUrlParams.js";
import { buildFieldPathsMap, resolveOmitEmptyRowsOnPrint } from "../../preview/printDocument.js";
import { useSearchPagePrintActions } from "../../search/useSearchPagePrintActions.js";

const isDeletedEntry = (entry) => Boolean(entry?.deletedAtUnixMs || entry?.deletedAt);

export function useCrossFormSearchState({
  searchParams,
  setSearchParams,
  location,
  navigate,
  showAlert,
  showOutputAlert,
  getFormById,
  forms,
  settings,
}) {
  const cfsId = (searchParams.get("id") || "").trim();
  const currentUrl = `${location.pathname}${location.search}`;
  const query = searchParams.get("q") || "";
  const activeSort = useMemo(() => buildInitialSort(searchParams), [searchParams]);
  const PAGE_SIZE = resolvePageSize(settings?.pageSize);

  const [cfs, setCfs] = useState(null);
  const [cfsError, setCfsError] = useState(null);
  const [perFormEntries, setPerFormEntries] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const { selected: selectedEntries, toggle: toggleSelectEntry, selectAll: selectAllRaw, clear: clearSelected } = useSetSelection();

  // CFS 定義のロード。
  useEffect(() => {
    let cancelled = false;
    if (!cfsId) { setCfsError("串刺し検索が指定されていません。"); return undefined; }
    getCrossSearchById(cfsId)
      .then((loaded) => {
        if (cancelled) return;
        if (loaded) setCfs(loaded);
        else setCfsError("串刺し検索が見つかりませんでした。");
      })
      .catch((err) => { if (!cancelled) setCfsError(err.message || String(err)); });
    return () => { cancelled = true; };
  }, [cfsId]);

  const referencedForms = useMemo(() => {
    const ids = Array.isArray(cfs?.formIds) ? cfs.formIds : [];
    return ids.map((id) => getFormById(id)).filter(Boolean);
  }, [cfs?.formIds, getFormById]);

  // 各フォームのレコードを読み込む（既存 SWR キャッシュを活用）。
  const referencedSignature = referencedForms.map((f) => f.id).join(",");
  useCancellable(async (isCancelled) => {
    if (!cfs) return;
    setLoading(true);
    const next = {};
    const forceFullSync = refreshNonce > 0;
    for (const form of referencedForms) {
      try {
        const res = await dataStore.listEntries(form.id, forceFullSync ? { forceFullSync: true } : undefined);
        if (isCancelled()) return;
        next[form.id] = Array.isArray(res?.entries) ? res.entries : [];
      } catch (_e) {
        if (isCancelled()) return;
        next[form.id] = [];
      }
    }
    if (!isCancelled()) {
      setPerFormEntries(next);
      setLoading(false);
    }
  }, [cfs, referencedSignature, refreshNonce]);

  const { displayColumns, searchColumns, headerRows } = useMemo(
    () => buildCrossSearchColumns(cfs?.columns || []),
    [cfs?.columns],
  );

  const perForm = useMemo(
    () => referencedForms.map((f) => ({
      formId: f.id,
      formName: f.settings?.formTitle || f.id,
      entries: (perFormEntries[f.id] || []).filter((e) => !isDeletedEntry(e)),
    })),
    [referencedForms, perFormEntries],
  );

  const records = useMemo(
    () => mergeCrossFormRows(perForm, displayColumns),
    [perForm, displayColumns],
  );

  const recordByEntryId = useMemo(() => {
    const m = new Map();
    for (const r of records) m.set(r.entry.id, r);
    return m;
  }, [records]);

  // ----- 検索（単一フォーム検索とパリティ） -----
  const [filteredRecords, setFilteredRecords] = useState([]);
  const [filterError, setFilterError] = useState(null);

  useCancellable(async (isCancelled) => {
    const keyword = (query || "").trim();
    if (!keyword) {
      setFilterError(null);
      setFilteredRecords(records);
      return;
    }
    // SQL モード: フォーム単位に runSearchSelect を実行し rk を union する（横断 JOIN は範囲外）。
    if (SQL_MODE_RE.test(keyword)) {
      try {
        const rkSet = new Set();
        for (const form of referencedForms) {
          const res = await runSearchSelect(keyword, { forms, defaultFormId: form.id });
          if (isCancelled()) return;
          if (!res.ok) {
            setFilterError("検索エラー: " + (res.error || "SQL を評価できませんでした"));
            setFilteredRecords(records);
            return;
          }
          for (const row of (res.rows || [])) {
            if (row && row.id != null && row.id !== "") rkSet.add(`${form.id} ${row.id}`);
          }
        }
        setFilterError(null);
        setFilteredRecords(records.filter((r) => rkSet.has(r.rk)));
      } catch (err) {
        if (isCancelled()) return;
        setFilterError("検索エラー: " + (err && err.message ? err.message : String(err)));
        setFilteredRecords(records);
      }
      return;
    }
    // 簡易検索: 表示列ベースの検索行（buildSearchRow）に対し WHERE 式を評価する。
    const { expr, errors } = buildSearchExpression(keyword, searchColumns);
    if (errors && errors.length > 0) {
      setFilteredRecords([]);
      setFilterError(errors.join(", "));
      return;
    }
    if (!expr) {
      setFilterError(null);
      setFilteredRecords(records);
      return;
    }
    setFilterError(null);
    try {
      const rows = records.map((r) => ({ ...buildSearchRow(r, searchColumns), __rk: r.rk }));
      const res = await filterRowsByExpr(rows, expr);
      if (isCancelled()) return;
      if (!res.ok) {
        setFilterError("検索エラー: " + (res.error || "式を評価できませんでした"));
        setFilteredRecords(records);
        return;
      }
      const rkSet = new Set();
      for (const row of res.rows) if (row && row.__rk) rkSet.add(row.__rk);
      setFilteredRecords(records.filter((r) => rkSet.has(r.rk)));
    } catch (err) {
      if (isCancelled()) return;
      setFilterError("検索エラー: " + (err && err.message ? err.message : String(err)));
      setFilteredRecords(records);
    }
  }, [records, query, searchColumns, referencedSignature]);

  // ----- ソート / ページング -----
  const sortedRecords = useMemo(() => {
    const list = filteredRecords.slice();
    const target = displayColumns.find((c) => c.key === activeSort.key && c.sortable !== false);
    if (target) list.sort((a, b) => compareByColumn(a, b, target, activeSort.order));
    return list;
  }, [filteredRecords, displayColumns, activeSort]);

  const totalEntries = sortedRecords.length;
  const requestedPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const { totalPages, page, startIndex, endIndex } = computePagination(totalEntries, requestedPage, PAGE_SIZE);

  const pagedEntries = useMemo(
    () => sortedRecords.slice((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE),
    [sortedRecords, page, PAGE_SIZE],
  );

  // ----- 印刷（選択行が単一フォームのときのみ。各フォームのテンプレで出力） -----
  const selectedRecords = useMemo(
    () => sortedRecords.filter((r) => selectedEntries.has(r.entry.id)),
    [sortedRecords, selectedEntries],
  );
  const selectedFormIds = useMemo(
    () => Array.from(new Set(selectedRecords.map((r) => r.formId))),
    [selectedRecords],
  );
  const printForm = useMemo(() => {
    if (selectedFormIds.length === 1) return getFormById(selectedFormIds[0]) || null;
    return referencedForms[0] || null;
  }, [selectedFormIds, getFormById, referencedForms]);
  const printSchema = useMemo(() => normalizeSchemaIDs(printForm?.schema || []), [printForm?.schema]);
  const printFieldPaths = useMemo(() => buildFieldPathsMap(printSchema), [printSchema]);

  const {
    isCreatingPrintDocument,
    handleCellAction,
    handleCreatePrintDocument: handlePrintSingleForm,
  } = useSearchPagePrintActions({
    form: printForm,
    normalizedSchema: printSchema,
    fieldPaths: printFieldPaths,
    omitEmptyRowsOnPrint: resolveOmitEmptyRowsOnPrint(printForm?.settings),
    selectedPrintableRows: selectedRecords,
    showAlert,
    showOutputAlert,
  });

  const handleCreatePrintDocument = useCallback(() => {
    if (selectedRecords.length === 0) {
      showAlert("印刷するレコードを選択してください。");
      return;
    }
    if (selectedFormIds.length > 1) {
      showAlert("印刷は同一フォームのレコードを選択してください（フォームをまたぐ一括印刷は未対応です）。");
      return;
    }
    handlePrintSingleForm();
  }, [selectedRecords.length, selectedFormIds.length, handlePrintSingleForm, showAlert]);

  // ----- ハンドラ -----
  const handleSearchChange = (value) => setSearchParams(buildSearchChangeParams(searchParams, value));
  const handleSortToggle = (key) => setSearchParams(buildSortToggleParams(searchParams, key));
  const handlePageChange = (nextPage) => setSearchParams(buildPageChangeParams(searchParams, nextPage));

  const handleRowClick = (entryId) => {
    const rec = recordByEntryId.get(entryId);
    if (!rec) return;
    navigate(`/form/${rec.formId}/entry/${entryId}`, {
      state: { from: currentUrl },
    });
  };

  const handleBack = () => {
    if (location.state?.from) { navigate(location.state.from); return; }
    navigate("/");
  };

  const handleRefresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  const selectAllEntries = (checked) => {
    if (checked) selectAllRaw(pagedEntries.map((r) => r.entry.id));
    else clearSelected();
  };

  const badge = useMemo(
    () => (loading ? { label: "読み取り中...", variant: "loading" } : { label: "串刺し検索", variant: "view" }),
    [loading],
  );

  return {
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
    selectedCount: selectedEntries.size,
    filteredCount: sortedRecords.length,
    toggleSelectEntry,
    selectAllEntries,
    handleCellAction,
    handleCreatePrintDocument,
  };
}

import { useConfirmDialog } from "../../app/hooks/useConfirmDialog.js";
import { useSetSelection } from "../../app/hooks/useSetSelection.js";
import { useCancellable } from "../../app/hooks/useCancellable.js";
import { useMemo, useState, useCallback, useEffect } from "react";
import { pad2 } from "../../utils/dateTime.js";
import { dataStore } from "../../app/state/dataStore.js";
import { getRecordsFromCache, upsertRecordInCache } from "../../app/state/recordsMemoryStore.js";
import { normalizeSchemaIDs } from "../../core/schema.js";
import {
  backfillComputedFieldValues,
  buildComputedFieldPathsById,
} from "../../core/computedFields.js";
import { buildBackfilledRecord } from "./backfillComputedValues.js";
import { buildSearchTableLayout, buildHeaderRowsLayout, createHitExcerptColumn, createBaseColumns, DEFAULT_HIT_COLUMN_MIN_WIDTH } from "./searchTable.js";
import { buildExportTableData } from "./searchExport.js";
import { hasScriptRun, listRecordsByPids } from "../../services/gasClient.js";
import { buildChildFormUrl } from "../../utils/formShareUrl.js";
import { buildChildDataObject, distributeChildRecordsByPid, getChildFormCached_, collectFormLinkFields } from "../preview/childFormData.js";
import {
  computeRowValues,
  compareByColumn,
  parseSearchCellDisplayLimit,
} from "./searchTableValues.js";
import { buildRowHitExcerpts } from "./searchQueryEngine.js";
import { buildSearchExpression, stripNonSearchableMetaKeys } from "./searchExpressionBuilder.js";
import { entriesToViewTableRows } from "../analytics/entriesToViewRows.js";
import { filterRowsByExpr } from "../analytics/analyticsAlaSql.js";
import { STRICT_PREFIX_RE } from "./searchSyntaxPreprocessor.js";
import { preprocessAlaSqlExpression } from "../expression/preprocessAlaSqlExpression.js";
import {
  buildFieldPathsMap,
  resolveOmitEmptyRowsOnPrint,
} from "../preview/printDocument.js";
import { createExcelBlob, getThemeColors } from "../../utils/excelExport.js";
import { blobToBase64 } from "../../utils/fileEncoding.js";
import { useEntries } from "./useEntries.js";
import { saveExcelToDrive } from "../../services/gasClient.js";
import { useSearchDisplayOverrides } from "./useSearchDisplayOverrides.js";
import { DEFAULT_THEME, applyThemeWithFallback } from "../../app/theme/theme.js";
import { DEFAULT_PAGE_SIZE } from "../../core/constants.js";
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
  const displaySettingsDialog = useConfirmDialog();

  const form = useMemo(() => (effectiveFormId ? getFormById(effectiveFormId) : null), [effectiveFormId, getFormById]);
  const normalizedSchema = useMemo(() => normalizeSchemaIDs(form?.schema || []), [form?.schema]);
  const omitEmptyRowsOnPrint = resolveOmitEmptyRowsOnPrint(form?.settings);
  const fieldPaths = useMemo(() => buildFieldPathsMap(normalizedSchema), [normalizedSchema]);
  const activeSort = useMemo(() => buildInitialSort(searchParams), [searchParams]);
  const query = searchParams.get("q") || "";
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const { overrides: searchOverrides, updateOverride } = useSearchDisplayOverrides(effectiveFormId);
  // pageSize の意味論:
  //   負値（典型: -1）→ 全件表示。Number.MAX_SAFE_INTEGER で表現することで
  //     pagedEntries の slice(0, +N) が全件返却、totalPages も 1 に収束する。
  //     Infinity は Math.ceil(N / Infinity) = 0 を踏むので避ける。
  //   0 / NaN / 未設定 → DEFAULT_PAGE_SIZE にフォールバック（従来挙動）。
  //   正の有限数 → そのまま採用。
  const rawPageSize = Number(searchOverrides?.pageSize ?? form?.settings?.pageSize ?? settings?.pageSize);
  const PAGE_SIZE = rawPageSize < 0
    ? Number.MAX_SAFE_INTEGER
    : (rawPageSize > 0 ? rawPageSize : DEFAULT_PAGE_SIZE);
  const TABLE_MAX_WIDTH = Number(searchOverrides?.searchTableMaxWidth) || Number(form?.settings?.searchTableMaxWidth) || Number(settings?.searchTableMaxWidth) || null;
  const cellDisplayLimit =
    parseSearchCellDisplayLimit(searchOverrides?.searchCellMaxChars) ||
    parseSearchCellDisplayLimit(form?.settings?.searchCellMaxChars) ||
    parseSearchCellDisplayLimit(settings?.searchCellMaxChars) ||
    null;
  // 検索ヒット箇所列の最小幅。override → フォーム設定 → グローバル設定 の順に解決し、
  // いずれも未設定なら既定値を使う。0 / 負値 / NaN は既定値にフォールバック。
  const HIT_COLUMN_MIN_WIDTH = (() => {
    const candidates = [
      searchOverrides?.searchHitColumnMinWidth,
      form?.settings?.searchHitColumnMinWidth,
      settings?.searchHitColumnMinWidth,
    ];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return DEFAULT_HIT_COLUMN_MIN_WIDTH;
  })();

  const {
    entries,
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
  } = useEntries({
    formId: effectiveFormId,
    form,
    locationKey: location.key,
    locationState: location.state,
    showAlert,
  });

  const { columns, headerRows } = useMemo(
    () => buildSearchTableLayout(form, {
      includeOperations: false,
    }),
    [form],
  );

  // 検索スコープ用の列集合。メタ4項目（No./ID/作成日時/最終更新日時）は表示・非表示に
  // 関わらず常に検索対象とするため、表示列に含まれていない非表示メタ列を補って superset を作る。
  // 値計算 / 簡易検索 / ヒット抜粋 / ソートにはこちらを使い、表示は素の columns（show 設定で
  // フィルタ済み）を使う。
  const searchColumns = useMemo(() => {
    const presentKeys = new Set(columns.map((column) => column.key));
    const hiddenMeta = createBaseColumns().filter((column) => !presentKeys.has(column.key));
    return hiddenMeta.length ? [...columns, ...hiddenMeta] : columns;
  }, [columns]);

  // 簡易検索モード（キーワード入力あり かつ SEARCH/WHERE 厳密モードでない）のときだけ
  // 「検索ヒット箇所」列を最左に挿入する。
  const hitColumnActive = useMemo(() => {
    const keyword = (query || "").trim();
    return Boolean(keyword) && !STRICT_PREFIX_RE.test(keyword);
  }, [query]);

  // 表示専用の列構成。値計算 / 検索 / ソートには素の columns を使い続け、
  // ヒット列はレンダリング用のこちらにのみ含める。
  const displayColumns = useMemo(
    () => (hitColumnActive ? [createHitExcerptColumn(), ...columns] : columns),
    [hitColumnActive, columns],
  );
  const displayHeaderRows = useMemo(
    () => (hitColumnActive ? buildHeaderRowsLayout(displayColumns) : headerRows),
    [hitColumnActive, displayColumns, headerRows],
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

  const hasComputedFields = useMemo(
    () => Object.keys(buildComputedFieldPathsById(normalizedSchema)).length > 0,
    [normalizedSchema],
  );

  const processedEntries = useMemo(() => {
    return entries.map((entry) => {
      if (!hasComputedFields) {
        return {
          entry,
          values: computeRowValues(entry, searchColumns),
          backfillResult: null,
          originalEntry: entry,
        };
      }
      const backfillResult = backfillComputedFieldValues(normalizedSchema, entry?.data);
      const effectiveEntry = backfillResult.changed ? { ...entry, data: backfillResult.data } : entry;
      return {
        entry: effectiveEntry,
        values: computeRowValues(effectiveEntry, searchColumns),
        backfillResult,
        originalEntry: entry,
      };
    });
  }, [entries, searchColumns, normalizedSchema, hasComputedFields]);

  const recordsNeedingBackfill = useMemo(
    () => processedEntries.filter((row) => row.backfillResult?.changed),
    [processedEntries],
  );

  useCancellable(async (isCancelled) => {
    if (!effectiveFormId) return;
    if (recordsNeedingBackfill.length === 0) return;
    try {
      const { headerMatrix, schemaHash } = await getRecordsFromCache(effectiveFormId);
      const now = Date.now();
      for (const row of recordsNeedingBackfill) {
        if (isCancelled()) return;
        const next = buildBackfilledRecord(row.originalEntry, row.backfillResult, { now, userEmail });
        if (!next) continue;
        await upsertRecordInCache(effectiveFormId, next, { headerMatrix, schemaHash });
      }
      if (!isCancelled()) await reloadFromCache();
    } catch (error) {
      console.warn("[SearchPage] computed backfill failed:", error);
    }
  }, [effectiveFormId, recordsNeedingBackfill, userEmail, reloadFromCache]);

  const baseFilteredEntries = useMemo(() => {
    let base = processedEntries;
    if (!showDeleted) {
      base = base.filter((row) => !isDeletedEntry(row.entry));
    }
    return base;
  }, [processedEntries, showDeleted, isDeletedEntry]);

  const [filteredEntries, setFilteredEntries] = useState(baseFilteredEntries);
  const [filterError, setFilterError] = useState(null);

  // 検索は data/view の区別なく、唯一のデータ形式である view 形式の行に対して評価する。
  // entriesToViewTableRows は選択肢ラベル文字列（複数値は codec 連結）を持ち、各行に row.id を持つ。
  const searchTableRows = useMemo(() => {
    if (!form) return [];
    const entriesArr = baseFilteredEntries.map((row) => row.entry);
    return entriesToViewTableRows(entriesArr, form);
  }, [form, baseFilteredEntries]);

  // strict（WHERE/SEARCH）評価に渡す行は、検索非対象メタ列（createdBy / modifiedBy /
  // deletedAt / deletedBy）を落として簡易モードとアクセス範囲を揃える。
  // 行ビルダ（entriesToViewTableRows）はこれらを含むため、ここで除かないと
  // WHERE deletedBy = ... 等が通ってしまう。
  const searchableTableRows = useMemo(
    () => stripNonSearchableMetaKeys(searchTableRows),
    [searchTableRows],
  );

  // 簡易検索・厳密検索とも同一の view 形式行を使う（元データ形式は廃止）。
  const simpleSearchRows = searchableTableRows;

  useCancellable(async (isCancelled) => {
    const keyword = (query || "").trim();
    if (!keyword) {
      setFilterError(null);
      setFilteredEntries(baseFilteredEntries);
      return;
    }
    // 簡易・厳密の両モードを共通 alasql エンジンへ統一。
    // - 厳密モード（先頭 SEARCH/WHERE）: searchSyntaxPreprocessor が WHERE 節相当へ変換。
    //   評価行は searchableTableRows（searchQueryTableSource を尊重）。
    // - 簡易モード: searchSimpleTranslate が正規表現 / 複数値集合分解などを WHERE 式へ翻訳。
    //   評価行は simpleSearchRows（常に view 形式）。
    // いずれも preprocessAlaSqlExpression → filterRowsByExpr（SELECT * FROM ? WHERE <expr>）で評価。
    const isStrict = STRICT_PREFIX_RE.test(keyword);
    const { expr, errors } = buildSearchExpression(keyword, searchColumns);
    if (errors && errors.length > 0) {
      setFilteredEntries([]);
      setFilterError(errors.join(", "));
      return;
    }
    if (!expr) {
      // 厳密モードで式が空（`WHERE ` のみ等）は従来どおり解析エラー扱い。
      // 簡易モードで式が空になるのは空 AST（例 "()"）のみで、旧エンジンは全件一致だったため全件表示。
      if (isStrict) {
        setFilteredEntries([]);
        setFilterError("検索式を解析できませんでした");
      } else {
        setFilterError(null);
        setFilteredEntries(baseFilteredEntries);
      }
      return;
    }
    setFilterError(null);
    try {
      const whereExpr = preprocessAlaSqlExpression(expr);
      const rows = isStrict ? searchableTableRows : simpleSearchRows;
      const res = await filterRowsByExpr(rows, whereExpr);
      if (isCancelled()) return;
      if (!res.ok) {
        setFilterError("検索エラー: " + (res.error || "式を評価できませんでした"));
        setFilteredEntries(baseFilteredEntries);
        return;
      }
      const idSet = new Set();
      for (const r of res.rows) {
        if (r && r.id != null && r.id !== "") idSet.add(r.id);
      }
      setFilteredEntries(baseFilteredEntries.filter((row) => idSet.has(row.entry?.id)));
    } catch (err) {
      if (isCancelled()) return;
      setFilterError("検索エラー: " + (err && err.message ? err.message : String(err)));
      setFilteredEntries(baseFilteredEntries);
    }
  }, [baseFilteredEntries, searchColumns, query, searchableTableRows, simpleSearchRows, form]);

  const sortedEntries = useMemo(() => {
    const list = filteredEntries.slice();
    const targetColumn = searchColumns.find((column) => column.key === activeSort.key && column.sortable !== false);
    if (targetColumn) {
      list.sort((a, b) => compareByColumn(a, b, targetColumn, activeSort.order));
    }
    return list;
  }, [filteredEntries, searchColumns, activeSort]);

  const selectedPrintableRows = useMemo(
    () => sortedEntries.filter((row) => selectedEntries.has(row.entry.id)),
    [selectedEntries, sortedEntries],
  );

  // webhook / 検索結果の出力で使う対象行: チェックがあればその行だけ、なければ全行。
  // (印刷は selectedPrintableRows のまま = 選択必須で例外)
  const outputTargetRows = useMemo(
    () => (selectedEntries.size > 0 ? selectedPrintableRows : sortedEntries),
    [selectedEntries, selectedPrintableRows, sortedEntries],
  );

  // ---- 子フォームデータの一括プリロード（検索結果一覧の Webhook 用） ----
  // includeChildData=ON の formLink 項目について、表示中の全行の親 id を pids にまとめ、
  // 子フォームごとに 1 回だけ listRecordsByPids（WHERE pid IN (...) 相当）で取得し、
  // フロントで pid 分配する（行 × 子フォーム数の N+1 リクエストを避ける）。
  const childFormLinkFields = useMemo(
    () => collectFormLinkFields(normalizedSchema).filter((f) => f.includeChildData),
    [normalizedSchema],
  );

  const [searchChildDataByField, setSearchChildDataByField] = useState({});
  const visiblePidSignature = useMemo(
    () => sortedEntries.map((r) => r.entry?.id).filter(Boolean).join(","),
    [sortedEntries],
  );
  const childFormLinkSignature = childFormLinkFields.map((f) => `${f.id}:${f.childFormId}`).join("|");
  useCancellable(async (isCancelled) => {
    setSearchChildDataByField({});
    if (childFormLinkFields.length === 0) return;
    if (typeof listRecordsByPids !== "function" || !hasScriptRun()) return;
    const pids = sortedEntries.map((r) => r.entry?.id).filter(Boolean);
    if (pids.length === 0) return;
    const baseUrl = (typeof window !== "undefined" && window.__GAS_WEBAPP_URL__) ? window.__GAS_WEBAPP_URL__ : "";
    for (const field of childFormLinkFields) {
      try {
        const [childForm, records] = await Promise.all([
          getChildFormCached_(field.childFormId),
          listRecordsByPids({ formId: field.childFormId, pids }),
        ]);
        if (isCancelled()) return;
        const childSchema = childForm && childForm.schema ? childForm.schema : [];
        const grouped = distributeChildRecordsByPid(records);
        const byPid = {};
        // 子レコードを持つ pid のみ合成オブジェクトを作る（payload 肥大を抑える）。
        grouped.forEach((recs, pid) => {
          byPid[pid] = buildChildDataObject({
            childFormId: field.childFormId,
            childFormName: field.childFormName,
            childFormUrl: buildChildFormUrl(baseUrl, field.childFormId, pid),
            childSchema,
            records: recs,
          });
        });
        setSearchChildDataByField((prev) => ({ ...prev, [field.id]: { path: field.path, byPid } }));
      } catch (_e) {
        // 取得失敗時は子データを出さない（無言）。
      }
    }
  }, [childFormLinkSignature, visiblePidSignature]);

  // pid（=親レコード id）に紐づく子フォーム合成オブジェクト配列を返す。検索 Webhook payload 用。
  const getSearchChildFormsForPid = useCallback((pid) => {
    const key = String(pid || "");
    if (!key) return [];
    const out = [];
    for (const field of childFormLinkFields) {
      const entry = searchChildDataByField[field.id];
      const obj = entry && entry.byPid ? entry.byPid[key] : null;
      if (obj) out.push({ fieldPath: field.path, ...obj });
    }
    return out;
  }, [childFormLinkFields, searchChildDataByField]);

  const pagedEntries = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedEntries.slice(start, start + PAGE_SIZE);
  }, [sortedEntries, page, PAGE_SIZE]);

  // 表示中ページの各行にヒット抜粋を付与（最大 PAGE_SIZE 件のみ計算）。
  const displayPagedEntries = useMemo(() => {
    if (!hitColumnActive) return pagedEntries;
    return pagedEntries.map((row) => ({
      ...row,
      hitExcerpts: buildRowHitExcerpts(row, searchColumns, query, { cellDisplayLimit }),
    }));
  }, [hitColumnActive, pagedEntries, searchColumns, query, cellDisplayLimit]);

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
    fieldPaths,
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
    navigate(`/forms/${encodeURIComponent(effectiveFormId)}/settings`, {
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
    if (outputTargetRows.length === 0) return;
    setExporting(true);
    try {
      const exportingEntries = outputTargetRows.map((row) => row.entry);
      const exportTable = buildExportTableData({ form, entries: exportingEntries });
      const themeColors = getThemeColors();

      const now = new Date();
      const timestamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
      const filename = `検索結果_${form?.settings?.formTitle || form?.id || "form"}_${timestamp}.xlsx`;

      const blob = await createExcelBlob(exportTable, themeColors);
      const base64data = await blobToBase64(blob);

      const result = await saveExcelToDrive({ filename, base64: base64data });

      showOutputAlert({ message: "マイドライブにエクセルファイルを保存しました。", url: result.fileUrl, linkLabel: "ファイルを開く" });
    } catch (err) {
      console.error("[SearchPage] excel export failed:", err);
      showAlert(`出力に失敗しました: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }, [form, outputTargetRows, showAlert]);

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
    displaySettingsDialog,

    // Search / pagination
    query,
    page,
    activeSort,
    searchOverrides,
    updateOverride,
    PAGE_SIZE,
    TABLE_MAX_WIDTH,
    cellDisplayLimit,
    HIT_COLUMN_MIN_WIDTH,

    // Entries data
    entries,
    columns,
    headerRows,
    displayColumns,
    displayHeaderRows,
    displayPagedEntries,
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
    outputTargetRows,
    getSearchChildFormsForPid,
    pagedEntries,
    filterError,

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

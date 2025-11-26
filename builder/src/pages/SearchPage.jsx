import React, { useEffect, useMemo, useState, useCallback } from "react";
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
  applyDisplayLengthLimit,
  parseSearchCellDisplayLimit,
} from "../features/search/searchTable.js";
import { DISPLAY_MODES } from "../core/displayModes.js";
import {
  saveRecordsToCache,
  getRecordsFromCache,
} from "../app/state/recordsCache.js";
import { evaluateCache, CACHE_MAX_AGE_MS, CACHE_BACKGROUND_REFRESH_MS } from "../app/state/cachePolicy.js";

const createTableStyle = (maxWidth) => ({
  width: maxWidth ? `${maxWidth}px` : "100%",
  borderCollapse: "collapse",
  background: "#fff",
  borderRadius: 12,
  overflow: "hidden",
});

const thStyle = {
  textAlign: "left",
  padding: "12px 16px",
  borderBottom: "1px solid #E5E7EB",
  background: "#F8FAFC",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const tdStyle = {
  padding: "12px 16px",
  borderBottom: "1px solid #F1F5F9",
  fontSize: 13,
  color: "#1F2937",
  verticalAlign: "top",
};

const searchBarStyle = {
  display: "flex",
  gap: 12,
  marginBottom: 16,
  flexWrap: "wrap",
  alignItems: "center",
};

const inputStyle = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #CBD5E1",
  background: "#fff",
  fontSize: 14,
};

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
  const { forms, getFormById } = useAppData();
  const { settings } = useBuilderSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { alertState, showAlert, closeAlert } = useAlert();
  const formId = searchParams.get("formId");
  const [entries, setEntries] = useState([]);
  const [headerMatrix, setHeaderMatrix] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState({ open: false, entryIds: [] });
  const [useCache, setUseCache] = useState(false);
  const [selectedEntries, setSelectedEntries] = useState(new Set());
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [cacheDisabled, setCacheDisabled] = useState(false);

  const form = useMemo(() => (formId ? getFormById(formId) : null), [formId, getFormById]);
  const activeSort = useMemo(() => buildInitialSort(searchParams), [searchParams]);
  const query = searchParams.get("q") || "";
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const PAGE_SIZE = Number(settings?.pageSize) || 20;
  const TABLE_MAX_WIDTH = settings?.searchTableMaxWidth ? Number(settings.searchTableMaxWidth) : null;
  const cellDisplayLimit = parseSearchCellDisplayLimit(form?.settings?.searchCellMaxChars);

  const baseColumns = useMemo(() => {
    const result = buildSearchColumns(form, { includeOperations: false });
    return result;
  }, [form]);

  const columns = useMemo(() => {
    // headerMatrixがある場合は、スプレッドシートの実際の列構造から columns を生成
    if (headerMatrix && headerMatrix.length > 0) {
      const result = buildColumnsFromHeaderMatrix(headerMatrix, baseColumns);
      return result;
    }
    // headerMatrixがない場合は baseColumns をそのまま使用
    return baseColumns;
  }, [headerMatrix, baseColumns]);

  const headerRows = useMemo(() => {
    if (headerMatrix && headerMatrix.length > 0) {
      const rows = buildHeaderRowsFromCsv(headerMatrix, columns);
      if (rows && rows.length > 0) {
        return rows;
      }
    }
    return buildHeaderRows(columns);
  }, [columns, headerMatrix]);

  // データを全件取得してキャッシュに保存する関数
  const fetchAndCacheData = useCallback(async ({ background = false } = {}) => {
    if (!formId) return;
    if (!background) setLoading(true);
    const startedAt = Date.now();
    console.log("[perf][search] fetch start", { formId, background, startedAt });
    try {
      const result = await dataStore.listEntries(formId);
      const fetchedEntries = result.entries || result || [];
      setEntries(fetchedEntries);
      setHeaderMatrix(result.headerMatrix || []);
      const syncedAt = result.lastSyncedAt || Date.now();
      setLastSyncedAt(syncedAt);

      // IndexedDBにキャッシュ保存
      try {
        await saveRecordsToCache(formId, fetchedEntries, result.headerMatrix || [], { schemaHash: form?.schemaHash });
        setCacheDisabled(false);
      } catch (cacheErr) {
        console.warn("[SearchPage] Failed to save records cache:", cacheErr);
        setCacheDisabled(true);
      }
      setUseCache(false);
    } catch (error) {
      console.error("[SearchPage] Failed to fetch and cache data:", error);
      showAlert(`データの取得に失敗しました: ${error.message || error}`);
    } finally {
      const finishedAt = Date.now();
      console.log("[perf][search] fetch done", { formId, background, durationMs: finishedAt - startedAt });
      if (!background) setLoading(false);
    }
  }, [formId, form, showAlert]);

  // データ読み込みロジック
  useEffect(() => {
    if (!formId) return;

    const loadData = async () => {
      let cache = { entries: [], headerMatrix: [], lastSyncedAt: null };
      try {
        cache = await getRecordsFromCache(formId);
      } catch (error) {
        console.warn("[SearchPage] Failed to load cache:", error);
        setCacheDisabled(true);
      }

      const schemaMismatch = cache.schemaHash && form?.schemaHash && cache.schemaHash !== form.schemaHash;
      const hasCache = (cache.entries || []).length > 0 && !schemaMismatch;
      if (schemaMismatch) {
        console.warn("[perf][search] cache schema mismatch detected; forcing sync", { cacheSchema: cache.schemaHash, formSchema: form?.schemaHash });
      }
      const forceSync = location.state?.saved === true || location.state?.deleted === true || location.state?.created === true;
      const { age, shouldSync, shouldBackground } = evaluateCache({
        lastSyncedAt: cache.lastSyncedAt,
        hasData: hasCache,
        forceSync,
        maxAgeMs: CACHE_MAX_AGE_MS,
        backgroundAgeMs: CACHE_BACKGROUND_REFRESH_MS,
      });

      console.log("[perf][search] cache decision", { formId, cacheAge: age, hasCache, shouldSync, shouldBackground, cacheDisabled });

      if (hasCache) {
        setEntries(cache.entries);
        setHeaderMatrix(cache.headerMatrix || []);
        setLastSyncedAt(cache.lastSyncedAt || cache.cacheTimestamp || null);
        setUseCache(true);
      }

      if (shouldSync || cacheDisabled) {
        await fetchAndCacheData({ background: false });
        return;
      }

      if (shouldBackground) {
        fetchAndCacheData({ background: true }).catch((error) => {
          console.error("[SearchPage] background refresh failed:", error);
          showAlert(`データの取得に失敗しました: ${error.message || error}`);
        });
      }
    };

    loadData();
  }, [formId, location.key, fetchAndCacheData, location.state, showAlert]);

  const handleSearchChange = (event) => {
    const value = event.target.value;
    const next = new URLSearchParams(searchParams);
    if (value) next.set("q", value);
    else next.delete("q");
    next.set("page", "1");
    setSearchParams(next);
  };

  const handleSortToggle = (key) => {
    // ソート可能な列を探す（sortable !== false の列のみ）
    const targetColumn = columns.find((column) => column.key === key && column.sortable !== false);

    // 列が見つからない場合でも、全てのソート不可を弾かない
    // （headerRowsのcellにcolumnが設定されていれば、そちらでソート可能判定される）

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

  const processedEntries = useMemo(
    () => {
      const result = entries.map((entry) => {
        const values = computeRowValues(entry, columns);
        return { entry, values };
      });
      return result;
    },
    [entries, columns],
  );

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
  }, [sortedEntries, page]);

  const totalPages = Math.max(1, Math.ceil(sortedEntries.length / PAGE_SIZE));
  const totalEntries = sortedEntries.length;
  const startIndex = totalEntries === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endIndex = totalEntries === 0 ? 0 : Math.min(page * PAGE_SIZE, totalEntries);

  const handleRowClick = (entryId) => {
    if (!formId) return;
    const t0 = performance.now();
    console.log(`[PERF] handleRowClick START - entryId: ${entryId}`);
    navigate(`/form/${formId}/entry/${entryId}`, {
      state: {
        from: `${location.pathname}${location.search}`,
      },
    });
    const t1 = performance.now();
    console.log(`[PERF] handleRowClick navigate() called - Time: ${(t1 - t0).toFixed(2)}ms`);
  };

  const handleCreateNew = () => {
    if (!formId) return;
    navigate(`/form/${formId}/new`, {
      state: {
        from: `${location.pathname}${location.search}`,
      },
    });
  };

  const toggleSelectEntry = (entryId) => {
    setSelectedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const selectAllEntries = (checked) => {
    if (checked) {
      setSelectedEntries(new Set(pagedEntries.map((item) => item.entry.id)));
    } else {
      setSelectedEntries(new Set());
    }
  };

  const handleDeleteSelected = () => {
    if (selectedEntries.size === 0) {
      showAlert("削除する項目を選択してください。");
      return;
    }
    setShowDeleteConfirm({ open: true, entryIds: Array.from(selectedEntries) });
  };

  const confirmDelete = async () => {
    if (!formId || showDeleteConfirm.entryIds.length === 0) return;

    for (const entryId of showDeleteConfirm.entryIds) {
      await dataStore.deleteEntry(formId, entryId);
    }

    // 削除後は全件再取得してキャッシュ更新
    await fetchAndCacheData();
    setSelectedEntries(new Set());
    setShowDeleteConfirm({ open: false, entryIds: [] });
  };

  if (!formId || !form) {
    return (
      <AppLayout title="検索" fallbackPath="/">
        <p style={{ color: "#6B7280" }}>フォームが選択されていません。メイン画面からフォームを選択してください。</p>
      </AppLayout>
    );
  }

  const sidebarButtonStyle = {
    ...inputStyle,
    width: "100%",
    textAlign: "left",
  };

  return (
    <AppLayout
      title={`検索 - ${form.settings?.formTitle || "(無題)"}`}
      fallbackPath="/"
      sidebarActions={
        <>
          <button type="button" style={sidebarButtonStyle} onClick={handleCreateNew}>
            新規入力
          </button>
          <button
            type="button"
            style={{
              ...sidebarButtonStyle,
              borderColor: "#FCA5A5",
              background: "#FEF2F2",
            }}
            onClick={handleDeleteSelected}
            disabled={selectedEntries.size === 0}
          >
            削除
          </button>
          <button
            type="button"
            style={{
              ...sidebarButtonStyle,
              background: useCache ? "#FEF3C7" : "#fff",
              borderColor: useCache ? "#F59E0B" : "#CBD5E1",
            }}
            onClick={fetchAndCacheData}
            disabled={loading}
            title={useCache ? "キャッシュから表示中 - クリックで最新データを取得" : "最新データを取得"}
          >
            {useCache ? "🔄 更新" : "更新"}
          </button>
        </>
      }
    >
      <div style={searchBarStyle}>
        <input
          type="search"
          placeholder="キーワード検索"
          value={query}
          onChange={handleSearchChange}
          style={{ ...inputStyle, flex: "1 0 220px" }}
        />
        <span style={{ color: "#6B7280", fontSize: 12 }}>
          最終更新: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "未取得"} {useCache ? "(キャッシュ)" : cacheDisabled ? "(キャッシュ無効)" : ""}
        </span>
      </div>

      {loading ? (
        <p style={{ color: "#6B7280" }}>読み込み中...</p>
      ) : (
        <div style={{ overflowX: "auto", width: "100%" }}>
          <table style={createTableStyle(TABLE_MAX_WIDTH)}>
            <thead>
              {headerRows.map((headerRow, rowIndex) => {
                const isLastRow = rowIndex === headerRows.length - 1;
                return (
                  <tr key={`header-row-${rowIndex}`}>
                    {rowIndex === 0 && (
                      <th
                        style={{ ...thStyle, width: 50 }}
                        rowSpan={headerRows.length}
                      >
                        <input
                          type="checkbox"
                          checked={pagedEntries.length > 0 && selectedEntries.size === pagedEntries.length}
                          onChange={(e) => selectAllEntries(e.target.checked)}
                        />
                      </th>
                    )}
                    {headerRow.map((cell, cellIndex) => {
                      // cellに含まれるcolumnオブジェクトを使用
                      const column = cell.column || null;
                      // __actions列はスキップ
                      if (column && column.key === "__actions") return null;
                      const sortable = Boolean(column && column.sortable !== false);
                      const isActive = sortable && activeSort.key === column.key;
                      const orderLabel = isActive ? (activeSort.order === "desc" ? "↓" : "↑") : "";

                      return (
                        <th
                          key={`header-cell-${rowIndex}-${cellIndex}`}
                          style={{
                            ...thStyle,
                            cursor: sortable ? "pointer" : "default",
                          }}
                          colSpan={cell.colSpan}
                          rowSpan={cell.rowSpan ?? 1}
                          onClick={sortable ? () => handleSortToggle(column.key) : undefined}
                        >
                          {cell.label}
                          {sortable && (
                            <span style={{ marginLeft: 4, color: "#64748B" }}>{orderLabel}</span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                );
              })}
            </thead>
            <tbody>
              {pagedEntries.map(({ entry, values }) => (
                <tr
                  key={entry.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => handleRowClick(entry.id)}
                >
                  <td
                    style={{ ...tdStyle, width: 50 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selectedEntries.has(entry.id)}
                      onChange={() => toggleSelectEntry(entry.id)}
                    />
                  </td>
                  {columns.map((column) => {
                    // __actions列はスキップ
                    if (column.key === "__actions") return null;
                    const rawDisplayText = values[column.key]?.display ?? "";
                    const displayText = rawDisplayText || "";
                    const limitedText = applyDisplayLengthLimit(displayText, cellDisplayLimit);
                    return (
                      <td key={`${entry.id}_${column.key}`} style={tdStyle}>
                        {limitedText}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {pagedEntries.length === 0 && (
                <tr>
                  <td style={{ ...tdStyle, textAlign: "center" }} colSpan={(columns.filter(c => c.key !== "__actions").length || 0) + 1}>
                    データがありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
        <span style={{ color: "#6B7280", fontSize: 13 }}>
          {totalEntries} 件中 {startIndex} - {endIndex} 件
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={inputStyle} disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>
            前へ
          </button>
          <span style={{ lineHeight: "32px" }}>
            {page} / {totalPages}
          </span>
          <button type="button" style={inputStyle} disabled={page >= totalPages} onClick={() => handlePageChange(page + 1)}>
            次へ
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm.open}
        title="レコードを削除"
        message={`選択した${showDeleteConfirm.entryIds.length}件の回答を削除します。よろしいですか？`}
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setShowDeleteConfirm({ open: false, entryIds: [] }),
          },
          {
            label: "削除",
            value: "delete",
            variant: "danger",
            onSelect: confirmDelete,
          },
        ]}
      />

      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </AppLayout>
  );
}

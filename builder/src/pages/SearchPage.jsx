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
} from "../features/search/searchTable.js";
import { DISPLAY_MODES } from "../core/displayModes.js";
import { splitFieldPath } from "../utils/formPaths.js";
import {
  saveRecordsToCache,
  getRecordsFromCache,
  hasCachedRecords,
} from "../app/state/recordsCache.js";

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

  const PAGE_SIZE = Number(settings?.pageSize) || 20;
  const TABLE_MAX_WIDTH = settings?.searchTableMaxWidth ? Number(settings.searchTableMaxWidth) : null;

  const form = useMemo(() => (formId ? getFormById(formId) : null), [formId, getFormById]);
  const activeSort = useMemo(() => buildInitialSort(searchParams), [searchParams]);
  const query = searchParams.get("q") || "";
  const page = Math.max(1, Number(searchParams.get("page") || 1));

  const baseColumns = useMemo(() => {
    const result = buildSearchColumns(form, { includeOperations: true });
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
    // If we have a headerMatrix from spreadsheet, use it
    if (headerMatrix && headerMatrix.length > 0) {
      const rows = buildHeaderRowsFromCsv(headerMatrix, baseColumns);
      return rows;
    }
    // Otherwise fall back to building from columns
    const rows = buildHeaderRows(columns);
    return rows;
  }, [columns, baseColumns, headerMatrix]);

  // データを全件取得してキャッシュに保存する関数
  const fetchAndCacheData = useCallback(async () => {
    if (!formId) return;
    setLoading(true);
    try {
      const result = await dataStore.listEntries(formId);
      const fetchedEntries = result.entries || result || [];
      setEntries(fetchedEntries);
      setHeaderMatrix(result.headerMatrix || []);

      // IndexedDBにキャッシュ保存
      await saveRecordsToCache(fetchedEntries);
      setUseCache(false);
    } catch (error) {
      console.error("[SearchPage] Failed to fetch and cache data:", error);
    } finally {
      setLoading(false);
    }
  }, [formId]);

  // データ読み込みロジック
  useEffect(() => {
    if (!formId) return;

    const loadData = async () => {
      // フォーム一覧から遷移した場合は全件再取得
      if (location.state?.fromMainPage === true) {
        await fetchAndCacheData();
        return;
      }

      // 保存フラグがある場合は全件再取得
      if (location.state?.saved === true) {
        await fetchAndCacheData();
        return;
      }

      // 保存されていない場合はキャッシュを優先
      const hasCache = await hasCachedRecords();

      if (hasCache) {
        // キャッシュがある場合はそれを使用
        setLoading(true);
        try {
          const cachedRecords = await getRecordsFromCache();
          setEntries(cachedRecords);
          setUseCache(true);
        } catch (error) {
          console.error("[SearchPage] Failed to load from cache:", error);
          // キャッシュ読み込み失敗時は全件取得
          await fetchAndCacheData();
        } finally {
          setLoading(false);
        }
      } else {
        // キャッシュがない場合は全件取得
        await fetchAndCacheData();
      }
    };

    loadData();
  }, [formId, location.key, fetchAndCacheData, location.state]);

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
    navigate(`/form/${formId}/entry/${entryId}`, {
      state: {
        from: `${location.pathname}${location.search}`,
      },
    });
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
      title={`検索 - ${form.name}`}
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
                    const isCompact = column.displayMode === DISPLAY_MODES.COMPACT;
                    const leafLabel = isCompact ? splitFieldPath(column.path).slice(-1)[0] || "" : "";
                    // 簡略表示では最下段ラベルをデータ側に持ってくるが、値があれば優先して表示
                    const displayText = isCompact
                      ? (rawDisplayText || leafLabel)
                      : rawDisplayText;
                    return (
                      <td key={`${entry.id}_${column.key}`} style={tdStyle}>
                        {displayText}
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

import React, { useEffect, useMemo, useRef, useState } from "react";
import { applyDisplayLengthLimit } from "../searchTable.js";

const headerSortLabel = (activeSort, columnKey) => {
  if (activeSort.key !== columnKey) return "";
  return activeSort.order === "desc" ? "↓" : "↑";
};

export default function SearchTable({
  columns,
  headerRows,
  pagedEntries,
  selectedEntries,
  activeSort,
  cellDisplayLimit,
  tableMaxWidth,
  onSortToggle,
  onSelectAll,
  onToggleSelect,
  onRowClick,
  onCellAction,
}) {
  const handleCopyId = async (event, id) => {
    event.stopPropagation();
    const idText = String(id || "");
    if (!idText) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(idText);
      }
    } catch {
      // no-op: クリップボードAPIが使えない環境では通常表示のみ
    }
  };

  const renderCellContent = (column, rawDisplayText, row) => {
    const limitedText = applyDisplayLengthLimit(rawDisplayText || "", cellDisplayLimit);
    const isUrl = column.sourceType === "url" && rawDisplayText;
    const isRecordIdColumn = column.key === "id";

    if (isRecordIdColumn) {
      return (
        <button
          type="button"
          className="nf-link nf-text-left"
          style={{ padding: 0, border: "none", background: "none", cursor: "pointer" }}
          onClick={(event) => {
            void handleCopyId(event, rawDisplayText);
          }}
          title="クリックでIDをコピー"
        >
          {limitedText}
        </button>
      );
    }

    if (isUrl) {
      return (
        <a
          href={String(rawDisplayText).match(/^(javascript|vbscript|data):/i) ? "#" : rawDisplayText}
          target="_blank"
          rel="noopener noreferrer"
          className="nf-link"
          onClick={(event) => event.stopPropagation()}
        >
          {limitedText}
        </a>
      );
    }

    if (column.actionKind && rawDisplayText) {
      return (
        <button
          type="button"
          className="nf-link nf-text-left"
          style={{ padding: 0, border: "none", background: "none", cursor: "pointer" }}
          onClick={(event) => {
            event.stopPropagation();
            onCellAction?.(column, row?.entry);
          }}
        >
          {limitedText}
        </button>
      );
    }

    return limitedText;
  };

  const selectableColumns = columns.filter((column) => column.key !== "__actions");
  const allPagedEntriesSelected = pagedEntries.length > 0 && pagedEntries.every(({ entry }) => selectedEntries.has(entry.id));
  const topScrollRef = useRef(null);
  const bottomScrollRef = useRef(null);
  const tableRef = useRef(null);
  const syncingScrollRef = useRef(false);
  const [showTopScrollbar, setShowTopScrollbar] = useState(false);
  const [topScrollInnerWidth, setTopScrollInnerWidth] = useState(0);

  useEffect(() => {
    const topScrollEl = topScrollRef.current;
    const bottomScrollEl = bottomScrollRef.current;
    const tableEl = tableRef.current;
    if (!topScrollEl || !bottomScrollEl || !tableEl) return undefined;

    const syncScroll = (source, target) => {
      if (!source || !target) return;
      if (syncingScrollRef.current) return;
      if (target.scrollLeft === source.scrollLeft) return;
      syncingScrollRef.current = true;
      target.scrollLeft = source.scrollLeft;
      syncingScrollRef.current = false;
    };

    const updateTopScrollbar = () => {
      const scrollWidth = tableEl.scrollWidth;
      const clientWidth = bottomScrollEl.clientWidth;
      const hasOverflow = scrollWidth > clientWidth + 1;

      setTopScrollInnerWidth((prev) => (prev === scrollWidth ? prev : scrollWidth));
      setShowTopScrollbar((prev) => (prev === hasOverflow ? prev : hasOverflow));

      if (topScrollEl.scrollLeft !== bottomScrollEl.scrollLeft) {
        topScrollEl.scrollLeft = bottomScrollEl.scrollLeft;
      }
    };

    const handleTopScroll = () => syncScroll(topScrollEl, bottomScrollEl);
    const handleBottomScroll = () => syncScroll(bottomScrollEl, topScrollEl);

    topScrollEl.addEventListener("scroll", handleTopScroll);
    bottomScrollEl.addEventListener("scroll", handleBottomScroll);

    let resizeObserver = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        updateTopScrollbar();
      });
      resizeObserver.observe(tableEl);
      resizeObserver.observe(bottomScrollEl);
    } else if (typeof window !== "undefined") {
      window.addEventListener("resize", updateTopScrollbar);
    }

    updateTopScrollbar();

    return () => {
      topScrollEl.removeEventListener("scroll", handleTopScroll);
      bottomScrollEl.removeEventListener("scroll", handleBottomScroll);
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else if (typeof window !== "undefined") {
        window.removeEventListener("resize", updateTopScrollbar);
      }
    };
  }, [columns, headerRows, pagedEntries, tableMaxWidth]);

  return (
    <>
      <div className={`search-table-top-scroll${showTopScrollbar ? "" : " is-hidden"}`} ref={topScrollRef} aria-hidden="true">
        <div className="search-table-top-scroll-inner" style={{ width: `${topScrollInnerWidth}px` }} />
      </div>
      <div className="search-table-wrap" ref={bottomScrollRef}>
        <table ref={tableRef} className="search-table" style={{ "--table-width": tableMaxWidth ? `${tableMaxWidth}px` : "100%" }}>
          <thead>
            {headerRows.map((headerRow, rowIndex) => (
              <tr key={`header-row-${rowIndex}`}>
                {rowIndex === 0 && (
                  <th className="search-th search-td-narrow" rowSpan={headerRows.length}>
                    <input
                      type="checkbox"
                      checked={allPagedEntriesSelected}
                      onChange={(e) => onSelectAll(e.target.checked)}
                    />
                  </th>
                )}
                {headerRow.map((cell, cellIndex) => {
                  const fallbackColumn = cell.colSpan === 1 ? selectableColumns[cell.startIndex] || null : null;
                  const column = cell.column || fallbackColumn;
                  if (column && column.key === "__actions") return null;
                  const sortable = Boolean(column && column.sortable !== false && column.scope !== "child");
                  const orderLabel = sortable && cell.label !== "" ? headerSortLabel(activeSort, column.key) : "";

                  return (
                    <th
                      key={`header-cell-${rowIndex}-${cellIndex}`}
                      className="search-th"
                      data-sortable={sortable && cell.label !== "" ? "true" : "false"}
                      colSpan={cell.colSpan}
                      rowSpan={cell.rowSpan ?? 1}
                      onClick={sortable && cell.label !== "" ? () => onSortToggle(column.key) : undefined}
                    >
                      {cell.label}
                      {orderLabel && <span className="nf-text-muted nf-ml-4">{orderLabel}</span>}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {pagedEntries.map((row) => {
              const { entry, values } = row;
              return (
                <tr
                  key={entry.id}
                  className="search-row"
                  onClick={() => {
                    const selection = window.getSelection();
                    if (selection && selection.toString().length > 0) {
                      return;
                    }
                    onRowClick(entry.id);
                  }}
                >
                  <td className="search-td search-td-narrow" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedEntries.has(entry.id)}
                      onChange={() => onToggleSelect(entry.id)}
                    />
                  </td>
                  {selectableColumns.map((column) => {
                    const rawDisplayText = values[column.key]?.display ?? "";
                    return (
                      <td key={`${entry.id}_${column.key}`} className="search-td">
                        {renderCellContent(column, rawDisplayText, row)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {pagedEntries.length === 0 && (
              <tr>
                <td className="search-td nf-text-center" colSpan={selectableColumns.length + 1}>
                  データがありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

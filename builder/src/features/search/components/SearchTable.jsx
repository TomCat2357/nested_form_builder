import React from "react";
import { applyDisplayLengthLimit } from "../searchTable.js";
import { theme } from "../../../app/theme/tokens.js";

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
}) {
  const selectableColumns = columns.filter((column) => column.key !== "__actions");

  return (
    <div className="search-table-wrap">
      <table className="search-table" style={{ "--table-width": tableMaxWidth ? `${tableMaxWidth}px` : "100%" }}>
        <thead>
          {headerRows.map((headerRow, rowIndex) => (
            <tr key={`header-row-${rowIndex}`}>
              {rowIndex === 0 && (
                <th className="search-th search-td-narrow" rowSpan={headerRows.length}>
                  <input
                    type="checkbox"
                    checked={pagedEntries.length > 0 && selectedEntries.size === pagedEntries.length}
                    onChange={(e) => onSelectAll(e.target.checked)}
                  />
                </th>
              )}
              {headerRow.map((cell, cellIndex) => {
                const column = cell.column || null;
                if (column && column.key === "__actions") return null;
                const sortable = Boolean(column && column.sortable !== false);
                const orderLabel = sortable ? headerSortLabel(activeSort, column.key) : "";

                return (
                  <th
                    key={`header-cell-${rowIndex}-${cellIndex}`}
                    className="search-th"
                    data-sortable={sortable ? "true" : "false"}
                    colSpan={cell.colSpan}
                    rowSpan={cell.rowSpan ?? 1}
                    onClick={sortable ? () => onSortToggle(column.key) : undefined}
                  >
                    {cell.label}
                    {sortable && <span className="nf-text-muted nf-ml-4">{orderLabel}</span>}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {pagedEntries.map(({ entry, values }) => (
            <tr
              key={entry.id}
              className="search-row"
              onClick={() => {
                // テキストが選択されていたら（ドラッグ操作）遷移しない
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
                const limitedText = applyDisplayLengthLimit(rawDisplayText || "", cellDisplayLimit);
                const isUrl = column.sourceType === "url" && rawDisplayText;
                return (
                  <td key={`${entry.id}_${column.key}`} className="search-td">
                    {isUrl ? (
                      <a
                        href={rawDisplayText}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="nf-link"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {limitedText}
                      </a>
                    ) : (
                      limitedText
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
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
  );
}

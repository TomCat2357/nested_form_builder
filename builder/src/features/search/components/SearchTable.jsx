import React from "react";
import { applyDisplayLengthLimit } from "../searchTable.js";
import { createTableStyle, thStyle, tdStyle } from "../searchStyles.js";

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
    <div style={{ overflowX: "auto", width: "100%" }}>
      <table style={createTableStyle(tableMaxWidth)}>
        <thead>
          {headerRows.map((headerRow, rowIndex) => (
            <tr key={`header-row-${rowIndex}`}>
              {rowIndex === 0 && (
                <th style={{ ...thStyle, width: 50 }} rowSpan={headerRows.length}>
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
                    style={{ ...thStyle, cursor: sortable ? "pointer" : "default" }}
                    colSpan={cell.colSpan}
                    rowSpan={cell.rowSpan ?? 1}
                    onClick={sortable ? () => onSortToggle(column.key) : undefined}
                  >
                    {cell.label}
                    {sortable && <span style={{ marginLeft: 4, color: "#64748B" }}>{orderLabel}</span>}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {pagedEntries.map(({ entry, values }) => (
            <tr key={entry.id} style={{ cursor: "pointer" }} onClick={() => onRowClick(entry.id)}>
              <td style={{ ...tdStyle, width: 50 }} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedEntries.has(entry.id)}
                  onChange={() => onToggleSelect(entry.id)}
                />
              </td>
              {selectableColumns.map((column) => {
                const rawDisplayText = values[column.key]?.display ?? "";
                const limitedText = applyDisplayLengthLimit(rawDisplayText || "", cellDisplayLimit);
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
              <td style={{ ...tdStyle, textAlign: "center" }} colSpan={selectableColumns.length + 1}>
                データがありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

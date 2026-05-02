import React, { useMemo } from "react";

const formatCell = (value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch (_err) { return String(value); }
  }
  return String(value);
};

export default function TableWidget({ widget, rows }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const columns = useMemo(() => {
    if (Array.isArray(widget.columns) && widget.columns.length > 0) return widget.columns;
    const first = safeRows[0];
    return first && typeof first === "object" ? Object.keys(first) : [];
  }, [widget.columns, safeRows]);

  return (
    <div className="dashboard-widget dashboard-widget-table">
      {widget.title && <h4 className="dashboard-widget-title">{widget.title}</h4>}
      <div className="search-table-wrap">
        <table className="search-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col} className="search-th">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {safeRows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {columns.map((col) => (
                  <td key={col} className="search-td">{formatCell(row?.[col])}</td>
                ))}
              </tr>
            ))}
            {safeRows.length === 0 && (
              <tr>
                <td className="search-td nf-text-center" colSpan={Math.max(columns.length, 1)}>
                  データがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

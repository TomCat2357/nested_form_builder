import React from "react";

export default function ResultTable({ rows, columns }) {
  if (!columns || columns.length === 0) {
    return <p className="nf-text-subtle">データがありません。</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="search-table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col} style={{ padding: "6px 10px", textAlign: "left", borderBottom: "2px solid var(--nf-border)" }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col} style={{ padding: "5px 10px", borderBottom: "1px solid var(--nf-border)" }}>
                  {row[col] === null || row[col] === undefined ? "" : String(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

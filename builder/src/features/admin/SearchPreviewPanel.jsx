import React, { useMemo } from "react";
import { collectResponses } from "../../core/collect.js";
import { collectDisplayFieldSettings } from "../../utils/formPaths.js";
import {
  buildSearchColumns,
  buildHeaderRows,
  computeRowValues,
  applyDisplayLengthLimit,
  parseSearchCellDisplayLimit,
} from "../search/searchTable.js";
import { theme } from "../../app/theme/tokens.js";

const panelStyle = {
  border: `1px solid ${theme.border}`,
  borderRadius: theme.radiusMd,
  background: theme.surface,
  padding: 12,
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
};

const thStyle = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: `1px solid ${theme.border}`,
  background: theme.surfaceSubtle,
  fontSize: 12,
  fontWeight: 600,
};

const tdStyle = {
  padding: "8px 12px",
  borderBottom: `1px solid ${theme.borderSubtle}`,
  fontSize: 12,
  color: theme.textStrong,
};

const BASE_KEYS = new Set(["id", "createdAt", "modifiedAt", "__actions"]);

const hasAnyValue = (values, columns) =>
  (columns || []).some((column) => {
    if (BASE_KEYS.has(column.key)) return false;
    const display = values?.[column.key]?.display;
    return typeof display === "string" && display.trim().length > 0;
  });

export default function SearchPreviewPanel({ schema, responses, settings }) {
  const displayFieldSettings = useMemo(() => collectDisplayFieldSettings(schema), [schema]);
  const form = useMemo(
    () => ({
      displayFieldSettings,
      importantFields: displayFieldSettings.map((item) => item.path),
    }),
    [displayFieldSettings],
  );

  const displayLengthLimit = parseSearchCellDisplayLimit(settings?.searchCellMaxChars);

  const sampleEntry = useMemo(() => {
    const data = collectResponses(schema, responses);
    return {
      id: "プレビュー",
      createdAt: "",
      modifiedAt: "",
      data,
    };
  }, [schema, responses]);

  const columns = useMemo(() => buildSearchColumns(form, { includeOperations: false }), [form]);
  const headerRows = useMemo(() => buildHeaderRows(columns), [columns]);
  const previewRow = useMemo(
    () => ({ entry: sampleEntry, values: computeRowValues(sampleEntry, columns) }),
    [sampleEntry, columns],
  );

  const hasImportantColumns = useMemo(
    () => columns.some((column) => !BASE_KEYS.has(column.key)),
    [columns],
  );
  const hasResponses = useMemo(
    () => hasAnyValue(previewRow.values, columns),
    [previewRow.values, columns],
  );

  return (
    <section style={{ marginTop: 24 }}>
      <details open>
        <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 12 }}>
          検索プレビュー
        </summary>
        <div style={panelStyle}>
          {!hasImportantColumns ? (
            <p style={{ color: theme.textSubtle, fontSize: 12 }}>
              「表示」に設定された質問がありません。表示項目を設定すると検索プレビューが表示されます。
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  {headerRows.map((row, rowIndex) => (
                    <tr key={`preview-header-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <th
                          key={`preview-header-cell-${rowIndex}-${cellIndex}`}
                          style={thStyle}
                          colSpan={cell.colSpan}
                          rowSpan={cell.rowSpan ?? 1}
                        >
                          {cell.label}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {hasResponses ? (
                    <tr>
                      {columns.map((column) => (
                        <td key={`preview-${column.key}`} style={tdStyle}>
                          {applyDisplayLengthLimit(
                            previewRow.values?.[column.key]?.display ?? "",
                            displayLengthLimit,
                          )}
                        </td>
                      ))}
                    </tr>
                  ) : (
                    <tr>
                      <td style={{ ...tdStyle, textAlign: "center", color: theme.textSubtle }} colSpan={columns.length || 1}>
                        フォームに入力すると、表示項目の検索結果プレビューがここに表示されます。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

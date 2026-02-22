import React, { useMemo } from "react";
import { collectResponses } from "../../core/collect.js";
import { collectDisplayFieldSettings } from "../../utils/formPaths.js";
import {
  buildSearchTableLayout,
  computeRowValues,
  applyDisplayLengthLimit,
  parseSearchCellDisplayLimit,
} from "../search/searchTable.js";
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

  const { columns, headerRows } = useMemo(
    () => buildSearchTableLayout(form, { includeOperations: false }),
    [form],
  );
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
    <section className="nf-mt-24">
      <details open>
        <summary className="nf-cursor-pointer nf-fw-600 nf-mb-12">
          検索プレビュー
        </summary>
        <div className="nf-card">
          {!hasImportantColumns ? (
            <p className="nf-text-subtle nf-text-12">
              「表示」に設定された質問がありません。表示項目を設定すると検索プレビューが表示されます。
            </p>
          ) : (
            <div className="search-table-wrap">
              <table className="search-preview-table">
                <thead>
                  {headerRows.map((row, rowIndex) => (
                    <tr key={`preview-header-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <th
                          key={`preview-header-cell-${rowIndex}-${cellIndex}`}
                          className="search-preview-th"
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
                        <td key={`preview-${column.key}`} className="search-preview-td">
                          {applyDisplayLengthLimit(
                            previewRow.values?.[column.key]?.display ?? "",
                            displayLengthLimit,
                          )}
                        </td>
                      ))}
                    </tr>
                  ) : (
                    <tr>
                      <td className="search-preview-td nf-text-center nf-text-subtle" colSpan={columns.length || 1}>
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

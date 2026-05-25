import { traverseSchema } from "../../core/schemaUtils.js";
import { computeRowValues } from "./searchTableValues.js";
import {
  createBaseColumns,
  createDisplayColumn,
  buildHeaderRows,
  expandHeaderRowsToMatrix,
  suppressDuplicateHeaderLabels,
  padRowToLength,
  isExcludedSearchOrPrintField,
} from "./searchTable.js";

const collectAllFieldSettings = (schema) => {
  const collected = [];
  const seen = new Set();
  traverseSchema(schema || [], (field, context) => {
    if (isExcludedSearchOrPrintField(field)) return;
    const path = context?.pathSegments?.join("|") || "";
    if (!path || seen.has(path)) return;
    seen.add(path);
    collected.push({
      path,
      type: field?.type || "",
      field,
    });
  });
  return collected;
};

export const buildExportColumns = (form, { includeBaseColumns = true } = {}) => {
  const columns = [];
  if (includeBaseColumns) {
    columns.push(...createBaseColumns());
  }
  collectAllFieldSettings(form?.schema || []).forEach(({ path, type, field }) => {
    if (!path) return;
    if (type === "fileUpload") {
      columns.push(createDisplayColumn(path, type, { actionKind: "folderLink", fieldMeta: field }));
      return;
    }
    columns.push(createDisplayColumn(path, type));
  });
  return columns;
};

const buildFileUploadCell = (cellValue) => {
  const files = Array.isArray(cellValue?.files) ? cellValue.files : [];
  const folderUrl = typeof cellValue?.folderUrl === "string" ? cellValue.folderUrl.trim() : "";
  const text = files.length > 0 ? String(cellValue?.display ?? "") : "なし";
  if (folderUrl) {
    return { text, hyperlink: folderUrl };
  }
  return text;
};

export const buildExportTableData = ({ form, entries }) => {
  const columns = buildExportColumns(form, { includeBaseColumns: true });
  const headerRows = buildHeaderRows(columns);
  const headerMatrix = expandHeaderRowsToMatrix(headerRows, columns.length);
  const deduped = suppressDuplicateHeaderLabels(headerMatrix);
  const normalizedHeaderRows = deduped.map((row) => padRowToLength(row, columns.length));
  const normalizedRows = [];
  (entries || []).forEach((entry) => {
    const values = computeRowValues(entry, columns);
    const row = columns.map((column) => {
      const cellValue = values?.[column.key];
      if (column?.actionKind === "folderLink") {
        return buildFileUploadCell(cellValue);
      }
      const display = cellValue?.display;
      if (display === null || display === undefined) return "";
      return String(display);
    });
    normalizedRows.push(padRowToLength(row, columns.length));
  });
  return {
    columns,
    headerRows: normalizedHeaderRows,
    rows: normalizedRows,
  };
};

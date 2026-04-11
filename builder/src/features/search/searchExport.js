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
    });
  });
  return collected;
};

export const buildExportColumns = (form, { includeBaseColumns = true } = {}) => {
  const columns = [];
  if (includeBaseColumns) {
    columns.push(...createBaseColumns());
  }
  collectAllFieldSettings(form?.schema || []).forEach(({ path, type }) => {
    if (!path) return;
    columns.push(createDisplayColumn(path, type));
  });
  return columns;
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
      const display = values?.[column.key]?.display;
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

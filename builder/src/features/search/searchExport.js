import { traverseSchema } from "../../core/schemaUtils.js";
import { computeRowValues } from "./searchTableValues.js";
import { parseFileUploadStorage } from "../../core/collect.js";
import { joinFieldPath } from "../../utils/pathCodec.js";
import { buildDriveFileViewUrl } from "../../utils/externalActionUrl.js";
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
    const path = joinFieldPath(context?.pathSegments || []);
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

// 外部アクション payload 用に、対象行ごとの fileUpload 参照（ファイル URL + フォルダ URL）を組む。
// buildExportTableData（出力共有・表示文字列）には手を入れず、別構造として返す。
// entries と同順の配列で、各行 = [{ question(連結パス), folderUrl, folderName, files:[{name,driveFileId,driveFileUrl}] }]。
// 添付の無い項目はスキップする。driveFileUrl は driveFileId から決定的に再構成する（サーバ解決不要）。
export const buildSearchFileRefs = ({ form, entries } = {}) => {
  const fileFields = collectAllFieldSettings(form?.schema || []).filter(({ type }) => type === "fileUpload");
  if (fileFields.length === 0) return [];
  return (entries || []).map((entry) => {
    const data = entry?.data || {};
    const refs = [];
    fileFields.forEach(({ path }) => {
      const parsed = parseFileUploadStorage(data[path]);
      const files = (parsed.files || [])
        .map((f) => ({
          name: f?.name || "",
          driveFileId: f?.driveFileId || "",
          driveFileUrl: f?.driveFileUrl || buildDriveFileViewUrl(f?.driveFileId || ""),
        }))
        .filter((f) => f.name || f.driveFileId || f.driveFileUrl);
      if (files.length === 0 && !parsed.folderUrl && !parsed.folderName) return;
      refs.push({
        question: path,
        folderUrl: parsed.folderUrl || "",
        folderName: parsed.folderName || "",
        files,
      });
    });
    return refs;
  });
};

import { splitFieldPath, collectDisplayFieldSettings } from "../../utils/formPaths.js";
import { resolveFileDisplayName } from "../../core/collect.js";
import {
  formatUnixMsDateTimeSec,
  toUnixMs,
} from "../../utils/dateTime.js";
import { MAX_DEPTH as MAX_HEADER_DEPTH } from "../../core/constants.js";
import { traverseSchema } from "../../core/schemaUtils.js";
import { getPrintTemplateOutputLabel, normalizePrintTemplateAction } from "../../utils/printTemplateAction.js";
import {
  columnType,
  isChoiceColumn,
  normalizeSearchText,
  debugLog,
  collectFieldValue,
} from "./searchTableValues.js";

export { MAX_HEADER_DEPTH };

export const isExcludedSearchOrPrintField = (field) => (
  field?.type === "printTemplate"
  || (field?.type === "message" && field?.excludeFromSearchAndPrint === true)
);

const buildHeaderFullPath = (matrix, columnIndex) => {
  const parts = [];
  for (let rowIdx = 0; rowIdx < matrix.length; rowIdx += 1) {
    const val = matrix[rowIdx]?.[columnIndex];
    if (val !== null && val !== undefined && val !== "") {
      parts.push(String(val));
    }
  }
  return parts.join("|");
};

const matchBaseDisplayColumn = (columns, fullPath) => {
  if (!columns || !fullPath) return null;
  for (const column of columns) {
    if (!column || !column.path) continue;
    const pathStr = String(column.path);
    if (fullPath === pathStr) {
      return column;
    }
    if (fullPath.startsWith(`${pathStr}|`)) {
      const remainder = fullPath.slice(pathStr.length + 1);
      if (remainder && !remainder.includes("|")) {
        return column;
      }
    }
  }
  return null;
};

const parseFileUploadEntries = (rawDataValue) => {
  if (!rawDataValue) return [];
  try {
    const parsed = typeof rawDataValue === "string" ? JSON.parse(rawDataValue) : rawDataValue;
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (e) {
    return [];
  }
};

const getFileDisplayName = (file) => {
  return typeof file.name === "string" ? file.name : "";
};

export const createBaseColumns = () => [
  {
    key: "id",
    segments: ["ID"],
    sortable: true,
    searchable: true,
    getValue: (entry) => {
      const value = entry?.id || "";
      return {
        display: String(value),
        search: normalizeSearchText(value),
        sort: String(value),
      };
    },
  },
  {
    key: "No.",
    segments: ["No."],
    sortable: true,
    searchable: true,
    getValue: (entry) => {
      const value = entry?.["No."] || "";
      return {
        display: String(value),
        search: normalizeSearchText(value),
        sort: typeof value === 'number' ? value : (value ? parseFloat(value) || 0 : 0),
      };
    },
  },
  {
    key: "createdAt",
    segments: ["作成日時"],
    sortable: true,
    searchable: true,
    getValue: (entry) => {
      const raw = entry?.createdAt ?? "";
      const unixMs = toUnixMs(entry?.createdAtUnixMs ?? raw);
      const display = Number.isFinite(unixMs) ? formatUnixMsDateTimeSec(unixMs) : (typeof raw === "string" ? raw : "");
      return {
        display,
        search: normalizeSearchText(display || ""),
        sort: Number.isFinite(unixMs) ? unixMs : 0,
      };
    },
  },
  {
    key: "modifiedAt",
    segments: ["最終更新日時"],
    sortable: true,
    searchable: true,
    getValue: (entry) => {
      const raw = entry?.modifiedAt ?? "";
      const unixMs = toUnixMs(entry?.modifiedAtUnixMs ?? raw);
      const display = Number.isFinite(unixMs) ? formatUnixMsDateTimeSec(unixMs) : (typeof raw === "string" ? raw : "");
      return {
        display,
        search: normalizeSearchText(display || ""),
        sort: Number.isFinite(unixMs) ? unixMs : 0,
      };
    },
  },
];

export const createDisplayColumn = (path, sourceType = "", options = {}) => {
  const normalizedSegments = Array.isArray(options.segments)
    ? [...options.segments]
    : splitFieldPath(path);
  if (normalizedSegments.length === 0) normalizedSegments.push("回答");
  const limitedSegments = normalizedSegments.slice(0, MAX_HEADER_DEPTH);
  const key = options.key || `display:${path}`;
  const optionOrder = Array.isArray(options.optionOrder) ? options.optionOrder : null;
  const actionKind = options.actionKind || "";
  const action = options.action || null;
  return {
    key,
    segments: limitedSegments.length > 0 ? limitedSegments : ["回答"],
    sortable: true,
    searchable: true,
    path,
    sourceType,
    optionOrder,
    fieldId: options.fieldId || "",
    actionKind,
    action,
    searchAliases: Array.isArray(options.searchAliases) ? options.searchAliases.filter(Boolean) : [],
    getValue: (entry, column) => {
      if (actionKind === "folderLink") {
        const folderUrl = typeof entry?.driveFolderUrl === "string" ? entry.driveFolderUrl.trim() : "";
        const rawDataValue = entry?.data?.[path];
        const files = parseFileUploadEntries(rawDataValue);
        const hideExt = options?.fieldMeta?.hideFileExtension === true;
        const fileItems = files.map((file) => ({
          name: typeof file.name === "string" ? file.name : "",
          driveFileUrl: typeof file.driveFileUrl === "string" ? file.driveFileUrl : "",
          displayName: resolveFileDisplayName(getFileDisplayName(file), hideExt),
        }));
        const displayNames = fileItems.map((f) => f.displayName).filter(Boolean);
        const searchParts = files.map((file) => file.name).filter(Boolean);
        const display = displayNames.join("、") || (folderUrl ? "フォルダを開く" : "");
        return {
          display,
          search: normalizeSearchText(searchParts.join(" ")),
          sort: displayNames[0] || "",
          files: fileItems,
          folderUrl,
        };
      }
      if (actionKind === "printTemplate") {
        const label = getPrintTemplateOutputLabel(action);
        return {
          display: label,
          search: normalizeSearchText(label),
          sort: label,
        };
      }
      return collectFieldValue(entry, path, column);
    },
  };
};

const actionsColumn = {
  key: "__actions",
  segments: ["操作"],
  sortable: false,
  searchable: false,
  getValue: () => ({ display: "", search: "", sort: "" }),
};

const collectChoiceOptionOrderByPath = (schema) => {
  const optionOrderByPath = new Map();
  traverseSchema(schema || [], (field, context) => {
    const path = context?.pathSegments?.join("|") || "";
    if (!path) return;
    if (field?.type !== "checkboxes" && field?.type !== "weekday") return;
    const options = Array.isArray(field?.options) ? field.options : [];
    const labels = options
      .map((option) => (typeof option?.label === "string" ? option.label : ""))
      .filter(Boolean);
    optionOrderByPath.set(path, labels);
  });
  return optionOrderByPath;
};

const collectFieldMeta = (schema) => {
  const byId = new Map();
  const byPath = new Map();
  traverseSchema(schema || [], (field, context) => {
    const fieldId = typeof field?.id === "string" ? field.id.trim() : "";
    if (fieldId) byId.set(fieldId, field);
    const path = Array.isArray(context?.pathSegments) ? context.pathSegments.join("|") : "";
    if (path && !byPath.has(path)) byPath.set(path, field);
  });
  return { byId, byPath };
};

const resolveDisplayFieldSettings = (form) => {
  const schema = form?.schema || [];
  const collected = collectDisplayFieldSettings(schema).map((item) => ({
    path: String(item?.path || ""),
    type: item?.type || "",
    fieldId: item?.fieldId || "",
    printTemplateAction: item?.printTemplateAction,
  }));
  const collectedByPath = new Map(collected.map((item) => [item.path, item.type || ""]));
  const collectedByFieldId = new Map(
    collected
      .filter((item) => item.fieldId)
      .map((item) => [item.fieldId, item]),
  );
  const optionOrderByPath = collectChoiceOptionOrderByPath(schema);
  if (Array.isArray(form?.displayFieldSettings) && form.displayFieldSettings.length) {
    const resolveTypeByPath = (path) => collectedByPath.get(path) || "";
    const shouldFilterByCollected = collectedByPath.size > 0;
    const matchedFallbackFieldIds = new Set();
    return form.displayFieldSettings
      .filter((item) => item && item.path)
      .map((item) => {
        const rawPath = String(item.path);
        const rawType = item.type || resolveTypeByPath(rawPath);
        const rawFieldId = typeof item.fieldId === "string" ? item.fieldId : "";
        let matched = rawFieldId ? collectedByFieldId.get(rawFieldId) || null : null;

        if (!matched) {
          matched = collected.find((candidate) => (
            candidate.path === rawPath
            && candidate.type === rawType
            && (!candidate.fieldId || !matchedFallbackFieldIds.has(candidate.fieldId))
          )) || null;
        }

        if (!matched && rawType === "printTemplate") {
          matched = collected.find((candidate) => (
            candidate.type === rawType
            && !matchedFallbackFieldIds.has(candidate.fieldId)
          )) || null;
        }

        if (matched?.fieldId) {
          matchedFallbackFieldIds.add(matched.fieldId);
        }

        const resolvedPath = matched?.path || rawPath;
        const resolvedType = matched?.type || rawType;
        if (shouldFilterByCollected && !matched && !collectedByPath.has(rawPath)) {
          return null;
        }

        return {
          path: resolvedPath,
          type: resolvedType,
          optionOrder: optionOrderByPath.get(resolvedPath) || null,
          fieldId: matched?.fieldId || rawFieldId,
          printTemplateAction: matched?.printTemplateAction,
        };
      })
      .filter(Boolean);
  }

  return collected
    .filter((item) => item && item.path)
    .map((item) => ({
      path: String(item.path),
      type: item.type || "",
      optionOrder: optionOrderByPath.get(String(item.path)) || null,
      fieldId: item.fieldId || "",
      printTemplateAction: item.printTemplateAction,
    }));
};

const moveRecordNoColumnToFront = (columns = []) => {
  const recordNoColumn = columns.find((column) => column?.key === "No.");
  if (!recordNoColumn) return [...columns];
  return [recordNoColumn, ...columns.filter((column) => column?.key !== "No.")];
};

export const buildSearchColumns = (form, { includeOperations = true } = {}) => {
  const showRecordNo = form?.settings?.showRecordNo !== false;
  const showSearchId = form?.settings?.showSearchId !== false;
  const showSearchCreatedAt = form?.settings?.showSearchCreatedAt !== false;
  const showSearchModifiedAt = form?.settings?.showSearchModifiedAt !== false;
  const metaColumns = moveRecordNoColumnToFront(createBaseColumns().filter((col) => {
    if (!showRecordNo && col.key === "No.") return false;
    if (!showSearchId && col.key === "id") return false;
    if (!showSearchCreatedAt && col.key === "createdAt") return false;
    if (!showSearchModifiedAt && col.key === "modifiedAt") return false;
    return true;
  }));
  const fieldMetaLookup = collectFieldMeta(form?.schema || []);
  const parentColumns = [];
  resolveDisplayFieldSettings(form).forEach(({ path, type, optionOrder, fieldId, printTemplateAction: resolvedAction }) => {
    if (!path) return;
    const fieldMeta = (fieldId && fieldMetaLookup.byId.get(fieldId)) || fieldMetaLookup.byPath.get(path) || null;
    if (type === "fileUpload") {
      parentColumns.push(createDisplayColumn(path, type, { optionOrder, fieldId, actionKind: "folderLink", fieldMeta }));
      return;
    }
    if (type === "printTemplate") {
      const action = normalizePrintTemplateAction(resolvedAction ?? fieldMeta?.printTemplateAction);
      parentColumns.push(createDisplayColumn(path, type, {
        optionOrder,
        fieldId,
        actionKind: "printTemplate",
        action,
      }));
      return;
    }
    parentColumns.push(createDisplayColumn(path, type, { optionOrder, fieldId }));
  });
  const columns = [...metaColumns, ...parentColumns];
  if (includeOperations) columns.push(actionsColumn);
  return columns;
};

const normalizeHeaderLabel = (value) => (value === null || value === undefined ? "" : String(value));

const shouldSuppressDuplicateByLeftNeighbor = ({ currentLabel, previousLabel, isAdjacent }) => {
  if (!isAdjacent) return false;
  return currentLabel !== "" && previousLabel !== "" && currentLabel === previousLabel;
};

export const buildHeaderRows = (columns) => {
  if (!columns || columns.length === 0) return [];

  const normalized = columns.map((column) => {
    const segments = Array.isArray(column.segments) ? column.segments : [];
    const limited = segments
      .filter((segment) => segment !== undefined && segment !== null)
      .slice(0, MAX_HEADER_DEPTH)
      .map((segment) => (typeof segment === "string" ? segment : String(segment)));
    if (limited.length === 0) {
      limited.push(String(column.key ?? ""));
    }
    return {
      segments: limited,
      length: limited.length,
    };
  });

  const depth = Math.min(
    MAX_HEADER_DEPTH,
    Math.max(...normalized.map((column) => column.length || 1), 1),
  );

  const perLevel = Array.from({ length: depth }, () => Array(normalized.length).fill(null));

  normalized.forEach(({ segments }, columnIndex) => {
    const limited = segments.slice(0, depth);
    const segmentCount = limited.length;
    for (let level = 0; level < segmentCount; level += 1) {
      const rawLabel = limited[level] ?? "";
      const label = typeof rawLabel === "string" ? rawLabel : String(rawLabel);
      const rowSpan = level === segmentCount - 1 ? Math.max(1, depth - level) : 1;
      perLevel[level][columnIndex] = {
        label,
        rowSpan,
      };
    }
  });

  const rows = [];
  for (let level = 0; level < depth; level += 1) {
    const row = [];
    let colIndex = 0;
    while (colIndex < perLevel[level].length) {
      const cell = perLevel[level][colIndex];
      if (!cell) {
        colIndex += 1;
        continue;
      }
      const isFirstRow = level === 0;
      let colSpan = 1;
      if (!isFirstRow) {
        while (
          colIndex + colSpan < perLevel[level].length &&
          perLevel[level][colIndex + colSpan] &&
          perLevel[level][colIndex + colSpan].label === cell.label &&
          perLevel[level][colIndex + colSpan].rowSpan === cell.rowSpan
        ) {
          colSpan += 1;
        }
      }

      row.push({
        label: cell.label,
        colSpan,
        rowSpan: cell.rowSpan,
        startIndex: colIndex,
        column: isFirstRow ? columns[colIndex] || null : null,
      });

      colIndex += colSpan;
    }
    if (row.length) rows.push(row);
  }

  return rows;
};

export const buildColumnsFromHeaderMatrix = (multiHeaderRows, baseColumns) => {
  if (!multiHeaderRows || multiHeaderRows.length === 0) return baseColumns || [];

  const firstRow = multiHeaderRows[0] || [];
  const result = [];
  const seenKeys = new Set();
  const resolvedBasePaths = new Set();
  const safeBaseColumns = Array.isArray(baseColumns) ? baseColumns : [];

  const pushColumn = (column) => {
    if (!column) return;
    if (column.key && seenKeys.has(column.key)) return;
    result.push(column);
    if (column.key) seenKeys.add(column.key);
  };

  const findBaseColumnByKey = (key) => safeBaseColumns.find((col) => col?.key === key) || null;

  for (let colIndex = 0; colIndex < firstRow.length; colIndex += 1) {
    const headerValue = firstRow[colIndex];
    const headerValueStr = String(headerValue);

    if (headerValueStr === "No.") {
      pushColumn(findBaseColumnByKey("No."));
      continue;
    }
    if (headerValueStr === "id") {
      pushColumn(findBaseColumnByKey("id"));
      continue;
    }
    if (headerValueStr === "createdAt") {
      pushColumn(findBaseColumnByKey("createdAt"));
      continue;
    }
    if (headerValueStr === "modifiedAt") {
      pushColumn(findBaseColumnByKey("modifiedAt"));
      continue;
    }

    const fullPath = buildHeaderFullPath(multiHeaderRows, colIndex);
    if (!fullPath) continue;

    const baseColumn = matchBaseDisplayColumn(safeBaseColumns, fullPath);
    if (!baseColumn) continue;

    if (isChoiceColumn(baseColumn)) {
      const basePath = baseColumn.path ? String(baseColumn.path) : "";
      if (!basePath || resolvedBasePaths.has(basePath)) {
        continue;
      }
      pushColumn(createDisplayColumn(basePath, baseColumn.sourceType));
      resolvedBasePaths.add(basePath);
      debugLog("buildColumnsFromHeaderMatrix:choice", { basePath, columnIndex: colIndex });
    } else {
      pushColumn(createDisplayColumn(fullPath, baseColumn.sourceType));
      if (baseColumn.path) {
        resolvedBasePaths.add(String(baseColumn.path));
      }
    }
  }

  // headerMatrixに存在しない場合でも、ベース列は最低限表示する
  safeBaseColumns.forEach((baseColumn) => {
    if (!baseColumn) return;
    if (baseColumn.key === "__actions" || baseColumn.key === "id" || baseColumn.key === "No." || baseColumn.key === "createdAt" || baseColumn.key === "modifiedAt") return;
    if (!baseColumn.path) return;
    const basePath = String(baseColumn.path);
    if (resolvedBasePaths.has(basePath)) return;
    resolvedBasePaths.add(basePath);
    pushColumn(createDisplayColumn(basePath, baseColumn.sourceType));
  });

  pushColumn(findBaseColumnByKey("__actions"));

  debugLog("buildColumnsFromHeaderMatrix:result", { total: result.length });
  return result;
};

export const buildSearchTableLayout = (
  form,
  { includeOperations = true } = {},
) => {
  const columns = buildSearchColumns(form, { includeOperations });
  const baseHeaderRows = buildHeaderRows(columns);
  const matrix = expandHeaderRowsToMatrix(baseHeaderRows, columns.length);
  const deduped = suppressDuplicateHeaderLabels(matrix);

  const headerRows = deduped.map((row, rowIndex) =>
    padRowToLength(row, columns.length).map((label, colIndex) => ({
      label: normalizeHeaderLabel(label),
      colSpan: 1,
      rowSpan: 1,
      startIndex: colIndex,
      column: rowIndex === 0 ? columns[colIndex] || null : null,
    }))
  );

  return {
    columns,
    headerRows,
  };
};

export const padRowToLength = (row, length) => {
  const base = Array.isArray(row) ? row.slice(0, length) : [];
  while (base.length < length) base.push("");
  return base.map((cell) => (cell === null || cell === undefined ? "" : String(cell)));
};

export const expandHeaderRowsToMatrix = (headerRows, columnCount) => {
  if (!Array.isArray(headerRows) || headerRows.length === 0 || columnCount <= 0) return [];
  const matrix = Array.from({ length: headerRows.length }, () => Array(columnCount).fill(""));
  headerRows.forEach((row, rowIndex) => {
    (row || []).forEach((cell) => {
      if (!cell) return;
      const start = Number(cell.startIndex) || 0;
      if (start < 0 || start >= columnCount) return;
      matrix[rowIndex][start] = cell.label ?? "";
    });
  });
  return matrix;
};

export const suppressDuplicateHeaderLabels = (matrix) => {
  if (!Array.isArray(matrix) || matrix.length === 0) return matrix;
  return matrix.map((row) => {
    if (!Array.isArray(row)) return row;
    const result = [...row];
    for (let i = 0; i < result.length; i += 1) {
      const val = normalizeHeaderLabel(result[i]);
      const prev = i > 0 ? normalizeHeaderLabel(row[i - 1]) : "";
      if (shouldSuppressDuplicateByLeftNeighbor({
        currentLabel: val,
        previousLabel: prev,
        isAdjacent: i > 0,
      })) {
        result[i] = "";
      }
    }
    return result;
  });
};


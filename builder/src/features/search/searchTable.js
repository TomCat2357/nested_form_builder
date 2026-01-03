import { splitFieldPath, collectDisplayFieldSettings } from "../../utils/formPaths.js";
import { DISPLAY_MODES } from "../../core/displayModes.js";
import { formatUnixMsDateTime, formatUnixMsDate, formatUnixMsTime, toUnixMs } from "../../utils/dateTime.js";

export const MAX_HEADER_DEPTH = 6;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SERIAL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);

const FALSE_LIKE_VALUES = new Set([null, undefined, "", false, 0, "0"]);

const toBooleanLike = (value) => {
  if (Array.isArray(value)) {
    return value.some((item) => toBooleanLike(item));
  }
  return !FALSE_LIKE_VALUES.has(value);
};

const columnType = (column) => column?.sourceType || column?.type || "";
const isBooleanColumn = (column) => {
  const type = columnType(column);
  return type === "checkboxes" || type === "radio" || type === "select";
};
const isNumericColumn = (column) => columnType(column) === "number";
const isDateLikeColumn = (column) => {
  const type = columnType(column);
  return type === "date" || type === "time";
};
const parseStrictTimeValue = (value) => {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const utcMs = Date.UTC(1899, 11, 30, hour, minute, 0);
  const date = new Date(utcMs);
  if (date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) return null;
  return (utcMs - SERIAL_EPOCH_UTC_MS) / MS_PER_DAY;
};
const parseStrictDateOrDateTimeValue = (value) => {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:\/(\d{2}):(\d{2}))?$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = match[4] ? parseInt(match[4], 10) : 0;
  const minute = match[5] ? parseInt(match[5], 10) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const date = new Date(utcMs);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return (utcMs - SERIAL_EPOCH_UTC_MS) / MS_PER_DAY;
};
const toNumericValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isDevEnvironment = (() => {
  try {
    if (typeof import.meta !== "undefined" && import.meta.env && typeof import.meta.env.DEV === "boolean") {
      return import.meta.env.DEV;
    }
  } catch (error) {
    // no-op: import.meta may not be available in some runtimes
  }
  if (typeof process !== "undefined" && process.env && typeof process.env.NODE_ENV === "string") {
    return process.env.NODE_ENV !== "production";
  }
  return false;
})();

const debugLog = (...args) => {
  if (!isDevEnvironment) return;
  console.debug("[searchTable]", ...args);
};

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

const columnDisplayMode = (column) => (column?.displayMode === DISPLAY_MODES.COMPACT ? DISPLAY_MODES.COMPACT : DISPLAY_MODES.NORMAL);

const valueToDisplayString = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => valueToDisplayString(item))
      .filter((item) => item !== "" && item !== null && item !== undefined)
      .join("、");
  }
  if (value === null || value === undefined) return "";
  if (value === "") return "";

  return String(value);
};

const formatTemporalValue = (rawValue, unixMs, column) => {
  const type = columnType(column);
  if (type !== "date" && type !== "time") return valueToDisplayString(rawValue);

  const ms = Number.isFinite(unixMs) ? unixMs : toUnixMs(rawValue);
  if (!Number.isFinite(ms)) return valueToDisplayString(rawValue);

  return type === "time" ? formatUnixMsTime(ms) : formatUnixMsDate(ms);
};

const deriveChoiceLabels = (key, value) => {
  if (!toBooleanLike(value)) return null;
  if (typeof key !== "string" || !key.includes("|")) return null;

  const segments = key.split("|").filter(Boolean);
  if (segments.length === 0) return null;

  const optionLabel = segments[segments.length - 1];
  const questionLabel = segments.slice(0, -1).join("|");
  const combinedLabel = questionLabel ? `${questionLabel}:${optionLabel}` : optionLabel;

  return {
    optionLabel,
    combinedLabel,
  };
};

export const formatDateTime = (value) => {
  if (value instanceof Date) return formatUnixMsDateTime(value.getTime());
  const ms = Number.isFinite(value) ? value : toUnixMs(value);
  if (Number.isFinite(ms)) return formatUnixMsDateTime(ms);
  if (typeof value === "string") return value;
  return "";
};

const normalizeSearchText = (text) => String(text || "").toLowerCase();

const buildSearchableCandidates = (key, value, unixMs = undefined) => {
  const candidates = [];
  const displayValue = valueToDisplayString(value, unixMs);
  if (displayValue) {
    candidates.push(displayValue);
  }

  const choiceLabels = deriveChoiceLabels(key, value);
  if (choiceLabels?.optionLabel) {
    candidates.push(choiceLabels.optionLabel);
    if (choiceLabels.combinedLabel && choiceLabels.combinedLabel !== choiceLabels.optionLabel) {
      candidates.push(choiceLabels.combinedLabel);
    }
  }

  return candidates;
};

const deriveBooleanValue = (rawValues) => toBooleanLike(rawValues.length ? rawValues : undefined);

const resolveSortValue = ({ rawValues, display, dataUnixMs, path, column }) => {
  if (isBooleanColumn(column)) {
    return deriveBooleanValue(rawValues) ? 1 : 0;
  }

  if (rawValues.length === 0) return "";
  if (rawValues.length > 1) return display;

  const raw = rawValues[0];

  if (isNumericColumn(column)) {
    const num = toNumericValue(raw);
    if (num !== null) return num;
  }

  return display;
};

const collectImportantFieldValue = (entry, path, column) => {
  const data = entry?.data || {};
  const dataUnixMs = entry?.dataUnixMs || {};

  const values = [];
  const rawValues = [];
  const addValue = (raw, unixMs) => {
    const display = formatTemporalValue(raw, unixMs, column);
    if (display === "" || display === null || display === undefined) return;
    values.push(display);
    rawValues.push(raw);
  };

  // 直接値がある場合はそれを優先
  const hasDirectValue = Object.prototype.hasOwnProperty.call(data, path);

  if (hasDirectValue) {
    addValue(data[path], dataUnixMs[path]);
  } else {
    // 直接値がない場合のみ、option値を探す
    const prefix = `${path}|`;
    const optionValues = [];
    Object.entries(data).forEach(([key, value]) => {
      if (!key.startsWith(prefix) || key === path) return;
      const remainder = key.slice(prefix.length);
      if (!remainder) return;
      const [head, ...rest] = remainder.split("|");
      if (!head || rest.length > 0) return;
      if (toBooleanLike(value)) {
        // チェックボックスの場合はラベル(head)を表示・検索・ソート用に使用
        optionValues.push(head);
      }
    });

    if (optionValues.length) {
      // 値を表示用文字列に変換して追加
      optionValues.forEach((v) => addValue(v));
    }
  }

  const display = values.join("、");
  const sortValue = resolveSortValue({ rawValues, display, dataUnixMs, path, column });

  return {
    display,
    search: normalizeSearchText(values.join(" ")),
    sort: sortValue,
    boolean: deriveBooleanValue(rawValues),
  };
};

const compareStrings = (a, b) => {
  const aa = String(a || "");
  const bb = String(b || "");
  return aa.localeCompare(bb, "ja");
};

const compareValues = (a, b) => {
  // 両方が数値の場合
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  // 片方が数値、もう片方が文字列の場合は数値を優先
  if (typeof a === 'number' && typeof b !== 'number') {
    return -1;
  }
  if (typeof a !== 'number' && typeof b === 'number') {
    return 1;
  }
  // それ以外は文字列として比較
  return compareStrings(a, b);
};

const createBaseColumns = () => [
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
    key: "modifiedAt",
    segments: ["最終更新日時"],
    sortable: true,
    searchable: true,
    getValue: (entry) => {
      const raw = entry?.modifiedAt ?? "";
      const display = formatDateTime(raw);
      return {
        display,
        search: normalizeSearchText(display || raw || ""),
        sort: display || "",
      };
    },
  },
];

const collectCompactFieldValue = (entry, path, column) => {
  const data = entry?.data || {};
  const dataUnixMs = entry?.dataUnixMs || {};
  const values = [];
  const rawValues = [];

  const addValue = (raw, unixMs) => {
    const display = formatTemporalValue(raw, unixMs, column);
    if (display === "" || display === null || display === undefined) return;
    values.push(display);
    rawValues.push(raw);
  };

  const hasDirectValue = Object.prototype.hasOwnProperty.call(data, path);
  if (hasDirectValue) {
    addValue(data[path], dataUnixMs[path]);
  } else {
    const prefix = `${path}|`;
    Object.entries(data).forEach(([key, value]) => {
      if (!key.startsWith(prefix) || key === path) return;
      const remainder = key.slice(prefix.length);
      if (!remainder || remainder.includes("|")) return;
      if (toBooleanLike(value)) {
        addValue(remainder);
      }
    });
  }

  const display = values.join("、");
  const primary = values[0] || "";
  const sortValue = resolveSortValue({ rawValues, display: values.length <= 1 ? primary : display, dataUnixMs, path, column });

  return {
    display,
    search: normalizeSearchText(values.join(" ")),
    sort: sortValue,
    boolean: deriveBooleanValue(rawValues),
  };
};

const createDisplayColumn = (path, mode = DISPLAY_MODES.NORMAL, sourceType = "") => {
  const segments = splitFieldPath(path).slice(0, MAX_HEADER_DEPTH);
  if (segments.length === 0) segments.push("回答");
  const key = `display:${path}`;
  const isCompact = mode === DISPLAY_MODES.COMPACT;
  return {
    key,
    segments,
    sortable: true,
    searchable: true,
    path,
    displayMode: mode,
    sourceType,
    getValue: (entry, column) => (isCompact ? collectCompactFieldValue(entry, path, column) : collectImportantFieldValue(entry, path, column)),
  };
};

const actionsColumn = {
  key: "__actions",
  segments: ["操作"],
  sortable: false,
  searchable: false,
  getValue: () => ({ display: "", search: "", sort: "" }),
};

const resolveDisplayFieldSettings = (form) => {
  if (Array.isArray(form?.displayFieldSettings) && form.displayFieldSettings.length) {
    return form.displayFieldSettings
      .filter((item) => item && item.path)
      .map((item) => ({
        path: String(item.path),
        mode: item.mode === DISPLAY_MODES.COMPACT ? DISPLAY_MODES.COMPACT : DISPLAY_MODES.NORMAL,
        type: item.type || "",
      }));
  }
  const fallback = Array.isArray(form?.importantFields) ? form.importantFields : [];
  const collected = collectDisplayFieldSettings(form?.schema || []);
  return fallback
    .filter((path) => path)
    .map((path) => {
      const matched = collected.find((item) => item.path === path);
      return { path: String(path), mode: DISPLAY_MODES.NORMAL, type: matched?.type || "" };
    });
};

export const buildSearchColumns = (form, { includeOperations = true } = {}) => {
  const columns = createBaseColumns();
  resolveDisplayFieldSettings(form).forEach(({ path, mode, type }) => {
    if (!path) return;
    columns.push(createDisplayColumn(path, mode, type));
  });
  if (includeOperations) columns.push(actionsColumn);
  return columns;
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
      let colSpan = 1;
      while (
        colIndex + colSpan < perLevel[level].length &&
        perLevel[level][colIndex + colSpan] &&
        perLevel[level][colIndex + colSpan].label === cell.label &&
        perLevel[level][colIndex + colSpan].rowSpan === cell.rowSpan
      ) {
        colSpan += 1;
      }

      row.push({
        label: cell.label,
        colSpan,
        rowSpan: cell.rowSpan,
        startIndex: colIndex,
      });

      colIndex += colSpan;
    }
    if (row.length) rows.push(row);
  }

  return rows;
};

/**
 * headerMatrixから表示すべき列のインデックスを抽出
 * @param {Array<Array<string>>} multiHeaderRows - 6行×列数の2次元配列
 * @param {Array} columns - 表示する列の定義
 * @returns {Array<number>} - 表示する列のインデックス配列
 */
const filterVisibleColumnIndices = (multiHeaderRows, columns) => {
  if (!multiHeaderRows || multiHeaderRows.length === 0 || !columns) return [];

  const firstRow = multiHeaderRows[0] || [];
  const visibleIndices = [];
  const compactResolvedPaths = new Set();

  for (let i = 0; i < firstRow.length; i += 1) {
    const headerValue = firstRow[i];
    const headerValueStr = String(headerValue);

    if (headerValueStr === "No." || headerValueStr === "modifiedAt") {
      visibleIndices.push(i);
      continue;
    }

    const fullPath = buildHeaderFullPath(multiHeaderRows, i);
    if (!fullPath) continue;

    const baseColumn = matchBaseDisplayColumn(columns, fullPath);
    if (!baseColumn) continue;

    if (columnDisplayMode(baseColumn) === DISPLAY_MODES.COMPACT) {
      const basePath = baseColumn.path ? String(baseColumn.path) : "";
      if (!basePath || compactResolvedPaths.has(basePath)) {
        continue;
      }
      compactResolvedPaths.add(basePath);
    }

    visibleIndices.push(i);
  }

  debugLog("filterVisibleColumnIndices", {
    visibleCount: visibleIndices.length,
    sample: visibleIndices.slice(0, 10),
  });
  return visibleIndices;
};

/**
 * CSVのマルチヘッダー構造（6行）からテーブルヘッダー行を生成
 * @param {Array<Array<string>>} multiHeaderRows - 6行×列数の2次元配列
 * @param {Array} columns - 表示する列の定義（オプション）
 * @returns {Array<Array<{label: string, colSpan: number, rowSpan: number, startIndex: number}>>}
 */
/**
 * headerMatrixからスプレッドシートの実際の列に対応するcolumns配列を生成
 * @param {Array<Array<string>>} multiHeaderRows - 6行×列数の2次元配列
 * @param {Array} baseColumns - ベースとなる列定義（表示フィールドなど）
 * @returns {Array} スプレッドシートの列に対応するcolumns配列
 */
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
    if (headerValueStr === "modifiedAt") {
      pushColumn(findBaseColumnByKey("modifiedAt"));
      continue;
    }

    const fullPath = buildHeaderFullPath(multiHeaderRows, colIndex);
    if (!fullPath) continue;

    const baseColumn = matchBaseDisplayColumn(safeBaseColumns, fullPath);
    if (!baseColumn) continue;

    if (columnDisplayMode(baseColumn) === DISPLAY_MODES.COMPACT) {
      const basePath = baseColumn.path ? String(baseColumn.path) : "";
      if (!basePath || resolvedBasePaths.has(basePath)) {
        continue;
      }
      pushColumn(createDisplayColumn(basePath, DISPLAY_MODES.COMPACT, baseColumn.sourceType));
      resolvedBasePaths.add(basePath);
      debugLog("buildColumnsFromHeaderMatrix:compact", { basePath, columnIndex: colIndex });
    } else {
      pushColumn(createDisplayColumn(fullPath, baseColumn.displayMode, baseColumn.sourceType));
      if (baseColumn.path) {
        resolvedBasePaths.add(String(baseColumn.path));
      }
    }
  }

  // headerMatrixに存在しない場合でも、ベース列は最低限表示する
  safeBaseColumns.forEach((baseColumn) => {
    if (!baseColumn) return;
    if (baseColumn.key === "__actions" || baseColumn.key === "No." || baseColumn.key === "modifiedAt") return;
    if (!baseColumn.path) return;
    const basePath = String(baseColumn.path);
    if (resolvedBasePaths.has(basePath)) return;
    if (columnDisplayMode(baseColumn) === DISPLAY_MODES.COMPACT) {
      resolvedBasePaths.add(basePath);
      pushColumn(createDisplayColumn(basePath, DISPLAY_MODES.COMPACT, baseColumn.sourceType));
    } else {
      resolvedBasePaths.add(basePath);
      pushColumn(createDisplayColumn(basePath, baseColumn.displayMode, baseColumn.sourceType));
    }
  });

  pushColumn(findBaseColumnByKey("__actions"));

  debugLog("buildColumnsFromHeaderMatrix:result", { total: result.length });
  return result;
};

export const buildHeaderRowsFromCsv = (multiHeaderRows, columns = null) => {
  if (!multiHeaderRows || multiHeaderRows.length === 0) return [];

  // 表示する列のインデックスを取得
  let visibleIndices = null;
  if (columns) {
    visibleIndices = filterVisibleColumnIndices(multiHeaderRows, columns);
    if (visibleIndices.length === 0) return [];
  }

  // 対象列（表示する列のみ）を確定
  const indicesToProcess = visibleIndices || Array.from({ length: multiHeaderRows[0]?.length || 0 }, (_, i) => i);

  // 変換後のヘッダ行（簡略表示で最下段を落とす処理用）
  const transformedRows = multiHeaderRows.map((row) => (row ? [...row] : []));

  // headerMatrixの第1行から各列に対応するcolumnオブジェクトを構築
  const firstRow = multiHeaderRows[0] || [];
  const columnMapping = [];

  for (let i = 0; i < firstRow.length; i += 1) {
    const headerValue = firstRow[i];
    const headerValueStr = String(headerValue);

    let matchedColumn = null;

    if (columns) {
      if (headerValueStr === "No.") {
        matchedColumn = columns.find((col) => col.key === "No.") || null;
      } else if (headerValueStr === "modifiedAt") {
        matchedColumn = columns.find((col) => col.key === "modifiedAt") || null;
      } else {
        const fullPath = buildHeaderFullPath(multiHeaderRows, i);
        if (fullPath) {
          matchedColumn = columns.find((col) => col.path === fullPath) || null;
          if (!matchedColumn) {
            const baseColumn = matchBaseDisplayColumn(columns, fullPath);
            if (baseColumn) {
              if (columnDisplayMode(baseColumn) === DISPLAY_MODES.COMPACT) {
                matchedColumn = createDisplayColumn(baseColumn.path, DISPLAY_MODES.COMPACT, baseColumn.sourceType);
              } else {
                matchedColumn = createDisplayColumn(fullPath, baseColumn.displayMode, baseColumn.sourceType);
              }
            }
          }
        }
      }
    }

    columnMapping[i] = matchedColumn;
  }

  // 簡略表示: 対応する列の「一番下のヘッダーセル」を空欄にする
  const findDeepestRowWithValue = (colIndex) => {
    for (let r = transformedRows.length - 1; r >= 0; r -= 1) {
      const val = transformedRows[r]?.[colIndex];
      if (val !== null && val !== undefined && val !== "") return r;
    }
    return -1;
  };
  indicesToProcess.forEach((colIndex) => {
    const mappedColumn = columnMapping[colIndex];
    if (mappedColumn?.displayMode === DISPLAY_MODES.COMPACT) {
      const deepest = findDeepestRowWithValue(colIndex);
      if (deepest >= 0) {
        transformedRows[deepest][colIndex] = "";
      }
    }
  });

  // 全段表示が原則のため、行はすべて処理する
  const nonEmptyRowIndices = Array.from({ length: transformedRows.length }, (_, idx) => idx);

  const rows = [];
  const lastNonEmptyRowIndex = transformedRows.length - 1;

  // 各列の統合されたパス(全行を結合したもの)を事前に計算
  const columnFullPaths = indicesToProcess.map((colIndex) => {
    let fullPath = buildHeaderFullPath(multiHeaderRows, colIndex);
    const mappedColumn = columnMapping[colIndex];
    if (mappedColumn?.displayMode === DISPLAY_MODES.COMPACT && mappedColumn.path) {
      fullPath = mappedColumn.path;
    }
    return fullPath;
  });

  // 空でない行のみを処理
  for (const rowIndex of nonEmptyRowIndices) {
    const csvRow = transformedRows[rowIndex] || [];
    const row = [];
    let displayIndex = 0;
    let lastRenderedLabel = "";

    for (let i = 0; i < indicesToProcess.length; i++) {
      const colIndex = indicesToProcess[i];
      const mappedColumn = columnMapping[colIndex];
      let cellValue = csvRow[colIndex] || "";

      // modifiedAtを「最終更新日時」に変換
      if (rowIndex === 0 && cellValue === "modifiedAt") {
        cellValue = "最終更新日時";
      }

      const isCompactColumn = mappedColumn?.displayMode === DISPLAY_MODES.COMPACT;
      if (isCompactColumn && rowIndex === lastNonEmptyRowIndex) {
        // 簡略表示では最下段のヘッダーは省略し、データ側で表示する
        cellValue = "";
      }

      // ラジオ/セレクトの選択肢行はヘッダー表示しない（データ側で表示されるため）
      if (mappedColumn?.sourceType && (mappedColumn.sourceType === "radio" || mappedColumn.sourceType === "select")) {
        const fullPath = columnFullPaths[i] || "";
        const segments = splitFieldPath(fullPath);
        const expectedLabel = segments[rowIndex] || "";
        if (expectedLabel && cellValue === expectedLabel && rowIndex === segments.length - 1) {
          cellValue = "";
        }
      }

      // 最終行の場合は各列を個別に処理(ソート対応のため)
      const isLastRow = rowIndex === lastNonEmptyRowIndex;
      let colSpan = 1;

      if (!isLastRow) {
        // 最終行以外は同じ値が連続する場合はcolSpanでまとめる
        while (
          i + colSpan < indicesToProcess.length &&
          indicesToProcess[i + colSpan] === indicesToProcess[i] + colSpan &&
          (csvRow[indicesToProcess[i + colSpan]] || "") === (csvRow[colIndex] || "")
        ) {
          colSpan += 1;
        }
      }

      // 最終行の場合のみcolumnオブジェクトを付与
      const column = isLastRow ? mappedColumn : null;

      // すべての行で、左に同じ文字列があれば空白化（連続重複を抑止）
      let displayLabel = cellValue;
      if (displayLabel && lastRenderedLabel === displayLabel) {
        displayLabel = "";
      }

      row.push({
        label: displayLabel,
        colSpan,
        rowSpan: 1,
        startIndex: displayIndex,
        column: column,
        originalLabel: cellValue, // ソート用に元のラベルを保持
      });

      displayIndex += colSpan;
      if (displayLabel) {
        lastRenderedLabel = displayLabel;
      }
      i += colSpan - 1;
    }

    if (row.length > 0) rows.push(row);
  }

  // すべて空ラベルの行は除外（簡略表示で最下段を省いた場合の余白を削除）
  const filteredRows = rows.filter((row) => row.some((cell) => cell.label));

  return filteredRows;
};

export const computeRowValues = (entry, columns) => {
  const values = {};
  (columns || []).forEach((column) => {
    if (!column || !column.key) return;
    if (typeof column.getValue !== "function") {
      values[column.key] = { display: "", search: "", sort: "" };
      return;
    }
    values[column.key] = column.getValue(entry, column) || { display: "", search: "", sort: "" };
  });
  return values;
};

export const compareByColumn = (a, b, column, order = "asc") => {
  if (!column || column.sortable === false) return 0;
  const sortableA = a?.values?.[column.key]?.sort ?? "";
  const sortableB = b?.values?.[column.key]?.sort ?? "";
  const result = compareValues(sortableA, sortableB);
  const finalResult = order === "asc" ? result : -result;
  return finalResult;
};

export const buildDisplayText = (value) => valueToDisplayString(value);

export const applyDisplayLengthLimit = (text, limit) => {
  if (typeof text !== "string") return text ?? "";
  const maxLength = Number(limit);
  if (!Number.isFinite(maxLength) || maxLength <= 0) return text;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
};

export const parseSearchCellDisplayLimit = (rawValue) => {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

/**
 * 検索クエリをトークン化
 * 例: '氏名:"山田" and (年齢>=20 or 性別:男性)'
 */
const tokenizeSearchQuery = (query) => {
  if (!query || typeof query !== 'string') return [];

  const tokens = [];
  const normalizedQuery = query.replace(/==/g, "=");
  let i = 0;
  const len = normalizedQuery.length;

  const pushAlwaysFalse = () => {
    tokens.push({ type: 'ALWAYS_FALSE' });
  };

  while (i < len) {
    const char = normalizedQuery[i];

    // 空白をスキップ
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // 括弧
    if (char === '(' || char === ')') {
      tokens.push({ type: char === '(' ? 'LPAREN' : 'RPAREN', value: char });
      i++;
      continue;
    }

    // NOT演算子（後続が空白または括弧のみ許容）
    const remainingForNot = normalizedQuery.slice(i);
    const notMatch = remainingForNot.match(/^(not)(?=[\s(])/i);
    if (notMatch) {
      tokens.push({ type: 'NOT', value: 'not' });
      i += notMatch[0].length;
      continue;
    }

    // AND/OR演算子
    const remaining = normalizedQuery.slice(i);
    if (/^(and|AND)\b/i.test(remaining)) {
      tokens.push({ type: 'AND', value: 'and' });
      i += 3;
      continue;
    }
    if (/^(or|OR)\b/i.test(remaining)) {
      tokens.push({ type: 'OR', value: 'or' });
      i += 2;
      continue;
    }

    // 条件式のトークン化
    // パターン1: 列名:/正規表現/
    const regexMatch = remaining.match(/^([^:()]+?):\/(.+?)\//);
    if (regexMatch) {
      const colName = regexMatch[1].trim().replace(/^["']|["']$/g, '');
      const pattern = regexMatch[2];
      tokens.push({ type: 'REGEX', column: colName, pattern });
      i += regexMatch[0].length;
      continue;
    }

    // パターン2: 列名[演算子]値（数値・等価比較用。":" "=" "==" 同義）
    // 引用符で囲まれた値はスペースを含めて全体を取得
    let operatorMatch = remaining.match(/^([^:()]+?)(>=|<=|<>|><|!=|>|<|=|:|==)"([^"]*)"(?=\s|$|and|AND|or|OR|\))/i);
    if (!operatorMatch) {
      operatorMatch = remaining.match(/^([^:()]+?)(>=|<=|<>|><|!=|>|<|=|:|==)'([^']*)'(?=\s|$|and|AND|or|OR|\))/i);
    }
    if (!operatorMatch) {
      operatorMatch = remaining.match(/^([^:()]+?)(>=|<=|<>|><|!=|>|<|=|:|==)(.+?)(?=\s|$|and|AND|or|OR|\))/i);
    }
    if (operatorMatch) {
      const colName = operatorMatch[1].trim().replace(/^["']|["']$/g, '');
      const operator = operatorMatch[2];
      let value = operatorMatch[3].trim().replace(/^["']|["']$/g, '');
      if (value === "") {
        pushAlwaysFalse();
        i += operatorMatch[0].length;
        continue;
      }
      const normalized = value.toLowerCase();
      const op = operator === ":" || operator === "==" ? "=" : operator;

      // 真偽指定（=のみ）
      if ((normalized === "true" || normalized === "false") && (op === "=")) {
        tokens.push({ type: 'COLUMN_BOOL', column: colName, value: normalized === "true" });
        i += operatorMatch[0].length;
        continue;
      }

      // 数値比較か判定（= / > / < 等でも数値優先）
      const num = Number(value);
      const isNumeric = Number.isFinite(num);
      if (!isNumeric && op === "=") {
        // 文字列として扱う → COLUMN_PARTIAL（含有）に回す
        tokens.push({ type: 'COLUMN_PARTIAL', column: colName, keyword: value });
        i += operatorMatch[0].length;
        continue;
      }

      tokens.push({ type: 'COMPARE', column: colName, operator: op, value });
      i += operatorMatch[0].length;
      continue;
    }

    // パターン3: 列名:部分一致ワード
    const colonMatch = remaining.match(/^([^:()]+?):(.*?)(?=\s|$|and|AND|or|OR|\))/i);
    if (colonMatch) {
      const colName = colonMatch[1].trim().replace(/^["']|["']$/g, '');
      const keywordRaw = colonMatch[2].trim();
      const keyword = keywordRaw.replace(/^["']|["']$/g, '');
      if (!keyword) {
        pushAlwaysFalse();
        i += colonMatch[0].length;
        continue;
      }
      const normalized = keyword.toLowerCase();
      if (normalized === "true" || normalized === "false") {
        tokens.push({ type: 'COLUMN_BOOL', column: colName, value: normalized === "true" });
      } else {
        tokens.push({ type: 'COLUMN_PARTIAL', column: colName, keyword });
      }
      i += colonMatch[0].length;
      continue;
    }

    // パターン4: 部分一致ワード（列名なし）
    const wordMatch = remaining.match(/^(.+?)(?=\s|$|and|AND|or|OR|\))/i);
    if (wordMatch) {
      const keyword = wordMatch[1].trim().replace(/^["']|["']$/g, '');
      if (keyword) {
        tokens.push({ type: 'PARTIAL', keyword });
        i += wordMatch[0].length;
        continue;
      }
    }

    // マッチしない場合は1文字進む
    i++;
  }

  return tokens;
};

/**
 * トークン列をASTに変換（再帰下降パーサー）
 */
const parseTokens = (tokens) => {
  let pos = 0;

  const parseExpression = () => {
    let left = parseTerm();

    while (pos < tokens.length && tokens[pos].type === 'OR') {
      pos++; // 'OR'をスキップ
      const right = parseTerm();
      left = { type: 'OR', left, right };
    }

    return left;
  };

  const parseTerm = () => {
    let left = parseFactor();

    while (pos < tokens.length && tokens[pos].type === 'AND') {
      pos++; // 'AND'をスキップ
      const right = parseFactor();
      left = { type: 'AND', left, right };
    }

    return left;
  };

  const parseFactor = () => {
    const token = tokens[pos];

    if (!token) {
      return { type: 'EMPTY' };
    }

    if (token.type === 'NOT') {
      pos++;
      const expr = parseFactor();
      return { type: 'NOT', value: expr };
    }

    // 括弧で囲まれた式
    if (token.type === 'LPAREN') {
      pos++; // '('をスキップ
      const expr = parseExpression();
      if (pos < tokens.length && tokens[pos].type === 'RPAREN') {
        pos++; // ')'をスキップ
      }
      return expr;
    }

    // 条件
    if (['PARTIAL', 'COLUMN_PARTIAL', 'COMPARE', 'REGEX', 'COLUMN_BOOL', 'ALWAYS_FALSE'].includes(token.type)) {
      pos++;
      return token;
    }

    return { type: 'EMPTY' };
  };

  if (tokens.length === 0) {
    return { type: 'EMPTY' };
  }

  return parseExpression();
};

/**
 * 列名から対応するcolumnオブジェクトを取得
 */
const findColumnByName = (columns, colName) => {
  if (!columns || !colName) return null;

  const normalized = colName.trim().toLowerCase();

  return columns.find(col => {
    // key名でマッチング
    if (col.key && col.key.toLowerCase() === normalized) return true;

    // path名でマッチング
    if (col.path && col.path.toLowerCase() === normalized) return true;

    // segments（表示名）でマッチング
    if (col.segments && Array.isArray(col.segments)) {
      const lastSegment = col.segments[col.segments.length - 1];
      if (lastSegment && lastSegment.toLowerCase() === normalized) return true;

      // 全セグメントを結合してマッチング
      const fullName = col.segments.join('|').toLowerCase();
      if (fullName === normalized) return true;
    }

    return false;
  });
};

const findMatchingEntryField = (row, columnName) => {
  const entryData = row?.entry?.data || {};
  const entryDataUnixMs = row?.entry?.dataUnixMs || {};
  const normalizedColName = (columnName || "").toLowerCase();
  if (!normalizedColName) return null;

  const matchingKey = Object.keys(entryData).find((key) => {
    const lower = key.toLowerCase();
    return lower === normalizedColName || lower.includes(normalizedColName);
  });

  if (!matchingKey) return null;

  return {
    key: matchingKey,
    value: entryData[matchingKey],
    unixMs: entryDataUnixMs[matchingKey],
  };
};

const candidateMatches = (field, predicate) => {
  if (!field) return false;
  return buildSearchableCandidates(field.key, field.value, field.unixMs).some(predicate);
};

/**
 * 日時文字列をタイムスタンプに変換（JSTとして扱う）
 * @param {string} dateStr - 日時文字列（ISO 8601、YYYY-MM-DD、YYYY-MM-DD HH:MM形式）
 * @returns {number|null} - タイムスタンプ（ミリ秒）またはnull
 */
/**
 * 値の比較（数値/文字列/日時を適切に処理）
 */
const compareValue = (rowValue, operator, targetValue, { allowNumeric = true } = {}) => {
  // 値の正規化
  const normalizeValue = (val) => {
    if (val === null || val === undefined || val === '') return '';
    return String(val);
  };

  let normalizedOperator = operator;
  if (operator === ':' || operator === '==') normalizedOperator = '=';
  if (operator === '!=') normalizedOperator = '<>';
  if (operator === '><') normalizedOperator = '<>';

  const rowStr = normalizeValue(rowValue);
  const targetStr = normalizeValue(targetValue);

  // 両方が数値として解釈できる場合は数値比較
  const rowNum = parseFloat(rowStr);
  const targetNum = parseFloat(targetStr);
  const bothNumbers = !Number.isNaN(rowNum) && !Number.isNaN(targetNum);

  // 引用符で囲まれていない数値の場合は数値比較
  const isQuoted = /^["']/.test(targetValue);

  if (allowNumeric && normalizedOperator !== '=' && normalizedOperator !== '<>' && normalizedOperator !== '><') {
    if (!bothNumbers || isQuoted) {
      return false;
    }
  }

  switch (normalizedOperator) {
    case '=':
      if (allowNumeric && bothNumbers && !isQuoted) return rowNum === targetNum;
      return rowStr === targetStr;

    case '<>':
    case '><':
      if (allowNumeric && bothNumbers && !isQuoted) return rowNum !== targetNum;
      return rowStr !== targetStr;

    case '>':
      if (allowNumeric && bothNumbers && !isQuoted) return rowNum > targetNum;
      return rowStr > targetStr;

    case '>=':
      if (allowNumeric && bothNumbers && !isQuoted) return rowNum >= targetNum;
      return rowStr >= targetStr;

    case '<':
      if (allowNumeric && bothNumbers && !isQuoted) return rowNum < targetNum;
      return rowStr < targetStr;

    case '<=':
      if (allowNumeric && bothNumbers && !isQuoted) return rowNum <= targetNum;
      return rowStr <= targetStr;

    default:
      return false;
  }
};

const resolveBooleanValueForRow = (row, column, columnName) => {
  const collectFromEntry = (entryData, target) => {
    const targetLower = String(target || "").toLowerCase();
    let found = false;
    let truthy = false;
    Object.entries(entryData || {}).forEach(([key, value]) => {
      const lower = String(key).toLowerCase();
      if (lower === targetLower || lower.startsWith(`${targetLower}|`)) {
        found = true;
        if (toBooleanLike(value)) truthy = true;
      }
    });
    if (!found) return null;
    return truthy;
  };

  if (column) {
    const cellValue = row?.values?.[column.key];
    if (typeof cellValue?.boolean === "boolean") return cellValue.boolean;
    if (isBooleanColumn(column)) {
      if (cellValue?.sort === 1) return true;
      if (cellValue?.sort === 0) return false;
    }
    if (cellValue && Object.prototype.hasOwnProperty.call(cellValue, "display")) {
      return toBooleanLike(cellValue.display);
    }
  }

  const entryData = row?.entry?.data || {};
  const boolFromEntry = collectFromEntry(entryData, columnName);
  if (boolFromEntry !== null) return boolFromEntry;

  return false;
};

/**
 * ASTを評価して行がマッチするか判定
 */
const evaluateAST = (ast, row, columns) => {
  if (!ast || ast.type === 'EMPTY') return true;

  switch (ast.type) {
    case 'NOT':
      return !evaluateAST(ast.value, row, columns);

    case 'AND':
      return evaluateAST(ast.left, row, columns) && evaluateAST(ast.right, row, columns);

    case 'OR':
      return evaluateAST(ast.left, row, columns) || evaluateAST(ast.right, row, columns);

    case 'PARTIAL': {
      // 全列に対してOR検索（表示列だけでなく、全データフィールドも対象）
      const keyword = normalizeSearchText(ast.keyword);
      if (!keyword) return true;

      // まず表示されている列を検索
      const matchesInColumns = (columns || []).some((column) => {
        if (column.searchable === false) return false;
        const text = row?.values?.[column.key]?.search;
        if (!text) return false;
        return text.includes(keyword);
      });

      if (matchesInColumns) return true;

      // 表示列で見つからなかった場合、全データフィールドを検索
      const entryData = row?.entry?.data || {};
      const entryDataUnixMs = row?.entry?.dataUnixMs || {};

      return Object.entries(entryData).some(([key, value]) => {
        const unixMs = entryDataUnixMs[key];
        return buildSearchableCandidates(key, value, unixMs).some((candidate) => {
          if (!candidate) return false;
          const normalized = normalizeSearchText(candidate);
          return normalized.includes(keyword);
        });
      });
    }

    case 'COLUMN_PARTIAL': {
      // 指定列に対して部分一致検索
      const column = findColumnByName(columns, ast.column);
      if (!ast.keyword) return false;

      // 表示列から検索
      if (column) {
        const text = row?.values?.[column.key]?.search;
        if (text) {
          const keyword = normalizeSearchText(ast.keyword);
          return text.includes(keyword);
        }
      }

      // 表示列にない場合、データフィールドから直接検索
      const entryField = findMatchingEntryField(row, ast.column);
      if (!entryField) return false;
      const keyword = normalizeSearchText(ast.keyword);
      return candidateMatches(entryField, (candidate) => {
        if (!candidate) return false;
        const normalized = normalizeSearchText(candidate);
        return normalized.includes(keyword);
      });
    }

    case 'COLUMN_BOOL': {
      const column = findColumnByName(columns, ast.column);
      const boolValue = resolveBooleanValueForRow(row, column, ast.column);
      return boolValue === ast.value;
    }

    case 'COMPARE': {
      // 指定列に対して比較演算
      const column = findColumnByName(columns, ast.column);
      if (ast.value === "") return false;

      // 表示列から取得
      if (column) {
        const cellValue = row?.values?.[column.key];
        // sort値を使用（数値の場合は数値、文字列の場合は文字列）
        const rowValue = cellValue?.sort ?? cellValue?.display ?? '';
        if (isDateLikeColumn(column)) {
          const type = columnType(column);
          const parser = type === "time" ? parseStrictTimeValue : parseStrictDateOrDateTimeValue;
          const rowMs = parser(rowValue);
          const targetMs = parser(ast.value);
          if (!Number.isFinite(rowMs) || !Number.isFinite(targetMs)) return false;
          return compareValue(rowMs, ast.operator, targetMs, { allowNumeric: true });
        }

        const numericPossible = Number.isFinite(Number(rowValue)) && Number.isFinite(Number(ast.value));
        const allowNumeric = isNumericColumn(column) || typeof rowValue === "number" || numericPossible;

        if (rowValue !== '') {
          return compareValue(rowValue, ast.operator, ast.value, { allowNumeric });
        }
      }

      // 表示列にない場合、データフィールドから直接取得
      const entryField = findMatchingEntryField(row, ast.column);
      if (!entryField) return false;

      return candidateMatches(entryField, (candidate) => {
        if (candidate === undefined || candidate === null || candidate === "") return false;
        const numCandidate = Number(candidate);
        const numTarget = Number(ast.value);
        const allowNumericCandidate = Number.isFinite(numCandidate) && Number.isFinite(numTarget);
        return compareValue(candidate, ast.operator, ast.value, { allowNumeric: allowNumericCandidate });
      });
    }

    case 'REGEX': {
      // 指定列に対して正規表現検索
      const column = findColumnByName(columns, ast.column);
      if (!ast.pattern) return false;

      // 表示列から検索
      if (column) {
        const text = row?.values?.[column.key]?.display ?? '';
        if (text) {
          try {
            const regex = new RegExp(ast.pattern, 'i');
            return regex.test(text);
          } catch (error) {
            console.warn('Invalid regex pattern:', ast.pattern, error);
            return false;
          }
        }
      }

      // 表示列にない場合、データフィールドから直接検索
      const entryField = findMatchingEntryField(row, ast.column);
      if (!entryField) return false;

      try {
        const regex = new RegExp(ast.pattern, 'i');
        return candidateMatches(entryField, (candidate) => (candidate ? regex.test(candidate) : false));
      } catch (error) {
        console.warn('Invalid regex pattern:', ast.pattern, error);
        return false;
      }
    }

    default:
      if (ast.type === 'ALWAYS_FALSE') return false;
      return true;
  }
};

/**
 * 検索クエリに基づいて行をフィルタリング
 *
 * 検索パターン:
 * 1. {部分一致ワード} - 全テキスト列でOR検索
 * 2. {列名}:{部分一致ワード} - 指定列で部分一致検索
 * 3. {列名}[>|>=|=|<=|<|<>|><|!=]{値} - 指定列で比較演算
 * 4. {列名}:/{正規表現}/ - 指定列で正規表現検索
 * 5. 上記をand/orで連結、()で優先順位制御可能
 *
 * 例:
 * - "山田" → 全列から"山田"を含む行
 * - "氏名:山田" → 氏名列から"山田"を含む行
 * - "年齢>=20" → 年齢が20以上の行
 * - "氏名:/^山/" → 氏名が"山"で始まる行
 * - "氏名:山田 and 年齢>=20" → 氏名に"山田"を含み、年齢が20以上
 * - "(氏名:山田 or 氏名:田中) and 年齢>=20" → (氏名に"山田"または"田中")かつ年齢が20以上
 */
export const matchesKeyword = (row, columns, keyword) => {
  if (!keyword || typeof keyword !== 'string') return true;
  if (!keyword.trim()) return true;

  // トークン化
  const tokens = tokenizeSearchQuery(keyword);

  // パース
  const ast = parseTokens(tokens);

  // 評価
  return evaluateAST(ast, row, columns);
};

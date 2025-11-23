import { splitFieldPath } from "../../utils/formPaths.js";
import { DISPLAY_MODES } from "../../core/displayModes.js";
import { formatUnixMsDateTime, toUnixMs } from "../../utils/dateTime.js";

export const MAX_HEADER_DEPTH = 6;

const TRUTHY_SET = new Set([true, "true", "TRUE", "True", 1, "1", "●"]);
const FALSY_SET = new Set([false, "false", "FALSE", "False", 0, "0", null, undefined, ""]);

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

const valueToDisplayString = (value, unixMs) => {
  if (Array.isArray(value)) {
    return value.map((item) => valueToDisplayString(item, unixMs)).filter(Boolean).join("、");
  }
  if (FALSY_SET.has(value)) return "";
  if (value === null || value === undefined) return "";

  if (Number.isFinite(unixMs)) return formatUnixMsDateTime(unixMs);
  if (value instanceof Date) return formatUnixMsDateTime(value.getTime());
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?/.test(value)) {
    const parsed = toUnixMs(value);
    if (Number.isFinite(parsed)) return formatUnixMsDateTime(parsed);
  }

  return String(value);
};

export const formatDateTime = (unixMs) => formatUnixMsDateTime(Number.isFinite(unixMs) ? unixMs : toUnixMs(unixMs));

const normalizeSearchText = (text) => String(text || "").toLowerCase();

const collectImportantFieldValue = (entry, path) => {
  const data = entry?.data || {};
  const dataUnixMs = entry?.dataUnixMs || {};

  const values = [];
  const rawValues = [];
  const addValue = (raw, unixMs) => {
    const display = valueToDisplayString(raw, unixMs);
    if (!display) return;
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
      if (TRUTHY_SET.has(value)) {
        // チェックボックスの場合はラベル(head)を表示・検索・ソート用に使用
        optionValues.push(head);
        return;
      }
    });

    if (optionValues.length) {
      // 値を表示用文字列に変換して追加
      optionValues.forEach((v) => addValue(v));
    }
  }

  const display = values.join("、");

  // ソート用の値を決定
  let sortValue;
  if (rawValues.length === 0) {
    sortValue = "";
  } else if (rawValues.length === 1) {
    const raw = rawValues[0];
    // ブーリアン値の場合
    if (TRUTHY_SET.has(raw)) {
      sortValue = 1;
    } else if (FALSY_SET.has(raw)) {
      sortValue = 0;
    } else if (typeof raw === 'number') {
      sortValue = raw;
    } else {
      // 日付形式はUnix msを優先
      const unix = dataUnixMs[path] ?? toUnixMs(raw);
      if (Number.isFinite(unix)) {
        sortValue = unix;
      } else {
        // それ以外で数値に変換できる場合は数値として扱う
        const num = parseFloat(raw);
        sortValue = !Number.isNaN(num) ? num : display;
      }
    }
  } else {
    // 複数の値がある場合は表示文字列をソート値とする
    sortValue = display;
  }

  return {
    display,
    search: normalizeSearchText(values.join(" ")),
    sort: sortValue,
  };
};;;

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
      const unix = Number.isFinite(entry?.modifiedAtUnixMs) ? entry.modifiedAtUnixMs : toUnixMs(entry?.modifiedAt);
      const display = formatDateTime(unix);
      return {
        display,
        search: normalizeSearchText(display || unix || ""),
        sort: Number.isFinite(unix) ? unix : 0,
      };
    },
  },
];

const collectCompactFieldValue = (entry, path) => {
  const data = entry?.data || {};
  const values = [];

  const addValue = (raw) => {
    const display = valueToDisplayString(raw);
    if (!display) return;
    values.push(display);
  };

  const hasDirectValue = Object.prototype.hasOwnProperty.call(data, path);
  if (hasDirectValue) {
    addValue(data[path]);
  } else {
    const prefix = `${path}|`;
    Object.entries(data).forEach(([key, value]) => {
      if (!key.startsWith(prefix) || key === path) return;
      const remainder = key.slice(prefix.length);
      if (!remainder || remainder.includes("|")) return;
      if (TRUTHY_SET.has(value)) {
        addValue(remainder);
      }
    });
  }

  const display = values.join("、");
  const primary = values[0] || "";
  const sortValue = values.length <= 1 ? primary : display;

  return {
    display,
    search: normalizeSearchText(values.join(" ")),
    sort: sortValue,
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
    getValue: (entry) => (isCompact ? collectCompactFieldValue(entry, path) : collectImportantFieldValue(entry, path)),
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
      }));
  }
  const fallback = Array.isArray(form?.importantFields) ? form.importantFields : [];
  return fallback
    .filter((path) => path)
    .map((path) => ({ path: String(path), mode: DISPLAY_MODES.NORMAL }));
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
  let i = 0;
  const len = query.length;

  while (i < len) {
    const char = query[i];

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

    // AND/OR演算子
    const remaining = query.slice(i);
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

    // パターン2: 列名[演算子]値
    // 引用符で囲まれた値はスペースを含めて全体を取得
    let operatorMatch = remaining.match(/^([^:()]+?)(>=|<=|<>|><|!=|>|<|=)"([^"]+)"(?=\s|$|and|AND|or|OR|\))/i);
    if (!operatorMatch) {
      operatorMatch = remaining.match(/^([^:()]+?)(>=|<=|<>|><|!=|>|<|=)'([^']+)'(?=\s|$|and|AND|or|OR|\))/i);
    }
    if (!operatorMatch) {
      operatorMatch = remaining.match(/^([^:()]+?)(>=|<=|<>|><|!=|>|<|=)(.+?)(?=\s|$|and|AND|or|OR|\))/i);
    }
    if (operatorMatch) {
      const colName = operatorMatch[1].trim().replace(/^["']|["']$/g, '');
      const operator = operatorMatch[2];
      let value = operatorMatch[3].trim().replace(/^["']|["']$/g, '');
      tokens.push({ type: 'COMPARE', column: colName, operator, value });
      i += operatorMatch[0].length;
      continue;
    }

    // パターン3: 列名:部分一致ワード
    const colonMatch = remaining.match(/^([^:()]+?):(.+?)(?=\s|$|and|AND|or|OR|\))/i);
    if (colonMatch) {
      const colName = colonMatch[1].trim().replace(/^["']|["']$/g, '');
      const keyword = colonMatch[2].trim().replace(/^["']|["']$/g, '');
      tokens.push({ type: 'COLUMN_PARTIAL', column: colName, keyword });
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
    if (['PARTIAL', 'COLUMN_PARTIAL', 'COMPARE', 'REGEX'].includes(token.type)) {
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

/**
 * 日時文字列をタイムスタンプに変換（JSTとして扱う）
 * @param {string} dateStr - 日時文字列（ISO 8601、YYYY-MM-DD、YYYY-MM-DD HH:MM形式）
 * @returns {number|null} - タイムスタンプ（ミリ秒）またはnull
 */
const parseJSTDateTime = (dateStr) => {
  const ms = toUnixMs(dateStr);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * 値の比較（数値/文字列/日時を適切に処理）
 */
const compareValue = (rowValue, operator, targetValue) => {
  // 値の正規化
  const normalizeValue = (val) => {
    if (val === null || val === undefined || val === '') return '';
    return String(val);
  };

  const rowStr = normalizeValue(rowValue);
  const targetStr = normalizeValue(targetValue);

  // 日時比較を試みる
  const rowTimestamp = parseJSTDateTime(rowStr);
  const targetTimestamp = parseJSTDateTime(targetStr);

  if (rowTimestamp !== null && targetTimestamp !== null) {
    // 両方が日時として解釈できる場合は、タイムスタンプで数値比較
    let result;
    switch (operator) {
      case '=':
        result = rowTimestamp === targetTimestamp;
        break;
      case '!=':
      case '<>':
      case '><':
        result = rowTimestamp !== targetTimestamp;
        break;
      case '>':
        result = rowTimestamp > targetTimestamp;
        break;
      case '>=':
        result = rowTimestamp >= targetTimestamp;
        break;
      case '<':
        result = rowTimestamp < targetTimestamp;
        break;
      case '<=':
        result = rowTimestamp <= targetTimestamp;
        break;
      default:
        result = false;
    }
    return result;
  }

  // 両方が数値として解釈できる場合は数値比較
  const rowNum = parseFloat(rowStr);
  const targetNum = parseFloat(targetStr);
  const bothNumbers = !Number.isNaN(rowNum) && !Number.isNaN(targetNum);

  // 引用符で囲まれていない数値の場合は数値比較
  const isQuoted = /^["']/.test(targetValue);

  switch (operator) {
    case '=':
      if (bothNumbers && !isQuoted) return rowNum === targetNum;
      return rowStr === targetStr;

    case '!=':
    case '<>':
    case '><':
      if (bothNumbers && !isQuoted) return rowNum !== targetNum;
      return rowStr !== targetStr;

    case '>':
      if (bothNumbers && !isQuoted) return rowNum > targetNum;
      return rowStr > targetStr;

    case '>=':
      if (bothNumbers && !isQuoted) return rowNum >= targetNum;
      return rowStr >= targetStr;

    case '<':
      if (bothNumbers && !isQuoted) return rowNum < targetNum;
      return rowStr < targetStr;

    case '<=':
      if (bothNumbers && !isQuoted) return rowNum <= targetNum;
      return rowStr <= targetStr;

    default:
      return false;
  }
};

/**
 * ASTを評価して行がマッチするか判定
 */
const evaluateAST = (ast, row, columns) => {
  if (!ast || ast.type === 'EMPTY') return true;

  switch (ast.type) {
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
      return Object.values(entryData).some((value) => {
        const displayValue = valueToDisplayString(value);
        if (!displayValue) return false;
        const normalized = normalizeSearchText(displayValue);
        return normalized.includes(keyword);
      });
    }

    case 'COLUMN_PARTIAL': {
      // 指定列に対して部分一致検索
      const column = findColumnByName(columns, ast.column);

      // 表示列から検索
      if (column) {
        const text = row?.values?.[column.key]?.search;
        if (text) {
          const keyword = normalizeSearchText(ast.keyword);
          return text.includes(keyword);
        }
      }

      // 表示列にない場合、データフィールドから直接検索
      const entryData = row?.entry?.data || {};
      const normalizedColName = ast.column.toLowerCase();

      // データフィールドのキーで検索（完全一致または部分一致）
      const matchingKey = Object.keys(entryData).find(key =>
        key.toLowerCase() === normalizedColName ||
        key.toLowerCase().includes(normalizedColName)
      );

      if (matchingKey) {
        const value = entryData[matchingKey];
        const displayValue = valueToDisplayString(value);
        if (!displayValue) return false;
        const normalized = normalizeSearchText(displayValue);
        const keyword = normalizeSearchText(ast.keyword);
        return normalized.includes(keyword);
      }

      return false;
    }

    case 'COMPARE': {
      // 指定列に対して比較演算
      const column = findColumnByName(columns, ast.column);

      // 表示列から取得
      if (column) {
        const cellValue = row?.values?.[column.key];
        // sort値を使用（数値の場合は数値、文字列の場合は文字列）
        const rowValue = cellValue?.sort ?? cellValue?.display ?? '';

        if (rowValue !== '') {
          return compareValue(rowValue, ast.operator, ast.value);
        }
      }

      // 表示列にない場合、データフィールドから直接取得
      const entryData = row?.entry?.data || {};
      const normalizedColName = ast.column.toLowerCase();

      // データフィールドのキーで検索
      const matchingKey = Object.keys(entryData).find(key =>
        key.toLowerCase() === normalizedColName ||
        key.toLowerCase().includes(normalizedColName)
      );

      if (matchingKey) {
        const value = entryData[matchingKey];
        const displayValue = valueToDisplayString(value);

        // 数値変換を試みる
        const numValue = parseFloat(displayValue);
        const rowValue = !Number.isNaN(numValue) ? numValue : displayValue;

        return compareValue(rowValue, ast.operator, ast.value);
      }

      return false;
    }

    case 'REGEX': {
      // 指定列に対して正規表現検索
      const column = findColumnByName(columns, ast.column);

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
      const entryData = row?.entry?.data || {};
      const normalizedColName = ast.column.toLowerCase();

      // データフィールドのキーで検索
      const matchingKey = Object.keys(entryData).find(key =>
        key.toLowerCase() === normalizedColName ||
        key.toLowerCase().includes(normalizedColName)
      );

      if (matchingKey) {
        const value = entryData[matchingKey];
        const displayValue = valueToDisplayString(value);

        try {
          const regex = new RegExp(ast.pattern, 'i');
          return regex.test(displayValue);
        } catch (error) {
          console.warn('Invalid regex pattern:', ast.pattern, error);
          return false;
        }
      }

      return false;
    }

    default:
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

function Sheets_getOrCreateSheet_(spreadsheetId, sheetName) {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");

  var ss;
  try {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } catch (err) {
    throw new Error(Sheets_translateOpenError_(err, spreadsheetId));
  }
  var resolvedSheetName = sheetName || NFB_DEFAULT_SHEET_NAME;
  var sheet = ss.getSheetByName(resolvedSheetName);
  return sheet || ss.insertSheet(resolvedSheetName);
}

function Sheets_ensureRowCapacity_(sheet, minRows) {
  if (sheet.getMaxRows() < minRows) {
    sheet.insertRowsAfter(sheet.getMaxRows() || 1, minRows - sheet.getMaxRows());
  }
}

function Sheets_ensureColumnExists_(sheet, columnCount) {
  if (sheet.getMaxColumns() < columnCount) {
    sheet.insertColumnsAfter(sheet.getMaxColumns() || 1, columnCount - sheet.getMaxColumns());
  }
}

function Sheets_readHeaderMatrix_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) {
    Sheets_ensureColumnExists_(sheet, 1);
    lastColumn = 1;
  }
  Sheets_ensureRowCapacity_(sheet, NFB_DATA_START_ROW);
  var range = sheet.getRange(NFB_HEADER_START_ROW, 1, NFB_HEADER_DEPTH, lastColumn);
  return range.getValues();
}


function Sheets_touchSheetLastUpdated_(sheet, tsString) {
  var parent = sheet ? sheet.getParent() : null;
  var spreadsheetId = parent ? parent.getId() : "";
  var sheetName = sheet ? sheet.getName() : NFB_DEFAULT_SHEET_NAME;
  return SetSheetLastUpdatedAt_(spreadsheetId, sheetName, tsString);
}

function Sheets_readSheetLastUpdated_(sheet) {
  var parent = sheet ? sheet.getParent() : null;
  var spreadsheetId = parent ? parent.getId() : "";
  var sheetName = sheet ? sheet.getName() : NFB_DEFAULT_SHEET_NAME;
  return GetSheetLastUpdatedAt_(spreadsheetId, sheetName);
}

function Sheets_normalizeHeaderSegment_(segment) {
  if (segment === undefined || segment === null) return "";
  return String(segment).replace(/\r\n?/g, "\n").trim();
}

function Sheets_normalizeHeaderPath_(path) {
  var normalized = [];
  if (!Array.isArray(path)) return normalized;
  for (var i = 0; i < path.length && i < NFB_HEADER_DEPTH; i++) {
    var segment = Sheets_normalizeHeaderSegment_(path[i]);
    if (!segment) break;
    normalized.push(segment);
  }
  return normalized;
}

function Sheets_normalizeHeaderKey_(key) {
  if (key === undefined || key === null) return "";
  return Sheets_pathKey_(String(key).split("|"));
}

function Sheets_normalizeHeaderKeyList_(keys) {
  var normalized = [];
  var seen = {};
  var list = Array.isArray(keys) ? keys : [];
  for (var i = 0; i < list.length; i++) {
    var key = Sheets_normalizeHeaderKey_(list[i]);
    if (!key || seen[key]) continue;
    seen[key] = true;
    normalized.push(key);
  }
  return normalized;
}

function Sheets_normalizeRecordDataKeys_(data) {
  var normalized = {};
  if (!data || typeof data !== "object") return normalized;

  for (var key in data) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    var normalizedKey = Sheets_normalizeHeaderKey_(key);
    if (!normalizedKey || Object.prototype.hasOwnProperty.call(normalized, normalizedKey)) continue;
    normalized[normalizedKey] = data[key];
  }

  return normalized;
}

function Sheets_extractColumnPaths_(matrix) {
  var paths = [];
  if (!matrix || !matrix.length) return paths;
  for (var col = 0; col < matrix[0].length; col++) {
    var path = [];
    for (var row = 0; row < NFB_HEADER_DEPTH; row++) {
      var cell = Sheets_normalizeHeaderSegment_(matrix[row] ? matrix[row][col] : "");
      if (!cell) break;
      path.push(cell);
    }
    if (path.length) paths.push(path);
  }
  return paths;
}

function Sheets_pathKey_(path) {
  return Sheets_normalizeHeaderPath_(path).join("|");
}

// シートヘッダ用のパスセグメント解決 (改行正規化 + 空ラベル扱い)。
// Sheets_collectTemporalPathMap_ 側では空ラベルは subtree ごとスキップ、
// Sheets_buildOrderFromSchema_ 側では fallback "質問 X.Y (type)" を使う。
function Sheets_headerFieldSegmentSkipEmpty_(field) {
  return Sheets_normalizeHeaderSegment_(field && field.label) || null;
}

function Sheets_headerFieldSegmentWithFallback_(field, ctx) {
  var label = Sheets_normalizeHeaderSegment_(field && field.label);
  if (label) return label;
  var type = field && field.type !== undefined && field.type !== null
    ? String(field.type).trim() : "";
  return "質問 " + ctx.indexTrail.join(".") + " (" + (type || "unknown") + ")";
}

function Sheets_headerBranchSegment_(optionKey) {
  return Sheets_normalizeHeaderSegment_(optionKey) || null;
}

function Sheets_collectTemporalPathMap_(schema) {
  var map = {};
  nfbTraverseSchema_(schema, function(field, ctx) {
    if (field.type === "date" || field.type === "time") {
      map[ctx.pathSegments.join("|")] = field.type;
    }
  }, {
    fieldSegment: Sheets_headerFieldSegmentSkipEmpty_,
    branchSegment: Sheets_headerBranchSegment_
  });
  return map;
}

function Sheets_buildOrderFromSchema_(schema) {
  var order = [];
  var seen = {};
  var singleValueTypes = {
    text: true,
    textarea: true,
    number: true,
    regex: true,
    date: true,
    time: true,
    url: true,
    userName: true,
    email: true,
    phone: true,
    fileUpload: true,
    substitution: true
  };

  var appendKey = function(key) {
    var normalized = Sheets_normalizeHeaderKey_(key);
    if (!normalized || seen[normalized]) return;
    seen[normalized] = true;
    order.push(normalized);
  };

  nfbTraverseSchema_(schema, function(field, ctx) {
    var type = field.type !== undefined && field.type !== null ? String(field.type).trim() : "";
    var baseKey = ctx.pathSegments.join("|");

    if (type === "checkboxes" || type === "radio" || type === "select") {
      if (Array.isArray(field.options)) {
        for (var optIndex = 0; optIndex < field.options.length; optIndex++) {
          var option = field.options[optIndex];
          var optionLabel = Sheets_normalizeHeaderSegment_(option && option.label);
          appendKey(optionLabel ? baseKey + "|" + optionLabel : baseKey + "|");
        }
      }
    } else if (type !== "message" && singleValueTypes[type]) {
      appendKey(baseKey);
    }
  }, {
    fieldSegment: Sheets_headerFieldSegmentWithFallback_,
    branchSegment: Sheets_headerBranchSegment_
  });

  return order;
}

function Sheets_initializeHeaders_(spreadsheetId, sheetName, schema) {
  var sheet = Sheets_getOrCreateSheet_(spreadsheetId, sheetName || NFB_DEFAULT_SHEET_NAME);
  var order = Sheets_buildOrderFromSchema_(schema);
  return Sheets_ensureHeaderMatrix_(sheet, order);
}

function Sheets_buildDesiredPaths_(order, existingPaths) {
  var desired = [];
  var seen = {};

  NFB_FIXED_HEADER_PATHS.forEach(function (path) {
    var normalizedPath = Sheets_normalizeHeaderPath_(path);
    if (!normalizedPath.length) return;
    var key = Sheets_pathKey_(normalizedPath);
    if (!seen[key]) {
      desired.push(normalizedPath);
      seen[key] = true;
    }
  });

  (order || []).forEach(function (keyRaw) {
    var parts = Sheets_normalizeHeaderPath_(String(keyRaw || "").split("|"));
    if (!parts.length) return;
    var key = Sheets_pathKey_(parts);
    if (!seen[key]) {
      desired.push(parts);
      seen[key] = true;
    }
  });

  (existingPaths || []).forEach(function (path) {
    var normalizedPath = Sheets_normalizeHeaderPath_(path);
    if (!normalizedPath.length) return;
    var key = Sheets_pathKey_(normalizedPath);
    if (!seen[key]) {
      desired.push(normalizedPath);
      seen[key] = true;
    }
  });

  return desired;
}

function Sheets_findColumnByPath_(matrix, path) {
  if (!matrix || !matrix.length) return -1;
  var targetKey = Sheets_pathKey_(path);
  var paths = Sheets_extractColumnPaths_(matrix);
  for (var col = 0; col < paths.length; col++) {
    if (Sheets_pathKey_(paths[col]) === targetKey) {
      return col + 1;
    }
  }
  return -1;
}

function Sheets_writeHeaderPath_(sheet, columnIndex, path) {
  var normalizedPath = Sheets_normalizeHeaderPath_(path);
  var values = [];
  for (var row = 0; row < NFB_HEADER_DEPTH; row++) {
    values.push([row < normalizedPath.length ? normalizedPath[row] : ""]);
  }
  sheet.getRange(NFB_HEADER_START_ROW, columnIndex, NFB_HEADER_DEPTH, 1).setValues(values);
}

function Sheets_ensureHeaderMatrix_(sheet, order) {
  Sheets_ensureRowCapacity_(sheet, NFB_DATA_START_ROW);
  if (sheet.getFrozenRows() !== NFB_DATA_START_ROW - 1) {
    sheet.setFrozenRows(NFB_DATA_START_ROW - 1);
  }

  var matrix = Sheets_readHeaderMatrix_(sheet);
  var existingPaths = Sheets_extractColumnPaths_(matrix);
  var desired = Sheets_buildDesiredPaths_(order, existingPaths);

  // 既存列のキーセットを構築
  var existingKeySet = {};
  existingPaths.forEach(function(path) {
    existingKeySet[Sheets_pathKey_(path)] = true;
  });

  // 新しい列のみ末尾に追加（既存列は移動しない）
  for (var i = 0; i < desired.length; i++) {
    var path = desired[i];
    var key = Sheets_pathKey_(path);
    if (!existingKeySet[key]) {
      var newColIndex = sheet.getLastColumn() + 1;
      Sheets_ensureColumnExists_(sheet, newColIndex);
      Sheets_writeHeaderPath_(sheet, newColIndex, path);
      existingKeySet[key] = true;
    }
  }

  Sheets_touchSheetLastUpdated_(sheet);
  return sheet.getRange(NFB_HEADER_START_ROW, 1, NFB_HEADER_DEPTH, sheet.getLastColumn()).getValues();
}

function Sheets_buildHeaderKeyMap_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (!lastColumn) return {};
  var values = sheet.getRange(NFB_HEADER_START_ROW, 1, NFB_HEADER_DEPTH, lastColumn).getValues();
  var paths = Sheets_extractColumnPaths_(values);
  var map = {};
  for (var col = 0; col < paths.length; col++) {
    map[Sheets_pathKey_(paths[col])] = col + 1;
  }
  return map;
}

/**
 * 固定メタ列（id, No., createdAt, ..., driveFolderUrl）の 0-based インデックス マップ。
 * ヘッダー パスから動的に解決するため、シート上で列位置が想定と異なっても動作する。
 * 存在しないキーはマップに含まれない（呼び出し側で有無を確認してから参照すること）。
 */
function Sheets_buildFixedColMapFromPaths_(columnPaths) {
  var map = {};
  if (!columnPaths || !columnPaths.length) return map;
  for (var i = 0; i < columnPaths.length; i++) {
    var p = columnPaths[i];
    if (p && p.path && p.path.length === 1 && NFB_RESERVED_HEADER_KEYS[p.path[0]]) {
      map[p.path[0]] = p.index;
    }
  }
  return map;
}

function Sheets_buildFixedColMapFromSheet_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (!lastColumn) return {};
  var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);
  return Sheets_buildFixedColMapFromPaths_(columnPaths);
}

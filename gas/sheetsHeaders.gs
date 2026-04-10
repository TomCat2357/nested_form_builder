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

function Sheets_collectTemporalPathMap_(schema) {
  var map = {};

  var walk = function(fields, basePath) {
    if (!fields || !fields.length) return;

    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (!field) continue;
      var label = Sheets_normalizeHeaderSegment_(field.label);
      if (!label) continue;
      var path = basePath ? basePath + "|" + label : label;

      if (field.type === "date" || field.type === "time") {
        map[path] = field.type;
      }

      if (field.childrenByValue && typeof field.childrenByValue === "object") {
        for (var key in field.childrenByValue) {
          if (!field.childrenByValue.hasOwnProperty(key)) continue;
          var childFields = field.childrenByValue[key];
          var optionLabel = Sheets_normalizeHeaderSegment_(key);
          var nextPath = optionLabel ? path + "|" + optionLabel : path;
          walk(childFields, nextPath);
        }
      }
    }
  };

  walk(Array.isArray(schema) ? schema : [], "");
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
    fileUpload: true
  };

  var appendKey = function(key) {
    var normalized = Sheets_normalizeHeaderKey_(key);
    if (!normalized || seen[normalized]) return;
    seen[normalized] = true;
    order.push(normalized);
  };

  var resolveFieldLabel = function(field, indexTrail) {
    var label = Sheets_normalizeHeaderSegment_(field && field.label);
    if (label) return label;
    var fieldType = field && field.type !== undefined && field.type !== null ? String(field.type).trim() : "";
    if (!fieldType) fieldType = "unknown";
    return "質問 " + indexTrail.join(".") + " (" + fieldType + ")";
  };

  var walk = function(fields, pathSegments, indexTrail) {
    if (!fields || !fields.length) return;

    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (!field || typeof field !== "object") continue;

      var currentIndexTrail = indexTrail.concat(i + 1);
      var label = resolveFieldLabel(field, currentIndexTrail);
      var currentPath = pathSegments.concat(label);
      var baseKey = currentPath.join("|");
      var type = field.type !== undefined && field.type !== null ? String(field.type).trim() : "";

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

      if (field.childrenByValue && typeof field.childrenByValue === "object") {
        for (var childKey in field.childrenByValue) {
          if (!field.childrenByValue.hasOwnProperty(childKey)) continue;
          var childFields = field.childrenByValue[childKey];
          var optionPath = Sheets_normalizeHeaderSegment_(childKey);
          var childBasePath = optionPath ? currentPath.concat(optionPath) : currentPath;
          walk(childFields, childBasePath, currentIndexTrail);
        }
      }
    }
  };

  walk(Array.isArray(schema) ? schema : [], [], []);
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

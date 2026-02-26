// Split from sheets.gs



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

function Sheets_generateRecordId_() {
  var timestamp = new Date().getTime();
  var randomChars = "";
  var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (var i = 0; i < 8; i++) {
    randomChars += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return "r_" + timestamp + "_" + randomChars;
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
  Sheets_ensureRowCapacity_(sheet, NFB_HEADER_DEPTH);
  var range = sheet.getRange(1, 1, NFB_HEADER_DEPTH, lastColumn);
  return range.getValues();
}

function Sheets_extractColumnPaths_(matrix) {
  var paths = [];
  if (!matrix || !matrix.length) return paths;
  for (var col = 0; col < matrix[0].length; col++) {
    var path = [];
    for (var row = 0; row < NFB_HEADER_DEPTH; row++) {
      var cell = (matrix[row] && matrix[row][col]) ? String(matrix[row][col]) : "";
      if (!cell) break;
      path.push(cell);
    }
    if (path.length) paths.push(path);
  }
  return paths;
}

function Sheets_pathKey_(path) {
  return path.join("|");
}

function Sheets_collectTemporalPathMap_(schema) {
  var map = {};

  var walk = function(fields, basePath) {
    if (!fields || !fields.length) return;

    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (!field) continue;
      var label = field.label !== undefined && field.label !== null ? String(field.label) : "";
      if (!label) continue;
      var path = basePath ? basePath + "|" + label : label;

      if (field.type === "date" || field.type === "time") {
        map[path] = field.type;
      }

      if (field.childrenByValue && typeof field.childrenByValue === "object") {
        for (var key in field.childrenByValue) {
          if (!field.childrenByValue.hasOwnProperty(key)) continue;
          var childFields = field.childrenByValue[key];
          var optionLabel = String(key || "");
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
    email: true
  };

  var appendKey = function(key) {
    var normalized = String(key || "").trim();
    if (!normalized || seen[normalized]) return;
    seen[normalized] = true;
    order.push(normalized);
  };

  var resolveFieldLabel = function(field, indexTrail) {
    var label = field && field.label !== undefined && field.label !== null ? String(field.label).trim() : "";
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
            var optionLabel = option && option.label !== undefined && option.label !== null ? String(option.label) : "";
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
          var optionPath = String(childKey || "");
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
    var key = Sheets_pathKey_(path);
    if (!seen[key]) {
      desired.push(path);
      seen[key] = true;
    }
  });

  (order || []).forEach(function (keyRaw) {
    var keyStr = String(keyRaw || "");
    if (!keyStr) return;
    var parts = keyStr.split("|")
      .map(function (part) { return String(part || "").trim(); })
      .filter(function (part) { return part; })
      .slice(0, NFB_HEADER_DEPTH);
    if (!parts.length) return;
    var key = Sheets_pathKey_(parts);
    if (!seen[key]) {
      desired.push(parts);
      seen[key] = true;
    }
  });

  (existingPaths || []).forEach(function (path) {
    var key = Sheets_pathKey_(path);
    if (!seen[key]) {
      desired.push(path);
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
  var values = [];
  for (var row = 0; row < NFB_HEADER_DEPTH; row++) {
    values.push([row < path.length ? path[row] : ""]);
  }
  sheet.getRange(1, columnIndex, NFB_HEADER_DEPTH, 1).setValues(values);
}

function Sheets_ensureHeaderMatrix_(sheet, order) {
  Sheets_ensureRowCapacity_(sheet, NFB_HEADER_DEPTH);
  if (sheet.getFrozenRows() !== NFB_HEADER_DEPTH) {
    sheet.setFrozenRows(NFB_HEADER_DEPTH);
  }

  // Move/insert columns will fail if any part of the column (not just header rows) is merged.
  // Unmerge the full used range up-front to avoid "結合したセルの一部だけを含む列は移動できません" errors.
  var maxCols = Math.max(sheet.getMaxColumns(), 1);
  var maxRows = Math.max(sheet.getMaxRows(), NFB_HEADER_DEPTH);
  sheet.getRange(1, 1, maxRows, maxCols).breakApart();

  var matrix = Sheets_readHeaderMatrix_(sheet);
  var existingPaths = Sheets_extractColumnPaths_(matrix);
  var desired = Sheets_buildDesiredPaths_(order, existingPaths);

  for (var i = 0; i < desired.length; i++) {
    var path = desired[i];
    var found = Sheets_findColumnByPath_(matrix, path);
    var targetIndex = i + 1;

    if (found === -1) {
      sheet.insertColumns(targetIndex, 1);
      Sheets_writeHeaderPath_(sheet, targetIndex, path);
      matrix = Sheets_readHeaderMatrix_(sheet);
    } else if (found !== targetIndex) {
      var range = sheet.getRange(1, found, sheet.getMaxRows(), 1);
      sheet.moveColumns(range, targetIndex);
      Sheets_writeHeaderPath_(sheet, targetIndex, path);
      matrix = Sheets_readHeaderMatrix_(sheet);
    } else {
      Sheets_writeHeaderPath_(sheet, targetIndex, path);
    }
  }

  return sheet.getRange(1, 1, NFB_HEADER_DEPTH, sheet.getLastColumn()).getValues();
}

function Sheets_buildHeaderKeyMap_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (!lastColumn) return {};
  var values = sheet.getRange(1, 1, NFB_HEADER_DEPTH, lastColumn).getValues();
  var paths = Sheets_extractColumnPaths_(values);
  var map = {};
  for (var col = 0; col < paths.length; col++) {
    map[Sheets_pathKey_(paths[col])] = col + 1;
  }
  return map;
}


function Sheets_isValidDate_(date) {
  return date instanceof Date && !isNaN(date.getTime());
}

function Sheets_serialToDate_(serial) {
  if (typeof serial !== "number" || !isFinite(serial)) return null;
  var ms = NFB_SHEETS_EPOCH_MS + serial * NFB_MS_PER_DAY;
  var d = new Date(ms);
  return Sheets_isValidDate_(d) ? d : null;
}

function Sheets_parseDateLikeToJstDate_(value, allowSerialNumber) {
  if (value === null || value === undefined) return null;
  if (Sheets_isValidDate_(value)) return value;

  if (allowSerialNumber) {
    if (typeof value === "number" && isFinite(value)) {
      return Sheets_serialToDate_(value);
    }
    if (typeof value === "string") {
      var numeric = value.trim();
      if (/^[-+]?\d+(?:\.\d+)?$/.test(numeric)) {
        var numericValue = parseFloat(numeric);
        if (isFinite(numericValue)) {
          return Sheets_serialToDate_(numericValue);
        }
      }
    }
  }

  if (typeof value !== "string") return null;
  var str = value.trim();
  if (!str) return null;

  // ISO 8601 (タイムゾーン付き/なし) はそのままDateへ
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
    var isoDate = new Date(str);
    return Sheets_isValidDate_(isoDate) ? isoDate : null;
  }

  // YYYY-MM-DD[/ ]HH:mm[:ss]
  var dateTimeMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[\/\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)$/);
  if (dateTimeMatch) {
    var parts = dateTimeMatch;
    var dt = new Date(
      parseInt(parts[1], 10),
      parseInt(parts[2], 10) - 1,
      parseInt(parts[3], 10),
      parseInt(parts[4], 10),
      parseInt(parts[5], 10),
      parts[6] ? parseInt(parts[6], 10) : 0
    );
    return Sheets_isValidDate_(dt) ? dt : null;
  }

  // YYYY-MM-DD
  var dateOnlyMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    var d = new Date(parseInt(dateOnlyMatch[1], 10), parseInt(dateOnlyMatch[2], 10) - 1, parseInt(dateOnlyMatch[3], 10), 0, 0, 0);
    return Sheets_isValidDate_(d) ? d : null;
  }

  // HH:mm[:ss] を基準日(1899-12-30)のJSTで扱う
  var timeOnlyMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeOnlyMatch) {
    var t = new Date(1899, 11, 30, parseInt(timeOnlyMatch[1], 10), parseInt(timeOnlyMatch[2], 10), timeOnlyMatch[3] ? parseInt(timeOnlyMatch[3], 10) : 0);
    return Sheets_isValidDate_(t) ? t : null;
  }

  return null;
}

function Sheets_isDateString_(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function Sheets_isTimeString_(value) {
  return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value);
}

function Sheets_detectTemporalColumnType_(values, columnIndex) {
  var hasValue = false;
  var allDate = true;
  var allTime = true;

  for (var i = 0; i < values.length; i++) {
    var cell = values[i][columnIndex];
    if (cell === null || cell === undefined || cell === "") continue;
    hasValue = true;

    if (cell instanceof Date) {
      if (!Sheets_isValidDate_(cell)) return null;
      var isBaseTime = cell.getFullYear() === 1899 && cell.getMonth() === 11 && cell.getDate() === 30;
      var isMidnight = cell.getHours() === 0 && cell.getMinutes() === 0 && cell.getSeconds() === 0;
      if (!isBaseTime) allTime = false;
      if (!isMidnight) allDate = false;
    } else if (typeof cell === "string") {
      var trimmed = cell.trim();
      if (!trimmed) continue;
      if (!Sheets_isDateString_(trimmed)) allDate = false;
      if (!Sheets_isTimeString_(trimmed)) allTime = false;
    } else {
      allDate = false;
      allTime = false;
    }

    if (!allDate && !allTime) return null;
  }

  if (!hasValue) return null;
  if (allTime) return "time";
  if (allDate) return "date";
  return null;
}

function Sheets_applyTemporalFormatToColumn_(sheet, columnIndex, values, dataRowCount, numberFormat) {
  var converted = [];
  for (var i = 0; i < dataRowCount; i++) {
    var cell = values[i][columnIndex];
    if (cell === null || cell === undefined || cell === "") {
      converted.push([""]);
      continue;
    }
    if (cell instanceof Date || (typeof cell === "number" && isFinite(cell))) {
      converted.push([cell]);
      continue;
    }
    var parsed = Sheets_parseDateLikeToJstDate_(cell);
    converted.push([parsed || cell]);
  }

  var range = sheet.getRange(NFB_HEADER_DEPTH + 1, columnIndex + 1, dataRowCount, 1);
  range.setValues(converted);
  range.setNumberFormat(numberFormat);
}

function Sheets_applyTemporalFormats_(sheet, columnPaths, values, dataRowCount, explicitTypeMap) {
  if (!dataRowCount) return;

  var keyToIndex = {};
  for (var i = 0; i < columnPaths.length; i++) {
    keyToIndex[columnPaths[i].key] = columnPaths[i].index;
  }

  var dateTimeFormat = "yyyy/MM/dd HH:mm:ss";
  var dateFormat = "yyyy/MM/dd";
  var timeFormat = "HH:mm";

  var createdAtIndex = keyToIndex["createdAt"];
  var modifiedAtIndex = keyToIndex["modifiedAt"];

  if (typeof createdAtIndex === "number") {
    Sheets_applyTemporalFormatToColumn_(sheet, createdAtIndex, values, dataRowCount, dateTimeFormat);
  }
  if (typeof modifiedAtIndex === "number") {
    Sheets_applyTemporalFormatToColumn_(sheet, modifiedAtIndex, values, dataRowCount, dateTimeFormat);
  }

  var reservedKeys = { "id": true, "No.": true, "createdAt": true, "modifiedAt": true, "createdBy": true, "modifiedBy": true };
  var hasExplicitMap = explicitTypeMap && typeof explicitTypeMap === "object";
  for (var j = 0; j < columnPaths.length; j++) {
    var colInfo = columnPaths[j];
    if (reservedKeys[colInfo.key]) continue;
    if (hasExplicitMap) {
      var explicitType = explicitTypeMap[colInfo.key];
      if (explicitType === "date") {
        Sheets_applyTemporalFormatToColumn_(sheet, colInfo.index, values, dataRowCount, dateFormat);
        continue;
      }
      if (explicitType === "time") {
        Sheets_applyTemporalFormatToColumn_(sheet, colInfo.index, values, dataRowCount, timeFormat);
        continue;
      }
    }
    var temporalType = Sheets_detectTemporalColumnType_(values, colInfo.index);
    if (temporalType === "date") {
      Sheets_applyTemporalFormatToColumn_(sheet, colInfo.index, values, dataRowCount, dateFormat);
    } else if (temporalType === "time") {
      Sheets_applyTemporalFormatToColumn_(sheet, colInfo.index, values, dataRowCount, timeFormat);
    }
  }
}

function Sheets_toDateOrOriginal_(value) {
  var parsed = Sheets_parseDateLikeToJstDate_(value);
  return parsed || value;
}

function Sheets_dateToSerial_(date) {
  if (!Sheets_isValidDate_(date)) return null;
  return (date.getTime() - NFB_SHEETS_EPOCH_MS) / NFB_MS_PER_DAY;
}

function Sheets_toUnixMs_(value, allowSerialNumber) {
  var d = Sheets_parseDateLikeToJstDate_(value, allowSerialNumber);
  return d ? Sheets_dateToSerial_(d) : null;
}

function Sheets_getOrCreateSheet_(spreadsheetId, sheetName) {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");

  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(sheetName || NFB_DEFAULT_SHEET_NAME);
  return sheet || ss.insertSheet(sheetName || NFB_DEFAULT_SHEET_NAME);
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

function Sheets_findRowById_(sheet, id) {
  if (!id) return -1;
  var lastRow = sheet.getLastRow();
  if (lastRow <= NFB_HEADER_DEPTH) return -1;
  var lookupRange = sheet.getRange(NFB_HEADER_DEPTH + 1, 1, lastRow - NFB_HEADER_DEPTH, 1).getValues();

  // 二分探索を試行（ID列がソート済みの場合に高速化）
  var binaryResult = Sheets_binarySearchById_(lookupRange, id);
  if (binaryResult !== -1) {
    return NFB_HEADER_DEPTH + 1 + binaryResult;
  }

  // フォールバック: 線形探索（後方互換性のため）
  for (var i = 0; i < lookupRange.length; i++) {
    if (String(lookupRange[i][0]) === String(id)) {
      return NFB_HEADER_DEPTH + 1 + i;
    }
  }
  return -1;
}

function Sheets_binarySearchById_(lookupRange, targetId) {
  if (!lookupRange || lookupRange.length === 0) return -1;

  var targetStr = String(targetId);
  var left = 0;
  var right = lookupRange.length - 1;

  // ソート済みかチェック（最初と最後を比較）
  var firstId = String(lookupRange[0][0]);
  var lastId = String(lookupRange[right][0]);

  // IDが "r_" で始まるタイムスタンプベースの形式かチェック
  if (!firstId.startsWith("r_") || !lastId.startsWith("r_")) {
    return -1; // 二分探索不可
  }

  // ソート順チェック（簡易版: 先頭 <= 末尾）
  if (firstId > lastId) {
    return -1; // ソートされていない
  }

  // 二分探索実行
  while (left <= right) {
    var mid = Math.floor((left + right) / 2);
    var midId = String(lookupRange[mid][0]);

    if (midId === targetStr) {
      return mid;
    } else if (midId < targetStr) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return -1;
}

function Sheets_prepareResponses_(ctx) {
  var responseKeys = (ctx.order && ctx.order.length)
    ? ctx.order
    : Object.keys(ctx.responses || {});

  var sortedResponses = {};
  for (var r = 0; r < responseKeys.length; r++) {
    var key = responseKeys[r];
    if (ctx.responses && Object.prototype.hasOwnProperty.call(ctx.responses, key)) {
      sortedResponses[key] = ctx.responses[key];
    }
  }
  ctx.responses = sortedResponses;
  ctx.order = responseKeys;
}

function Sheets_createNewRow_(sheet, id) {
  var nextId = (id && String(id)) || Sheets_generateRecordId_();
  var rowIndex = Math.max(sheet.getLastRow() + 1, NFB_HEADER_DEPTH + 1);

  Sheets_ensureRowCapacity_(sheet, rowIndex);
  var now = new Date();

  var maxNo = 0;
  var lastRow = sheet.getLastRow();
  if (lastRow > NFB_HEADER_DEPTH) {
    var noValues = sheet.getRange(NFB_HEADER_DEPTH + 1, 2, lastRow - NFB_HEADER_DEPTH, 1).getValues();
    for (var i = 0; i < noValues.length; i++) {
      var val = noValues[i][0];
      if (typeof val === 'number' && val > maxNo) {
        maxNo = val;
      }
    }
  }

  var nowSerial = Sheets_dateToSerial_(now);
  var email = Session.getActiveUser().getEmail() || "";

  sheet.getRange(rowIndex, 1).setValue(String(nextId));
  sheet.getRange(rowIndex, 2).setValue(String(maxNo + 1));
  sheet.getRange(rowIndex, 3).setValue(nowSerial);
  sheet.getRange(rowIndex, 4).setValue(nowSerial);
  sheet.getRange(rowIndex, 5).setValue(email);
  sheet.getRange(rowIndex, 6).setValue(email);

  return { rowIndex: rowIndex, id: nextId };
}

function Sheets_updateExistingRow_(sheet, rowIndex) {
  Sheets_ensureRowCapacity_(sheet, rowIndex);
  var nowSerial = Sheets_dateToSerial_(new Date());
  var email = Session.getActiveUser().getEmail() || "";
  sheet.getRange(rowIndex, 4).setValue(nowSerial);
  sheet.getRange(rowIndex, 5).setValue(email);
}

function Sheets_clearDataRow_(sheet, rowIndex, keyToColumn, reservedHeaderKeys) {
  for (var key in keyToColumn) {
    if (Object.prototype.hasOwnProperty.call(keyToColumn, key) && !reservedHeaderKeys[key]) {
      var columnIndex = keyToColumn[key];
      if (columnIndex) {
        sheet.getRange(rowIndex, columnIndex).setValue("");
      }
    }
  }
}

function Sheets_writeDataToRow_(sheet, rowIndex, orderKeys, responses, keyToColumn, reservedHeaderKeys) {
  for (var i = 0; i < orderKeys.length; i++) {
    var key = String(orderKeys[i] || "");
    if (!key || reservedHeaderKeys[key]) continue;
    var columnIndex = keyToColumn[key];
    if (!columnIndex) continue;
    var value = responses && Object.prototype.hasOwnProperty.call(responses, key) ? responses[key] : "";
    if (value === undefined || value === null) value = "";
    sheet.getRange(rowIndex, columnIndex).setValue(String(value));
  }
}

function Sheets_upsertRecordById_(sheet, order, ctx) {
  Sheets_prepareResponses_(ctx);
  Sheets_ensureHeaderMatrix_(sheet, ctx.order);
  var keyToColumn = Sheets_buildHeaderKeyMap_(sheet);

  var reservedHeaderKeys = {};
  NFB_FIXED_HEADER_PATHS.forEach(function(path) {
    reservedHeaderKeys[Sheets_pathKey_(path)] = true;
  });

  var rowIndex = Sheets_findRowById_(sheet, ctx.id);

  if (rowIndex === -1) {
    var newRow = Sheets_createNewRow_(sheet, ctx.id);
    rowIndex = newRow.rowIndex;
    ctx.id = newRow.id;
  } else {
    Sheets_updateExistingRow_(sheet, rowIndex);
    Sheets_clearDataRow_(sheet, rowIndex, keyToColumn, reservedHeaderKeys);
  }

  Sheets_writeDataToRow_(sheet, rowIndex, ctx.order, ctx.responses, keyToColumn, reservedHeaderKeys);

  return { row: rowIndex, id: ctx.id };
}

function Sheets_deleteRecordById_(sheet, id) {
  var rowIndex = Sheets_findRowById_(sheet, id);

  if (rowIndex === -1) {
    return { ok: false, error: "Record not found" };
  }

  sheet.deleteRow(rowIndex);
  return { ok: true, row: rowIndex, id: id };
}

function Sheets_readColumnPaths_(sheet, lastColumn) {
  var headerMatrix = sheet.getRange(1, 1, NFB_HEADER_DEPTH, lastColumn).getValues();
  var columnPaths = [];
  for (var col = 0; col < lastColumn; col++) {
    var path = [];
    for (var row = 0; row < NFB_HEADER_DEPTH; row++) {
      var cell = headerMatrix[row][col] ? String(headerMatrix[row][col]) : "";
      if (!cell) break;
      path.push(cell);
    }
    if (path.length) {
      columnPaths.push({ index: col, path: path, key: Sheets_pathKey_(path) });
    }
  }
  return columnPaths;
}

function Sheets_buildRecordFromRow_(rowData, columnPaths) {
  var id = rowData[0] ? String(rowData[0]) : "";
  if (!id) return null;

  var record = {
    id: id,
    "No.": rowData[1] || "",
    createdAt: rowData[2] || "",
    modifiedAt: rowData[3] || "",
    createdBy: rowData[4] || "",
    modifiedBy: rowData[5] || "",
    createdAtUnixMs: Sheets_toUnixMs_(rowData[2], true),
    modifiedAtUnixMs: Sheets_toUnixMs_(rowData[3], true),
    data: {},
    dataUnixMs: {}
  };

  var reservedKeys = { "id": true, "No.": true, "createdAt": true, "modifiedAt": true, "createdBy": true, "modifiedBy": true };

  for (var j = 0; j < columnPaths.length; j++) {
    var colInfo = columnPaths[j];
    var value = rowData[colInfo.index];
    if (value != null && value !== "" && !reservedKeys[colInfo.key]) {
      record.data[colInfo.key] = value;
      var unix = Sheets_toUnixMs_(value);
      if (unix !== null) {
        record.dataUnixMs[colInfo.key] = unix;
      }
    }
  }

  return record;
}

function Sheets_getRecordById_(sheet, id, rowIndexHint) {
  if (!id) return { ok: false, error: "Record ID is required" };

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastColumn === 0 || lastRow <= NFB_HEADER_DEPTH) {
    return { ok: false, error: "Record not found" };
  }

  var resolvedRowIndex = -1;

  // 0-basedのデータ行indexをヒントとして受け取り、先頭ヘッダー行を考慮して変換
  if (typeof rowIndexHint === "number" && rowIndexHint >= 0) {
    var candidate = NFB_HEADER_DEPTH + 1 + rowIndexHint;
    if (candidate <= lastRow) {
      var idCell = sheet.getRange(candidate, 1, 1, 1).getValues()[0][0];

      if (String(idCell) === String(id)) {
        resolvedRowIndex = candidate;
      }
    }
  }

  if (resolvedRowIndex === -1) {
    resolvedRowIndex = Sheets_findRowById_(sheet, id);
  }

  if (resolvedRowIndex === -1) {
    return { ok: false, error: "Record not found" };
  }

  var dataRowIndex = resolvedRowIndex - (NFB_HEADER_DEPTH + 1);

  var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);
  var rowData = sheet.getRange(resolvedRowIndex, 1, 1, lastColumn).getValues()[0];
  var record = Sheets_buildRecordFromRow_(rowData, columnPaths);
  if (!record) {
    return { ok: false, error: "Record not found" };
  }

  return { ok: true, record: record, rowIndex: dataRowIndex };
}

function Sheets_getAllRecords_(sheet, temporalTypeMap) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();

  if (lastRow <= NFB_HEADER_DEPTH || lastColumn === 0) {
    return [];
  }

  var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);
  var dataRowCount = lastRow - NFB_HEADER_DEPTH;

  // スプレッドシート側でID列(2列目)で必ずソート
  if (dataRowCount > 0) {
    var sortRange = sheet.getRange(NFB_HEADER_DEPTH + 1, 1, dataRowCount, lastColumn);
    sortRange.sort({column: 2, ascending: true});
  }

  var dataRange = sheet.getRange(NFB_HEADER_DEPTH + 1, 1, dataRowCount, lastColumn).getValues();
  if (dataRowCount > 0) {
    Sheets_applyTemporalFormats_(sheet, columnPaths, dataRange, dataRowCount, temporalTypeMap);
  }

  var records = [];
  for (var i = 0; i < dataRange.length; i++) {
    var record = Sheets_buildRecordFromRow_(dataRange[i], columnPaths);
    if (record) records.push(record);
  }

  return records;
}

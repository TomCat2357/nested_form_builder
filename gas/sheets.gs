var NFB_HEADER_DEPTH = 6;
var NFB_FIXED_HEADER_PATHS = [["id"], ["No."], ["createdAt"], ["modifiedAt"]];

function Sheets_getOrCreateSheet_(spreadsheetId, sheetName) {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");

  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(sheetName || "Responses");
  return sheet || ss.insertSheet(sheetName || "Responses");
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

  sheet.getRange(rowIndex, 1).setValue(nextId);
  sheet.getRange(rowIndex, 2).setValue(maxNo + 1);
  sheet.getRange(rowIndex, 3).setValue(now);
  sheet.getRange(rowIndex, 4).setValue(now);

  return { rowIndex: rowIndex, id: nextId };
}

function Sheets_updateExistingRow_(sheet, rowIndex) {
  Sheets_ensureRowCapacity_(sheet, rowIndex);
  sheet.getRange(rowIndex, 4).setValue(new Date());
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
    sheet.getRange(rowIndex, columnIndex).setValue(value);
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
    data: {}
  };

  var reservedKeys = { "id": true, "No.": true, "createdAt": true, "modifiedAt": true };

  for (var j = 0; j < columnPaths.length; j++) {
    var colInfo = columnPaths[j];
    var value = rowData[colInfo.index];
    if (value != null && value !== "" && !reservedKeys[colInfo.key]) {
      record.data[colInfo.key] = value;
    }
  }

  return record;
}

function Sheets_getRecordById_(sheet, id) {
  if (!id) return null;

  var rowIndex = Sheets_findRowById_(sheet, id);
  if (rowIndex === -1) {
    return null;
  }

  var lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return null;

  var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);
  var rowData = sheet.getRange(rowIndex, 1, 1, lastColumn).getValues()[0];

  return Sheets_buildRecordFromRow_(rowData, columnPaths);
}

function Sheets_getAllRecords_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();

  if (lastRow <= NFB_HEADER_DEPTH || lastColumn === 0) {
    return [];
  }

  var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);
  var dataRowCount = lastRow - NFB_HEADER_DEPTH;

  // スプレッドシート側でID列(1列目)でソート
  if (dataRowCount > 0) {
    var sortRange = sheet.getRange(NFB_HEADER_DEPTH + 1, 1, dataRowCount, lastColumn);
    sortRange.sort({column: 1, ascending: true});
  }

  var dataRange = sheet.getRange(NFB_HEADER_DEPTH + 1, 1, dataRowCount, lastColumn).getValues();

  var records = [];
  for (var i = 0; i < dataRange.length; i++) {
    var record = Sheets_buildRecordFromRow_(dataRange[i], columnPaths);
    if (record) records.push(record);
  }

  return records;
}

var NFB_HEADER_DEPTH = 6;
var NFB_FIXED_HEADER_PATHS = [["__hash__"], ["id"], ["No."], ["createdAt"], ["modifiedAt"]];
var NFB_TZ = "Asia/Tokyo"; // 想定タイムゾーン（JST固定）
var NFB_MS_PER_DAY = 24 * 60 * 60 * 1000;
var NFB_SHEETS_EPOCH_MS = new Date(1899, 11, 30, 0, 0, 0).getTime();

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
  var lookupRange = sheet.getRange(NFB_HEADER_DEPTH + 1, 2, lastRow - NFB_HEADER_DEPTH, 1).getValues();

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
    var noValues = sheet.getRange(NFB_HEADER_DEPTH + 1, 3, lastRow - NFB_HEADER_DEPTH, 1).getValues();
    for (var i = 0; i < noValues.length; i++) {
      var val = noValues[i][0];
      if (typeof val === 'number' && val > maxNo) {
        maxNo = val;
      }
    }
  }

  var nowSerial = Sheets_dateToSerial_(now);

  sheet.getRange(rowIndex, 2).setValue(String(nextId));
  sheet.getRange(rowIndex, 3).setValue(String(maxNo + 1));
  sheet.getRange(rowIndex, 4).setValue(nowSerial);
  sheet.getRange(rowIndex, 5).setValue(nowSerial);

  return { rowIndex: rowIndex, id: nextId };
}

function Sheets_updateExistingRow_(sheet, rowIndex) {
  Sheets_ensureRowCapacity_(sheet, rowIndex);
  var nowSerial = Sheets_dateToSerial_(new Date());
  sheet.getRange(rowIndex, 5).setValue(nowSerial);
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

  // 行ハッシュを計算しメタ列に保存（id + data を対象にする）
  var hashColumn = keyToColumn["__hash__"];
  if (hashColumn) {
    var payloadForHash = {
      id: String(ctx.id || ""),
      data: ctx.responses || {},
    };
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(payloadForHash));
    var hashStr = Utilities.base64Encode(digest);
    sheet.getRange(rowIndex, hashColumn).setValue(hashStr);
  }

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
  var id = rowData[1] ? String(rowData[1]) : "";
  if (!id) return null;

  var record = {
    id: id,
    "No.": rowData[2] || "",
    createdAt: rowData[3] || "",
    modifiedAt: rowData[4] || "",
    createdAtUnixMs: Sheets_toUnixMs_(rowData[3], true),
    modifiedAtUnixMs: Sheets_toUnixMs_(rowData[4], true),
    data: {},
    dataUnixMs: {},
    rowHash: rowData[0] ? String(rowData[0]) : ""
  };

  var reservedKeys = { "__hash__": true, "id": true, "No.": true, "createdAt": true, "modifiedAt": true };

  for (var j = 0; j < columnPaths.length; j++) {
    var colInfo = columnPaths[j];
    var value = rowData[colInfo.index];
    if (colInfo.key === "__hash__") {
      record.rowHash = value ? String(value) : "";
    } else if (value != null && value !== "" && !reservedKeys[colInfo.key]) {
      record.data[colInfo.key] = value;
      var unix = Sheets_toUnixMs_(value);
      if (unix !== null) {
        record.dataUnixMs[colInfo.key] = unix;
      }
    }
  }

  return record;
}

function Sheets_getRecordById_(sheet, id, rowIndexHint, cachedRowHash) {
  if (!id) return { ok: false, error: "Record ID is required" };

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastColumn === 0 || lastRow <= NFB_HEADER_DEPTH) {
    return { ok: false, error: "Record not found" };
  }

  var headerMatrix = Sheets_readHeaderMatrix_(sheet);
  var hashColumn = Sheets_findColumnByPath_(headerMatrix, ["__hash__"]); // 1-based or -1

  var resolvedRowIndex = -1;
  var unchanged = false;

  // 0-basedのデータ行indexをヒントとして受け取り、先頭ヘッダー行を考慮して変換
  if (typeof rowIndexHint === "number" && rowIndexHint >= 0) {
    var candidate = NFB_HEADER_DEPTH + 1 + rowIndexHint;
    if (candidate <= lastRow) {
      // A列（hash）とB列（id）を同時に読み取り
      var rowCells = sheet.getRange(candidate, 1, 1, 2).getValues()[0];
      var hashCell = rowCells[0];
      var idCell = rowCells[1];

      if (String(idCell) === String(id)) {
        resolvedRowIndex = candidate;
        if (hashColumn !== -1 && cachedRowHash) {
          if (String(hashCell || "") === String(cachedRowHash || "")) {
            unchanged = true;
          }
        }
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

  if (unchanged) {
    return { ok: true, record: null, rowIndex: dataRowIndex, unchanged: true, rowHash: cachedRowHash || "" };
  }

  var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);
  var rowData = sheet.getRange(resolvedRowIndex, 1, 1, lastColumn).getValues()[0];
  var record = Sheets_buildRecordFromRow_(rowData, columnPaths);
  if (!record) {
    return { ok: false, error: "Record not found" };
  }

  return { ok: true, record: record, rowIndex: dataRowIndex, unchanged: false, rowHash: record.rowHash || "" };
}

function Sheets_getAllRecords_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();

  if (lastRow <= NFB_HEADER_DEPTH || lastColumn === 0) {
    return [];
  }

  var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);
  var dataRowCount = lastRow - NFB_HEADER_DEPTH;

  // スプレッドシート側でID列(2列目)でソート（既にソート済みの場合はスキップ）
  if (dataRowCount > 0) {
    // ID列（2列目）を読み取ってソート済みかチェック
    var idColumn = sheet.getRange(NFB_HEADER_DEPTH + 1, 2, dataRowCount, 1).getValues();
    var needsSort = false;
    for (var i = 1; i < idColumn.length; i++) {
      var prevId = String(idColumn[i - 1][0] || "");
      var currId = String(idColumn[i][0] || "");
      if (prevId > currId) {
        needsSort = true;
        break;
      }
    }

    if (needsSort) {
      var sortRange = sheet.getRange(NFB_HEADER_DEPTH + 1, 1, dataRowCount, lastColumn);
      sortRange.sort({column: 2, ascending: true});
    }
  }

  var dataRange = sheet.getRange(NFB_HEADER_DEPTH + 1, 1, dataRowCount, lastColumn).getValues();

  var records = [];
  for (var i = 0; i < dataRange.length; i++) {
    var record = Sheets_buildRecordFromRow_(dataRange[i], columnPaths);
    if (record) records.push(record);
  }

  return records;
}


function Sheets_purgeExpiredDeletedRows_(sheet, retentionDays) {
  var days = parseInt(retentionDays, 10);
  if (!isFinite(days) || days <= 0) days = NFB_DEFAULT_DELETED_RECORD_RETENTION_DAYS;

  var lastRow = sheet.getLastRow();
  if (lastRow < NFB_DATA_START_ROW) return { deletedCount: 0 };

  var lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return { deletedCount: 0 };

  var rowCount = lastRow - NFB_DATA_START_ROW + 1;
  var range = sheet.getRange(NFB_DATA_START_ROW, 1, rowCount, lastColumn);
  var values = range.getValues();

  var cutoffUnixMs = Date.now() - days * NFB_MS_PER_DAY;
  var deletedCount = 0;

  var newValues = [];
  for (var i = 0; i < values.length; i++) {
    var deletedAtUnixMs = Sheets_toUnixMs_(values[i][4], true); // index 4 is deletedAt
    if (isFinite(deletedAtUnixMs) && deletedAtUnixMs > 0 && deletedAtUnixMs <= cutoffUnixMs) {
      deletedCount++;
    } else {
      newValues.push(values[i]);
    }
  }

  if (deletedCount > 0) {
    if (newValues.length > 0) {
      sheet.getRange(NFB_DATA_START_ROW, 1, newValues.length, lastColumn).setValues(newValues);
    }
    // クリア対象行
    sheet.getRange(NFB_DATA_START_ROW + newValues.length, 1, deletedCount, lastColumn).clearContent();
    Sheets_touchSheetLastUpdated_(sheet, Date.now());
  }

  return { deletedCount: deletedCount };
}

// Split from sheets.gs



function Sheets_readColumnPaths_(sheet, lastColumn) {
  var headerMatrix = sheet.getRange(NFB_HEADER_START_ROW, 1, NFB_HEADER_DEPTH, lastColumn).getValues();
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

  var formatDt = function(val) {
    var unixMs = Sheets_toUnixMs_(val, true);
    if (unixMs !== null && isFinite(unixMs)) return unixMs;
    if (val === null || val === undefined || val === "") return "";
    return String(val);
  };
  var formatNullableDt = function(val) {
    var unixMs = Sheets_toUnixMs_(val, true);
    if (unixMs !== null && isFinite(unixMs)) return unixMs;
    if (val === null || val === undefined || val === "") return null;
    return String(val);
  };

  var record = {
    id: id,
    "No.": rowData[1] || "",
    createdAt: formatDt(rowData[2]),
    modifiedAt: formatDt(rowData[3]),
    deletedAt: formatNullableDt(rowData[4]),
    createdBy: rowData[5] || "",
    modifiedBy: rowData[6] || "",
    deletedBy: rowData[7] || "",
    createdAtUnixMs: Sheets_toUnixMs_(rowData[2], true),
    modifiedAtUnixMs: Sheets_toUnixMs_(rowData[3], true),
    deletedAtUnixMs: Sheets_toUnixMs_(rowData[4], true),
    data: {},
    dataUnixMs: {}
  };

  var reservedKeys = { "id": true, "No.": true, "createdAt": true, "modifiedAt": true, "deletedAt": true, "createdBy": true, "modifiedBy": true, "deletedBy": true };

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
  if (lastColumn === 0 || lastRow < NFB_DATA_START_ROW) {
    return { ok: false, error: "Record not found" };
  }

  var resolvedRowIndex = -1;

  // 0-basedのデータ行indexをヒントとして受け取り、先頭ヘッダー行を考慮して変換
  if (typeof rowIndexHint === "number" && rowIndexHint >= 0) {
    var candidate = NFB_DATA_START_ROW + rowIndexHint;
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

  var dataRowIndex = resolvedRowIndex - NFB_DATA_START_ROW;

  var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);
  var rowData = sheet.getRange(resolvedRowIndex, 1, 1, lastColumn).getValues()[0];
  var record = Sheets_buildRecordFromRow_(rowData, columnPaths);
  if (!record) {
    return { ok: false, error: "Record not found" };
  }

  return { ok: true, record: record, rowIndex: dataRowIndex };
}

function Sheets_getAllRecords_(sheet, temporalTypeMap, options) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var shouldNormalize = !!(options && options.normalize);

  if (lastRow < NFB_DATA_START_ROW || lastColumn === 0) {
    return [];
  }

  var dataStartRow = NFB_DATA_START_ROW;
  var dataRowCount = lastRow - NFB_DATA_START_ROW + 1;
  var dataRange = sheet.getRange(dataStartRow, 1, dataRowCount, lastColumn);
  var dataValues = dataRange.getValues();
  var ID_INDEX = 0;

  if (shouldNormalize) {
    var validRows = [];
    var emptyCount = 0;

    // 空行の除外（メモリ上）
    for (var i = 0; i < dataValues.length; i++) {
      var idCell = dataValues[i][ID_INDEX];
      if (String(idCell == null ? "" : idCell).trim() !== "") {
        validRows.push(dataValues[i]);
      } else {
        emptyCount++;
      }
    }

    // ソート（メモリ上）: createdAt昇順
    var CREATED_AT_INDEX = 2;
    validRows.sort(function(a, b) {
      var aTs = Number(a[CREATED_AT_INDEX] == null ? 0 : a[CREATED_AT_INDEX]);
      var bTs = Number(b[CREATED_AT_INDEX] == null ? 0 : b[CREATED_AT_INDEX]);
      if (aTs < bTs) return -1;
      if (aTs > bTs) return 1;
      return 0;
    });

    // No.の振り直し（メモリ上）
    var nextNo = 1;
    for (var n = 0; n < validRows.length; n++) {
      var deletedAtText = String(validRows[n][4] == null ? "" : validRows[n][4]).trim();
      if (!deletedAtText) {
        validRows[n][1] = nextNo++;
      } else {
        validRows[n][1] = "";
      }
    }

    // 1回のAPI呼び出しでシートへ一括書き戻し
    if (validRows.length > 0) {
      sheet.getRange(dataStartRow, 1, validRows.length, lastColumn).setValues(validRows);
    }
    if (emptyCount > 0) {
      sheet.getRange(dataStartRow + validRows.length, 1, emptyCount, lastColumn).clearContent();
    }

    dataValues = validRows;
    dataRowCount = validRows.length;
  }

  if (dataRowCount === 0) return [];

  var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);

  // フォーマットの適用（メモリ上の値を変換するだけ。APIは叩かない）
  Sheets_applyTemporalFormatsToMemory_(columnPaths, dataValues, dataRowCount, temporalTypeMap);

  var records = [];
  for (var r = 0; r < dataValues.length; r++) {
    var record = Sheets_buildRecordFromRow_(dataValues[r], columnPaths);
    if (record) records.push(record);
  }

  return records;
}

// Split from sheets.gs



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

    // ソート後、No.列を1から連番でリナンバー
    var noValues = [];
    for (var n = 0; n < dataRowCount; n++) {
      noValues.push([n + 1]);
    }
    sheet.getRange(NFB_HEADER_DEPTH + 1, 2, dataRowCount, 1).setValues(noValues);
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

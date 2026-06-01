
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

  // ヘッダーから deletedAt 列の 0-based インデックスを動的解決（既定レイアウトは 4）
  var fixedColMap = Sheets_buildFixedColMapFromSheet_(sheet);
  var deletedAtCol = fixedColMap.hasOwnProperty("deletedAt") ? fixedColMap.deletedAt : 4;

  var cutoffUnixMs = Date.now() - days * NFB_MS_PER_DAY;
  var deletedCount = 0;

  // Plan P4 γ: deletedAt セルは JST 文字列を canonical とする。
  // 旧データ（Unix ms 数値）も Sheets_toStrictUnixMs_ 経由で受理する。
  var newValues = [];
  for (var i = 0; i < values.length; i++) {
    var cellValue = values[i][deletedAtCol];
    var deletedAtUnixMs = null;
    if (typeof cellValue === "string") {
      var parsed = Sheets_parseJstString_(cellValue);
      if (parsed) deletedAtUnixMs = parsed.getTime();
    } else {
      deletedAtUnixMs = Sheets_toStrictUnixMs_(cellValue);
    }
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

// シート内のソフトデリート行のうち最も古い deletedAt を Date で返す（無ければ null）。
// purge 監視キー（最古未削除日時）の再計算に使う。deletedAt 列のみ 1 パスで走査する。
function Sheets_getOldestSoftDeletedDate_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < NFB_DATA_START_ROW) return null;

  var fixedColMap = Sheets_buildFixedColMapFromSheet_(sheet);
  var deletedAtCol = fixedColMap.hasOwnProperty("deletedAt") ? fixedColMap.deletedAt : 4;

  var rowCount = lastRow - NFB_DATA_START_ROW + 1;
  var values = sheet.getRange(NFB_DATA_START_ROW, deletedAtCol + 1, rowCount, 1).getValues();

  var oldestMs = null;
  for (var i = 0; i < values.length; i++) {
    var cellValue = values[i][0];
    var deletedAtUnixMs = null;
    if (typeof cellValue === "string") {
      var parsed = Sheets_parseJstString_(cellValue);
      if (parsed) deletedAtUnixMs = parsed.getTime();
    } else {
      deletedAtUnixMs = Sheets_toStrictUnixMs_(cellValue);
    }
    if (isFinite(deletedAtUnixMs) && deletedAtUnixMs > 0) {
      if (oldestMs === null || deletedAtUnixMs < oldestMs) oldestMs = deletedAtUnixMs;
    }
  }
  return oldestMs === null ? null : new Date(oldestMs);
}

function Sheets_readColumnPaths_(sheet, lastColumn) {
  var headerMatrix = sheet.getRange(NFB_HEADER_START_ROW, 1, NFB_HEADER_DEPTH, lastColumn).getValues();
  var columnPaths = [];
  for (var col = 0; col < lastColumn; col++) {
    var path = [];
    for (var row = 0; row < NFB_HEADER_DEPTH; row++) {
      var cell = Sheets_normalizeHeaderSegment_(headerMatrix[row][col]);
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
  var fixedColMap = Sheets_buildFixedColMapFromPaths_(columnPaths);
  var idIdx = fixedColMap.hasOwnProperty("id") ? fixedColMap.id : 0;
  var id = rowData[idIdx] ? String(rowData[idIdx]) : "";
  if (!id) return null;

  // 固定メタ列: JST 文字列 `YYYY-MM-DD_HH:mm:ss.SSS` を canonical 表現とする。
  // 旧データ救済: 数値 (Unix ms / Excel シリアル値) や Date が来たら JST 文字列に正規化。
  // *UnixMs 系フィールドは過渡期シム（Plan P5 で廃止予定）。
  var formatDt = function(val) {
    if (val === null || val === undefined || val === "") return "";
    if (Sheets_isValidDate_(val)) return Sheets_formatJstString_(val);
    if (typeof val === "number" && isFinite(val)) {
      // 厳密 Unix ms 範囲のみ採用（誤入力された小さな数値は文字列保存）
      var unixMs = Sheets_toStrictUnixMs_(val);
      if (unixMs !== null) return Sheets_formatJstString_(unixMs);
      return "";
    }
    if (typeof val === "string") {
      var s = val.replace(/^\s+|\s+$/g, "");
      if (!s) return "";
      var canonical = Sheets_formatJstString_(s);
      if (canonical) return canonical;
      // canonical 化失敗時（パース不能）は原文字列を維持してデバッグしやすくする
      return s;
    }
    return "";
  };
  var formatNullableDt = function(val) {
    var s = formatDt(val);
    return s === "" ? null : s;
  };
  // JST 文字列 → Unix ms シム（過渡期に *UnixMs を期待する下流コード向け）
  var deriveUnixMs = function(jstStr) {
    if (!jstStr) return null;
    return Sheets_jstStringToUnixMs_(jstStr);
  };
  var pick = function(key, fallback) {
    if (!fixedColMap.hasOwnProperty(key)) return fallback;
    var v = rowData[fixedColMap[key]];
    return v !== undefined ? v : fallback;
  };

  var createdAtRaw = pick("createdAt", "");
  var modifiedAtRaw = pick("modifiedAt", "");
  var deletedAtRaw = pick("deletedAt", "");

  var createdAtJst = formatDt(createdAtRaw);
  var modifiedAtJst = formatDt(modifiedAtRaw);
  var deletedAtJst = formatNullableDt(deletedAtRaw);

  var record = {
    id: id,
    "No.": pick("No.", "") || "",
    createdAt: createdAtJst,
    modifiedAt: modifiedAtJst,
    deletedAt: deletedAtJst,
    createdBy: pick("createdBy", "") || "",
    modifiedBy: pick("modifiedBy", "") || "",
    deletedBy: pick("deletedBy", "") || "",
    createdAtUnixMs: deriveUnixMs(createdAtJst),
    modifiedAtUnixMs: deriveUnixMs(modifiedAtJst),
    deletedAtUnixMs: deletedAtJst ? deriveUnixMs(deletedAtJst) : null,
    data: {},
    dataUnixMs: {}
  };

  for (var j = 0; j < columnPaths.length; j++) {
    var colInfo = columnPaths[j];
    var value = rowData[colInfo.index];
    if (value != null && value !== "" && !NFB_RESERVED_HEADER_KEYS[colInfo.key]) {
      // シート上の date / time セルは数値の日時シリアル値 (Date) なので canonical 文字列に戻す
      if (Sheets_isValidDate_(value)) value = Sheets_sheetDateCellToCanonical_(value);
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

    // 空行の除外（メモリ上）
    for (var i = 0; i < dataValues.length; i++) {
      var idCell = dataValues[i][ID_INDEX];
      if (String(idCell == null ? "" : idCell).trim() !== "") {
        validRows.push(dataValues[i]);
      }
    }

    // 正規化はメモリ内のみ（シートへは書き戻さない）
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

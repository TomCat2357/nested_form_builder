function Sheets_findRowById_(sheet, id) {
  if (!id) return -1;
  var lastRow = sheet.getLastRow();
  if (lastRow < NFB_DATA_START_ROW) return -1;
  var rowCount = lastRow - NFB_DATA_START_ROW + 1;
  var lookupRange = sheet.getRange(NFB_DATA_START_ROW, 1, rowCount, 1).getValues();

  var binaryResult = Sheets_binarySearchById_(lookupRange, id);
  if (binaryResult !== -1) {
    return NFB_DATA_START_ROW + binaryResult;
  }

  for (var i = 0; i < lookupRange.length; i++) {
    if (String(lookupRange[i][0]) === String(id)) {
      return NFB_DATA_START_ROW + i;
    }
  }
  return -1;
}

function Sheets_binarySearchById_(lookupRange, targetId) {
  if (!lookupRange || lookupRange.length === 0) return -1;

  var targetStr = String(targetId);
  var left = 0;
  var right = lookupRange.length - 1;

  var firstId = String(lookupRange[0][0]);
  var lastId = String(lookupRange[right][0]);

  if (!firstId.startsWith("r_") || !lastId.startsWith("r_")) return -1;
  if (firstId > lastId) return -1;

  while (left <= right) {
    var mid = Math.floor((left + right) / 2);
    var midId = String(lookupRange[mid][0]);

    if (midId === targetStr) return mid;
    if (midId < targetStr) left = mid + 1;
    else right = mid - 1;
  }

  return -1;
}

function Sheets_findFirstBlankRow_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < NFB_DATA_START_ROW) return NFB_DATA_START_ROW;

  var rowCount = lastRow - NFB_DATA_START_ROW + 1;
  var idValues = sheet.getRange(NFB_DATA_START_ROW, 1, rowCount, 1).getValues();
  for (var i = 0; i < idValues.length; i++) {
    if (String(idValues[i][0] == null ? "" : idValues[i][0]).trim() === "") {
      return NFB_DATA_START_ROW + i;
    }
  }
  return lastRow + 1;
}

function Sheets_prepareResponses_(ctx) {
  var rawResponseKeys = (ctx.order && ctx.order.length)
    ? ctx.order
    : Object.keys(ctx.responses || {});
  var responseKeys = Sheets_normalizeHeaderKeyList_(rawResponseKeys);
  var normalizedResponses = Sheets_normalizeRecordDataKeys_(ctx.responses);

  var sortedResponses = {};
  for (var r = 0; r < responseKeys.length; r++) {
    var key = responseKeys[r];
    if (Object.prototype.hasOwnProperty.call(normalizedResponses, key)) {
      sortedResponses[key] = normalizedResponses[key];
    }
  }
  ctx.responses = sortedResponses;
  ctx.order = responseKeys;
}


function Sheets_neutralizeFormulaPrefix_(s) {
  if (typeof s !== "string" || s.length === 0) return s;
  // Triggers: =, +, -, @, TAB, CR. Sheets / Excel evaluate these as formulas.
  // The leading apostrophe is stripped on display and by Range.getValues(),
  // so legitimate users never see it.
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}


function Sheets_resolveTemporalCell_(value, temporalType) {
  if (value === undefined || value === null || value === "") {
    return { value: "", numberFormat: null };
  }
  if (temporalType !== "date" && temporalType !== "time") {
    return { value: Sheets_neutralizeFormulaPrefix_(String(value)), numberFormat: null };
  }

  var parsed = Sheets_parseDateLikeToJstDate_(value, true);
  if (!parsed) {
    return { value: Sheets_neutralizeFormulaPrefix_(String(value)), numberFormat: null };
  }
  return {
    value: parsed,
    numberFormat: temporalType === "time"
      ? (String(value).match(/^\d{1,2}:\d{2}:\d{2}$/) ? "HH:mm:ss" : "HH:mm")
      : "yyyy/MM/dd",
  };
}


function Sheets_upsertRecordById_(sheet, order, ctx, temporalTypeMap) {
  Sheets_prepareResponses_(ctx);
  Sheets_ensureHeaderMatrix_(sheet, ctx.order);
  var keyToColumn = Sheets_buildHeaderKeyMap_(sheet);
  var driveFolderUrlCol = keyToColumn.hasOwnProperty("driveFolderUrl")
    ? keyToColumn["driveFolderUrl"] - 1
    : -1;

  var lastColumn = Math.max(sheet.getLastColumn(), 9);
  var rowIndex = Sheets_findRowById_(sheet, ctx.id);
  var isNew = (rowIndex === -1);
  var currentTs = Date.now();
  var email = Session.getActiveUser().getEmail() || "";

  var rowData = new Array(lastColumn).fill("");
  var formats = new Array(lastColumn).fill(null);

  if (isNew) {
    rowIndex = Sheets_findFirstBlankRow_(sheet);
    Sheets_ensureRowCapacity_(sheet, rowIndex);

    var maxNo = 0;
    var lastRow = sheet.getLastRow();
    if (lastRow >= NFB_DATA_START_ROW) {
      var noValues = sheet.getRange(NFB_DATA_START_ROW, 2, lastRow - NFB_DATA_START_ROW + 1, 1).getValues();
      for (var i = 0; i < noValues.length; i++) {
        var val = Number(noValues[i][0]);
        if (isFinite(val) && val > maxNo) maxNo = val;
      }
    }
    ctx.id = ctx.id || Nfb_generateRecordId_();
    var insertMeta = Sync_resolveNewRecordMetadata_({
      record: ctx && ctx.raw ? ctx.raw : {},
      fallbackRecordNo: maxNo + 1,
      fallbackCreatedAt: currentTs,
      fallbackCreatedBy: email,
    });

    rowData[0] = ctx.id;
    rowData[1] = insertMeta.recordNo;
    rowData[2] = insertMeta.createdAt;
    rowData[3] = currentTs; // modifiedAt
    rowData[5] = insertMeta.createdBy;
    rowData[6] = email;     // modifiedBy
    if (driveFolderUrlCol >= 0) {
      rowData[driveFolderUrlCol] = ctx.raw.driveFolderUrl || "";
    }
  } else {
    var existingValues = sheet.getRange(rowIndex, 1, 1, lastColumn).getValues()[0];
    for (var c = 0; c < lastColumn; c++) rowData[c] = existingValues[c] !== undefined ? existingValues[c] : "";

    for (var key in keyToColumn) {
      if (keyToColumn.hasOwnProperty(key) && !NFB_RESERVED_HEADER_KEYS[key]) {
        var colIdx = keyToColumn[key] - 1;
        if (colIdx >= 0 && colIdx < lastColumn) rowData[colIdx] = "";
      }
    }
    rowData[3] = currentTs; // modifiedAt
    rowData[6] = email;     // modifiedBy
    if (driveFolderUrlCol >= 0) {
      rowData[driveFolderUrlCol] = ctx.raw.driveFolderUrl || "";
    }
  }

  formats[2] = "0";
  formats[3] = "0";

  for (var k = 0; k < ctx.order.length; k++) {
    var kName = String(ctx.order[k] || "");
    if (!kName || NFB_RESERVED_HEADER_KEYS[kName]) continue;
    var cIdx = keyToColumn[kName] - 1;
    if (cIdx < 0) continue;

    var val = ctx.responses && ctx.responses.hasOwnProperty(kName) ? ctx.responses[kName] : "";
    var tType = temporalTypeMap && temporalTypeMap[kName] ? temporalTypeMap[kName] : null;
    var norm = Sheets_resolveTemporalCell_(val, tType);

    rowData[cIdx] = norm.value;
    if (norm.numberFormat) formats[cIdx] = norm.numberFormat;
  }

  var range = sheet.getRange(rowIndex, 1, 1, lastColumn);
  range.setValues([rowData]);

  var needFormatWrite = false;
  for (var f = 0; f < formats.length; f++) {
    if (formats[f]) { needFormatWrite = true; break; }
  }
  if (needFormatWrite) {
    var currentFormats = range.getNumberFormats()[0];
    for (var ff = 0; ff < formats.length; ff++) {
      if (formats[ff]) currentFormats[ff] = formats[ff];
    }
    range.setNumberFormats([currentFormats]);
  }

  Sheets_touchSheetLastUpdated_(sheet, currentTs);

  return { row: rowIndex, id: ctx.id, recordNo: rowData[1] };
}

function Sheets_deleteRecordById_(sheet, id) {
  var rowIndex = Sheets_findRowById_(sheet, id);
  if (rowIndex === -1) return { ok: false, error: "Record not found" };

  var now = Date.now();
  var email = Session.getActiveUser().getEmail() || "";

  // 固定メタ列は常に Col 2(No.) 〜 Col 8(deletedBy) の 7 列。driveFolderUrl は触らない。
  var range = sheet.getRange(rowIndex, 2, 1, 7);
  var values = range.getValues()[0];
  var formats = range.getNumberFormats()[0];

  values[0] = "";      // No.
  values[2] = now;     // modifiedAt
  values[3] = now;     // deletedAt
  values[5] = email;   // modifiedBy
  values[6] = email;   // deletedBy
  formats[2] = "0";
  formats[3] = "0";

  range.setValues([values]);
  range.setNumberFormats([formats]);

  Sheets_touchSheetLastUpdated_(sheet, now);
  SetServerModifiedAt_(now);
  return { ok: true, row: rowIndex, id: id };
}

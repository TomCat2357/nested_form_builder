// Split from sheets.gs



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
  var rowIndex = Sheets_findFirstBlankRow_(sheet);

  Sheets_ensureRowCapacity_(sheet, rowIndex);
  var nowSerial = Sheets_dateToSerial_(new Date());
  var email = Session.getActiveUser().getEmail() || "";

  var maxNo = 0;
  var lastRow = sheet.getLastRow();
  if (lastRow >= NFB_DATA_START_ROW) {
    var noValues = sheet.getRange(NFB_DATA_START_ROW, 2, lastRow - NFB_DATA_START_ROW + 1, 1).getValues();
    for (var i = 0; i < noValues.length; i++) {
      var val = Number(noValues[i][0]);
      if (Number.isFinite(val) && val > maxNo) maxNo = val;
    }
  }

  sheet.getRange(rowIndex, 1).setValue(String(nextId));
  sheet.getRange(rowIndex, 2).setValue(String(maxNo + 1));
  sheet.getRange(rowIndex, 3).setValue(nowSerial);
  sheet.getRange(rowIndex, 4).setValue(nowSerial);
  sheet.getRange(rowIndex, 5).setValue(email);
  sheet.getRange(rowIndex, 6).setValue(email);
  Sheets_touchSheetLastUpdated_(sheet, nowSerial);

  return { rowIndex: rowIndex, id: nextId, recordNo: maxNo + 1 };
}

function Sheets_updateExistingRow_(sheet, rowIndex) {
  Sheets_ensureRowCapacity_(sheet, rowIndex);
  var nowSerial = Sheets_dateToSerial_(new Date());
  var email = Session.getActiveUser().getEmail() || "";
  sheet.getRange(rowIndex, 4).setValue(nowSerial);
  sheet.getRange(rowIndex, 6).setValue(email);
  Sheets_touchSheetLastUpdated_(sheet, nowSerial);
}

function Sheets_clearDataRow_(sheet, rowIndex, keyToColumn, reservedHeaderKeys) {
  for (var key in keyToColumn) {
    if (Object.prototype.hasOwnProperty.call(keyToColumn, key) && !reservedHeaderKeys[key]) {
      var columnIndex = keyToColumn[key];
      if (columnIndex) sheet.getRange(rowIndex, columnIndex).setValue("");
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
  var recordNo;

  if (rowIndex === -1) {
    var newRow = Sheets_createNewRow_(sheet, ctx.id);
    rowIndex = newRow.rowIndex;
    ctx.id = newRow.id;
    recordNo = newRow.recordNo;
  } else {
    Sheets_updateExistingRow_(sheet, rowIndex);
    Sheets_clearDataRow_(sheet, rowIndex, keyToColumn, reservedHeaderKeys);
    recordNo = sheet.getRange(rowIndex, 2).getValue();
  }

  Sheets_writeDataToRow_(sheet, rowIndex, ctx.order, ctx.responses, keyToColumn, reservedHeaderKeys);

  return { row: rowIndex, id: ctx.id, recordNo: recordNo };
}

function Sheets_deleteRecordById_(sheet, id) {
  var rowIndex = Sheets_findRowById_(sheet, id);

  if (rowIndex === -1) {
    return { ok: false, error: "Record not found" };
  }

  sheet.deleteRow(rowIndex);
  Sheets_touchSheetLastUpdated_(sheet);
  return { ok: true, row: rowIndex, id: id };
}

// Split from sheets.gs



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

  return { rowIndex: rowIndex, id: nextId, recordNo: maxNo + 1 };
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

  return { row: rowIndex, id: ctx.id, recordNo: recordNo };
}

function Sheets_deleteRecordById_(sheet, id) {
  var rowIndex = Sheets_findRowById_(sheet, id);

  if (rowIndex === -1) {
    return { ok: false, error: "Record not found" };
  }

  sheet.deleteRow(rowIndex);
  return { ok: true, row: rowIndex, id: id };
}


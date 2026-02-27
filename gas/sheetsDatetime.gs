// Split from sheets.gs



function Sheets_getCurrentDateTimeString_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss");
}

function Sheets_isValidDate_(date) {
  return date instanceof Date && !isNaN(date.getTime());
}

function Sheets_normalizeNumericToUnixMs_(value, allowSerialNumber) {
  if (typeof value !== "number" || !isFinite(value)) return null;
  var abs = Math.abs(value);
  if (abs >= 100000000000) return value;
  if (abs >= 1000000000) return value * 1000;
  if (allowSerialNumber) return NFB_SHEETS_EPOCH_MS + value * NFB_MS_PER_DAY;
  return null;
}

function Sheets_parseNumericToDate_(value, allowSerialNumber) {
  var unixMs = Sheets_normalizeNumericToUnixMs_(value, allowSerialNumber);
  if (!Number.isFinite(unixMs)) return null;
  var d = new Date(unixMs);
  return Sheets_isValidDate_(d) ? d : null;
}

function Sheets_serialToDate_(serial) {
  return Sheets_parseNumericToDate_(serial, true);
}

function Sheets_parseDateLikeToJstDate_(value, allowSerialNumber) {
  if (value === null || value === undefined) return null;
  if (Sheets_isValidDate_(value)) return value;

  if (allowSerialNumber) {
    if (typeof value === "number" && isFinite(value)) {
      return Sheets_parseNumericToDate_(value, true);
    }
    if (typeof value === "string") {
      var numeric = value.trim();
      if (/^[-+]?\d+(?:\.\d+)?$/.test(numeric)) {
        var numericValue = parseFloat(numeric);
        if (isFinite(numericValue)) {
          return Sheets_parseNumericToDate_(numericValue, true);
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

  var range = sheet.getRange(NFB_DATA_START_ROW, columnIndex + 1, dataRowCount, 1);
  range.setValues(converted);
  range.setNumberFormat(numberFormat);
}

function Sheets_applyUnixMsNumberFormatToColumn_(sheet, columnIndex, values, dataRowCount, allowSerialNumber) {
  var converted = [];
  for (var i = 0; i < dataRowCount; i++) {
    var cell = values[i][columnIndex];
    if (cell === null || cell === undefined || cell === "") {
      converted.push([""]);
      continue;
    }

    var unixMs = Sheets_toUnixMs_(cell, allowSerialNumber);
    if (unixMs !== null && isFinite(unixMs)) {
      converted.push([unixMs]);
      continue;
    }

    if (typeof cell === "number" && isFinite(cell)) {
      converted.push([cell]);
      continue;
    }

    if (typeof cell === "string") {
      var trimmed = cell.trim();
      if (/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) {
        var numeric = parseFloat(trimmed);
        converted.push([isFinite(numeric) ? numeric : cell]);
        continue;
      }
    }

    converted.push([cell]);
  }

  var range = sheet.getRange(NFB_DATA_START_ROW, columnIndex + 1, dataRowCount, 1);
  range.setValues(converted);
  range.setNumberFormat("0");
}

function Sheets_applyTemporalFormats_(sheet, columnPaths, values, dataRowCount, explicitTypeMap) {
  if (!dataRowCount) return;

  var keyToIndex = {};
  for (var i = 0; i < columnPaths.length; i++) {
    keyToIndex[columnPaths[i].key] = columnPaths[i].index;
  }

  var dateFormat = "yyyy/MM/dd";
  var timeFormat = "HH:mm";

  var createdAtIndex = keyToIndex["createdAt"];
  var modifiedAtIndex = keyToIndex["modifiedAt"];

  var applyFormat = function(colIndex, format) {
    if (typeof colIndex === "number") {
      Sheets_applyTemporalFormatToColumn_(sheet, colIndex, values, dataRowCount, format);
    }
  };
  if (typeof createdAtIndex === "number") {
    sheet.getRange(NFB_DATA_START_ROW, createdAtIndex + 1, dataRowCount, 1).setNumberFormat("@");
  }
  if (typeof modifiedAtIndex === "number") {
    sheet.getRange(NFB_DATA_START_ROW, modifiedAtIndex + 1, dataRowCount, 1).setNumberFormat("@");
  }

  var reservedKeys = { "id": true, "No.": true, "createdAt": true, "modifiedAt": true, "createdBy": true, "modifiedBy": true };
  var hasExplicitMap = explicitTypeMap && typeof explicitTypeMap === "object";
  for (var j = 0; j < columnPaths.length; j++) {
    var colInfo = columnPaths[j];
    if (reservedKeys[colInfo.key]) continue;
    if (hasExplicitMap) {
      var explicitType = explicitTypeMap[colInfo.key];
      if (explicitType === "date") { applyFormat(colInfo.index, dateFormat); continue; }
      if (explicitType === "time") { applyFormat(colInfo.index, timeFormat); continue; }
    }
    var temporalType = Sheets_detectTemporalColumnType_(values, colInfo.index);
    if (temporalType === "date") applyFormat(colInfo.index, dateFormat);
    else if (temporalType === "time") applyFormat(colInfo.index, timeFormat);
  }
}

function Sheets_toDateOrOriginal_(value) {
  var parsed = Sheets_parseDateLikeToJstDate_(value);
  return parsed || value;
}

function Sheets_dateToSerial_(date) {
  if (!Sheets_isValidDate_(date)) return null;
  return date.getTime();
}

function Sheets_toUnixMs_(value, allowSerialNumber) {
  var d = Sheets_parseDateLikeToJstDate_(value, allowSerialNumber);
  return d ? d.getTime() : null;
}


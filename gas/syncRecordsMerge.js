function Sync_isBlankCellValue_(value) {
  return value === "" || value === null || value === undefined;
}

function Sync_fillEmptySheetCellsFromRecord_(params) {
  var rowData = params && Array.isArray(params.rowData) ? params.rowData : [];
  var rowFormats = params && Array.isArray(params.rowFormats) ? params.rowFormats : [];
  var order = params && Array.isArray(params.order) ? params.order : [];
  var keyToColumn = params && params.keyToColumn ? params.keyToColumn : {};
  var normalizedRecordData = params && params.normalizedRecordData ? params.normalizedRecordData : {};
  var temporalTypeMap = params && params.temporalTypeMap ? params.temporalTypeMap : {};
  var normalizeCell = params && typeof params.normalizeCell === "function"
    ? params.normalizeCell
    : function(value) { return { value: value, numberFormat: null }; };
  var reservedKeys = params && params.reservedKeys
    ? params.reservedKeys
    : (typeof NFB_RESERVED_HEADER_KEYS !== "undefined" ? NFB_RESERVED_HEADER_KEYS : {});
  var changed = false;

  for (var k = 0; k < order.length; k++) {
    var keyName = String(order[k] || "");
    if (!keyName || reservedKeys[keyName]) continue;
    if (!Object.prototype.hasOwnProperty.call(normalizedRecordData, keyName)) continue;

    var colIdx = Number(keyToColumn[keyName]) - 1;
    if (!isFinite(colIdx) || colIdx < 0 || colIdx >= rowData.length) continue;
    if (!Sync_isBlankCellValue_(rowData[colIdx])) continue;

    var rawValue = normalizedRecordData[keyName];
    if (Sync_isBlankCellValue_(rawValue)) continue;

    var normalized = normalizeCell(rawValue, temporalTypeMap[keyName] || null) || {};
    if (Sync_isBlankCellValue_(normalized.value)) continue;

    rowData[colIdx] = normalized.value;
    if (normalized.numberFormat) rowFormats[colIdx] = normalized.numberFormat;
    changed = true;
  }

  return changed;
}

if (typeof module !== "undefined") {
  module.exports = {
    Sync_fillEmptySheetCellsFromRecord_,
    Sync_isBlankCellValue_,
  };
}

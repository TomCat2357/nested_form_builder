function Sync_isBlankCellValue_(value) {
  return value === "" || value === null || value === undefined;
}

function Sync_shouldApplyRecordToSheet_(params) {
  var hasSheetRow = params && params.hasSheetRow === true;
  var cacheModifiedAt = Number(params && params.cacheModifiedAt);
  var sheetModifiedAt = Number(params && params.sheetModifiedAt);

  if (!hasSheetRow) return true;
  if (!(isFinite(sheetModifiedAt) && sheetModifiedAt > 0)) return true;
  return isFinite(cacheModifiedAt) && cacheModifiedAt > sheetModifiedAt;
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

function Sync_getFixedMetaColumnValue_(record, key, toUnixMs) {
  if (key === "No.") {
    var parsedRecordNo = parseInt(record["No."], 10);
    return isFinite(parsedRecordNo) && parsedRecordNo > 0 ? parsedRecordNo : "";
  }

  if (key === "createdAt" || key === "modifiedAt" || key === "deletedAt") {
    var unixMsFieldName = key + "UnixMs";
    var unixMs = parseInt(record[unixMsFieldName], 10);
    if (!(isFinite(unixMs) && unixMs > 0)) {
      unixMs = toUnixMs(record[key]);
    }
    return isFinite(unixMs) && unixMs > 0 ? unixMs : "";
  }

  if (key === "createdBy" || key === "modifiedBy" || key === "deletedBy") {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return "";
    return String(record[key] == null ? "" : record[key]);
  }

  return "";
}

function Sync_syncFixedMetaColumnsFromRecord_(params) {
  var rowData = params && Array.isArray(params.rowData) ? params.rowData : [];
  var rowFormats = params && Array.isArray(params.rowFormats) ? params.rowFormats : [];
  var record = params && params.record ? params.record : {};
  var mode = params && params.mode === "overwrite" ? "overwrite" : "fillBlank";
  var toUnixMs = params && typeof params.toUnixMs === "function"
    ? params.toUnixMs
    : function(value) {
      // 固定メタ列は Unix ms 厳密解釈（×1000 / Excel シリアル値の再解釈をしない）
      if (typeof Sheets_toStrictUnixMs_ === "function") {
        return Sheets_toStrictUnixMs_(value);
      }
      var parsed = parseInt(value, 10);
      return isFinite(parsed) ? parsed : null;
    };
  var fixedColMap = params && params.fixedColMap ? params.fixedColMap : null;
  var resolveColIdx = function(key, fallback) {
    if (fixedColMap && fixedColMap.hasOwnProperty(key)) return fixedColMap[key];
    return fallback;
  };

  var baseSpecs = mode === "overwrite"
    ? [
      { key: "No.", colIdx: resolveColIdx("No.", 1), numberFormat: "0" },
      { key: "createdAt", colIdx: resolveColIdx("createdAt", 2), numberFormat: "0" },
      { key: "modifiedAt", colIdx: resolveColIdx("modifiedAt", 3), numberFormat: "0" },
      { key: "deletedAt", colIdx: resolveColIdx("deletedAt", 4), numberFormat: "0" },
      { key: "createdBy", colIdx: resolveColIdx("createdBy", 5), numberFormat: null },
      { key: "modifiedBy", colIdx: resolveColIdx("modifiedBy", 6), numberFormat: null },
      { key: "deletedBy", colIdx: resolveColIdx("deletedBy", 7), numberFormat: null },
    ]
    : [
      { key: "No.", colIdx: resolveColIdx("No.", 1), numberFormat: "0" },
      { key: "createdAt", colIdx: resolveColIdx("createdAt", 2), numberFormat: "0" },
      { key: "deletedAt", colIdx: resolveColIdx("deletedAt", 4), numberFormat: "0" },
      { key: "createdBy", colIdx: resolveColIdx("createdBy", 5), numberFormat: null },
      { key: "modifiedBy", colIdx: resolveColIdx("modifiedBy", 6), numberFormat: null },
      { key: "deletedBy", colIdx: resolveColIdx("deletedBy", 7), numberFormat: null },
    ];
  // colIdx < 0 のものは対象外（シートに該当列が存在しない）
  var specs = [];
  for (var s = 0; s < baseSpecs.length; s++) {
    if (baseSpecs[s].colIdx >= 0) specs.push(baseSpecs[s]);
  }
  var changed = false;

  for (var i = 0; i < specs.length; i++) {
    var spec = specs[i];
    if (spec.colIdx < 0 || spec.colIdx >= rowData.length) continue;

    var nextValue = Sync_getFixedMetaColumnValue_(record, spec.key, toUnixMs);
    if (mode === "fillBlank") {
      if (!Sync_isBlankCellValue_(rowData[spec.colIdx])) continue;
      if (Sync_isBlankCellValue_(nextValue)) continue;
    }

    if (rowData[spec.colIdx] !== nextValue) {
      rowData[spec.colIdx] = nextValue;
      changed = true;
    }

    if (spec.numberFormat && rowFormats[spec.colIdx] !== spec.numberFormat) {
      rowFormats[spec.colIdx] = spec.numberFormat;
      changed = true;
    }
  }

  return changed;
}

function Sync_resolveNewRecordMetadata_(params) {
  var record = params && params.record ? params.record : {};
  var fallbackRecordNo = Number(params && params.fallbackRecordNo);
  var fallbackCreatedAt = Number(params && params.fallbackCreatedAt);
  var fallbackCreatedBy = params && params.fallbackCreatedBy ? String(params.fallbackCreatedBy) : "";
  var toUnixMs = params && typeof params.toUnixMs === "function"
    ? params.toUnixMs
    : function(value) {
      // 固定メタ列は Unix ms 厳密解釈（×1000 / Excel シリアル値の再解釈をしない）
      if (typeof Sheets_toStrictUnixMs_ === "function") {
        return Sheets_toStrictUnixMs_(value);
      }
      var parsed = parseInt(value, 10);
      return isFinite(parsed) ? parsed : null;
    };

  var parsedRecordNo = parseInt(record["No."], 10);
  var recordNo = isFinite(parsedRecordNo) && parsedRecordNo > 0
    ? parsedRecordNo
    : fallbackRecordNo;
  if (!isFinite(recordNo) || recordNo <= 0) {
    recordNo = 1;
  }

  var createdAt = parseInt(record.createdAtUnixMs, 10);
  if (!(isFinite(createdAt) && createdAt > 0)) {
    createdAt = toUnixMs(record.createdAt);
  }
  if (!(isFinite(createdAt) && createdAt > 0)) {
    createdAt = isFinite(fallbackCreatedAt) && fallbackCreatedAt > 0
      ? fallbackCreatedAt
      : Date.now();
  }

  var hasCreatedBy = Object.prototype.hasOwnProperty.call(record, "createdBy");
  var createdBy = hasCreatedBy ? String(record.createdBy == null ? "" : record.createdBy) : fallbackCreatedBy;

  return {
    recordNo: recordNo,
    createdAt: createdAt,
    createdBy: createdBy || "",
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    Sync_shouldApplyRecordToSheet_,
    Sync_fillEmptySheetCellsFromRecord_,
    Sync_syncFixedMetaColumnsFromRecord_,
    Sync_isBlankCellValue_,
    Sync_resolveNewRecordMetadata_,
  };
}

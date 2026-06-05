function Sheets_getOrCreateSheet_(spreadsheetId, sheetName) {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");

  var ss;
  try {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } catch (err) {
    throw new Error(Sheets_translateOpenError_(err, spreadsheetId));
  }
  // 回答は日本ローカルタイムで保存する。date / time / 日時セルは数値の日時シリアル値
  // (Date オブジェクト) で書き込むため、スプレッドシートのタイムゾーンが Asia/Tokyo (= NFB_TZ)
  // でないと壁時計表示がずれる。ユーザー指定の既存スプレッドシートも含めて揃える。
  try {
    if (ss.getSpreadsheetTimeZone() !== NFB_TZ) ss.setSpreadsheetTimeZone(NFB_TZ);
  } catch (tzErr) {
    Logger.log("[Sheets_getOrCreateSheet_] setSpreadsheetTimeZone failed: " + tzErr);
  }
  var resolvedSheetName = sheetName || NFB_DEFAULT_SHEET_NAME;
  var sheet = ss.getSheetByName(resolvedSheetName);
  return sheet || ss.insertSheet(resolvedSheetName);
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
  Sheets_ensureRowCapacity_(sheet, NFB_DATA_START_ROW);
  var range = sheet.getRange(NFB_HEADER_START_ROW, 1, NFB_HEADER_DEPTH, lastColumn);
  return range.getValues();
}


function Sheets_touchSheetLastUpdated_(sheet, tsString) {
  var parent = sheet ? sheet.getParent() : null;
  var spreadsheetId = parent ? parent.getId() : "";
  var sheetName = sheet ? sheet.getName() : NFB_DEFAULT_SHEET_NAME;
  return SetSheetLastUpdatedAt_(spreadsheetId, sheetName, tsString);
}

function Sheets_readSheetLastUpdated_(sheet) {
  var parent = sheet ? sheet.getParent() : null;
  var spreadsheetId = parent ? parent.getId() : "";
  var sheetName = sheet ? sheet.getName() : NFB_DEFAULT_SHEET_NAME;
  return GetSheetLastUpdatedAt_(spreadsheetId, sheetName);
}

function Sheets_normalizeHeaderSegment_(segment) {
  if (segment === undefined || segment === null) return "";
  return String(segment).replace(/\r\n?/g, "\n").trim();
}

function Sheets_normalizeHeaderPath_(path) {
  var normalized = [];
  if (!Array.isArray(path)) return normalized;
  for (var i = 0; i < path.length && i < NFB_HEADER_DEPTH; i++) {
    var segment = Sheets_normalizeHeaderSegment_(path[i]);
    if (!segment) break;
    normalized.push(segment);
  }
  return normalized;
}

function Sheets_normalizeHeaderKey_(key) {
  if (key === undefined || key === null) return "";
  return Sheets_pathKey_(Nfb_splitFieldKey_(key));
}

function Sheets_normalizeHeaderKeyList_(keys) {
  var normalized = [];
  var seen = {};
  var list = Array.isArray(keys) ? keys : [];
  for (var i = 0; i < list.length; i++) {
    var key = Sheets_normalizeHeaderKey_(list[i]);
    if (!key || seen[key]) continue;
    seen[key] = true;
    normalized.push(key);
  }
  return normalized;
}

function Sheets_normalizeRecordDataKeys_(data) {
  var normalized = {};
  if (!data || typeof data !== "object") return normalized;

  for (var key in data) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    var normalizedKey = Sheets_normalizeHeaderKey_(key);
    if (!normalizedKey || Object.prototype.hasOwnProperty.call(normalized, normalizedKey)) continue;
    normalized[normalizedKey] = data[key];
  }

  return normalized;
}

function Sheets_extractColumnPaths_(matrix) {
  var paths = [];
  if (!matrix || !matrix.length) return paths;
  for (var col = 0; col < matrix[0].length; col++) {
    var path = [];
    for (var row = 0; row < NFB_HEADER_DEPTH; row++) {
      var cell = Sheets_normalizeHeaderSegment_(matrix[row] ? matrix[row][col] : "");
      if (!cell) break;
      path.push(cell);
    }
    if (path.length) paths.push(path);
  }
  return paths;
}

function Sheets_pathKey_(path) {
  return Nfb_joinFieldPath_(Sheets_normalizeHeaderPath_(path));
}

// シートヘッダ用のパスセグメント解決 (改行正規化 + 空ラベル扱い)。
// Sheets_collectTemporalPathMap_ 側では空ラベルは subtree ごとスキップ、
// Sheets_buildOrderFromSchema_ 側では fallback "質問 X.Y (type)" を使う。
function Sheets_headerFieldSegmentSkipEmpty_(field) {
  return Sheets_normalizeHeaderSegment_(field && field.label) || null;
}

function Sheets_headerFieldSegmentWithFallback_(field, ctx) {
  var label = Sheets_normalizeHeaderSegment_(field && field.label);
  if (label) return label;
  var type = field && field.type !== undefined && field.type !== null
    ? String(field.type).trim() : "";
  return "質問 " + ctx.indexTrail.join(".") + " (" + (type || "unknown") + ")";
}

function Sheets_headerBranchSegment_(optionKey) {
  return Sheets_normalizeHeaderSegment_(optionKey) || null;
}

function Sheets_collectTemporalPathMap_(schema) {
  var map = {};
  nfbTraverseSchema_(schema, function(field, ctx) {
    if (field.type === "date" || field.type === "time") {
      map[Nfb_joinFieldPath_(ctx.pathSegments)] = field.type;
    }
  }, {
    fieldSegment: Sheets_headerFieldSegmentSkipEmpty_,
    branchSegment: Sheets_headerBranchSegment_
  });
  return map;
}

function Sheets_buildOrderFromSchema_(schema) {
  var order = [];
  var seen = {};
  var singleValueTypes = {
    text: true,
    textarea: true,
    number: true,
    regex: true,
    date: true,
    time: true,
    url: true,
    userName: true,
    email: true,
    phone: true,
    fileUpload: true,
    substitution: true
  };

  var appendKey = function(key) {
    var normalized = Sheets_normalizeHeaderKey_(key);
    if (!normalized || seen[normalized]) return;
    seen[normalized] = true;
    order.push(normalized);
  };

  nfbTraverseSchema_(schema, function(field, ctx) {
    var type = field.type !== undefined && field.type !== null ? String(field.type).trim() : "";
    var baseKey = Nfb_joinFieldPath_(ctx.pathSegments);

    if (type === "checkboxes" || type === "radio" || type === "select") {
      // 元データ方式: 選択肢はオプションごとに `親/選択肢` 列を作る（セルはマーカー "●" / 空白）。
      if (Array.isArray(field.options)) {
        for (var optIndex = 0; optIndex < field.options.length; optIndex++) {
          var option = field.options[optIndex];
          var optionLabel = Sheets_normalizeHeaderSegment_(option && option.label);
          appendKey(optionLabel
            ? baseKey + NFB_PATH_SEP + Nfb_escapeSegment_(optionLabel, NFB_PATH_SEP)
            : baseKey + NFB_PATH_SEP);
        }
      }
    } else if (type !== "message" && singleValueTypes[type]) {
      appendKey(baseKey);
    }
  }, {
    fieldSegment: Sheets_headerFieldSegmentWithFallback_,
    branchSegment: Sheets_headerBranchSegment_
  });

  return order;
}

function Sheets_initializeHeaders_(spreadsheetId, sheetName, schema) {
  var sheet = Sheets_getOrCreateSheet_(spreadsheetId, sheetName || NFB_DEFAULT_SHEET_NAME);
  var order = Sheets_buildOrderFromSchema_(schema);
  return Sheets_ensureHeaderMatrix_(sheet, order);
}

function Sheets_buildDesiredPaths_(order, existingPaths) {
  var desired = [];
  var seen = {};

  NFB_FIXED_HEADER_PATHS.forEach(function (path) {
    var normalizedPath = Sheets_normalizeHeaderPath_(path);
    if (!normalizedPath.length) return;
    var key = Sheets_pathKey_(normalizedPath);
    if (!seen[key]) {
      desired.push(normalizedPath);
      seen[key] = true;
    }
  });

  (order || []).forEach(function (keyRaw) {
    var parts = Sheets_normalizeHeaderPath_(Nfb_splitFieldKey_(keyRaw || ""));
    if (!parts.length) return;
    var key = Sheets_pathKey_(parts);
    if (!seen[key]) {
      desired.push(parts);
      seen[key] = true;
    }
  });

  (existingPaths || []).forEach(function (path) {
    var normalizedPath = Sheets_normalizeHeaderPath_(path);
    if (!normalizedPath.length) return;
    var key = Sheets_pathKey_(normalizedPath);
    if (!seen[key]) {
      desired.push(normalizedPath);
      seen[key] = true;
    }
  });

  return desired;
}

function Sheets_writeHeaderPath_(sheet, columnIndex, path) {
  var normalizedPath = Sheets_normalizeHeaderPath_(path);
  var values = [];
  for (var row = 0; row < NFB_HEADER_DEPTH; row++) {
    values.push([row < normalizedPath.length ? normalizedPath[row] : ""]);
  }
  sheet.getRange(NFB_HEADER_START_ROW, columnIndex, NFB_HEADER_DEPTH, 1).setValues(values);
}

// 指定の 1-based 位置に空列を 1 本挿入する。col1Based が現行の最大列数以内なら
// その位置の手前へ挿入（既存列を右へシフト）、超える場合は末尾へ不足分を追加する。
function Sheets_insertColumnAt_(sheet, col1Based) {
  var maxCols = sheet.getMaxColumns();
  if (col1Based <= maxCols) {
    sheet.insertColumnsBefore(col1Based, 1);
  } else {
    sheet.insertColumnsAfter(maxCols, col1Based - maxCols);
  }
}

// 予約メタ列（NFB_FIXED_HEADER_PATHS）を配列順どおり先頭の固定位置（メタ列 i → 物理列 i+1）へ揃える。
// 位置が正規でなければ修整する: 欠落していれば正規位置へ挿入、別位置にあれば正規位置へ移動。
// pid を含む全メタ列を一律に扱い、pid だけの特別処理は持たない。データ列は後方へ押し出される。
// 既に正規配置のシート（通常ケース）では一切ミューテートしない。
function Sheets_repairMetaColumnPositions_(sheet) {
  var changed = false;
  var colPaths = [];
  var refresh = function() {
    var lc = sheet.getLastColumn();
    colPaths = lc > 0 ? Sheets_readColumnPaths_(sheet, lc) : [];
  };
  var findCol1Based = function(key) {
    for (var c = 0; c < colPaths.length; c++) {
      if (colPaths[c].key === key) return colPaths[c].index + 1;
    }
    return -1;
  };

  refresh();
  for (var i = 0; i < NFB_FIXED_HEADER_PATHS.length; i++) {
    var path = Sheets_normalizeHeaderPath_(NFB_FIXED_HEADER_PATHS[i]);
    if (!path.length) continue;
    var targetCol = i + 1; // 1-based 正規位置
    var key = Sheets_pathKey_(path);
    var current = findCol1Based(key);

    if (current === targetCol) continue;

    if (current === -1) {
      // 欠落 → 正規位置へ挿入してヘッダーを書く
      Sheets_insertColumnAt_(sheet, targetCol);
      Sheets_writeHeaderPath_(sheet, targetCol, path);
    } else {
      // 位置ずれ → 正規位置へ移動。先行メタ列は確定済みなので current > targetCol が保証され、
      // moveColumns は移動先 < 移動元で安定動作する。
      sheet.moveColumns(sheet.getRange(1, current, sheet.getMaxRows(), 1), targetCol);
    }
    changed = true;
    refresh(); // 列位置が変わったので取り直す
  }
  return changed;
}

function Sheets_ensureHeaderMatrix_(sheet, order) {
  Sheets_ensureRowCapacity_(sheet, NFB_DATA_START_ROW);
  if (sheet.getFrozenRows() !== NFB_DATA_START_ROW - 1) {
    sheet.setFrozenRows(NFB_DATA_START_ROW - 1);
  }

  // 1) 予約メタ列を正規の先頭固定位置へ揃える（欠落は挿入・位置ずれは移動）。
  Sheets_repairMetaColumnPositions_(sheet);

  // 2) データ列（非予約）で欠けているものを末尾へ追加（既存データ列は移動しない）。
  var matrix = Sheets_readHeaderMatrix_(sheet);
  var existingPaths = Sheets_extractColumnPaths_(matrix);
  var desired = Sheets_buildDesiredPaths_(order, existingPaths);

  var existingKeySet = {};
  existingPaths.forEach(function(path) {
    existingKeySet[Sheets_pathKey_(path)] = true;
  });

  for (var i = 0; i < desired.length; i++) {
    var path = desired[i];
    var key = Sheets_pathKey_(path);
    if (existingKeySet[key]) continue;
    // 予約メタ列は手順1で配置済み。残り（データ列）だけ末尾へ追加する。
    if (path.length === 1 && NFB_RESERVED_HEADER_KEYS[path[0]]) continue;
    var newColIndex = sheet.getLastColumn() + 1;
    Sheets_ensureColumnExists_(sheet, newColIndex);
    Sheets_writeHeaderPath_(sheet, newColIndex, path);
    existingKeySet[key] = true;
  }

  Sheets_touchSheetLastUpdated_(sheet);
  return sheet.getRange(NFB_HEADER_START_ROW, 1, NFB_HEADER_DEPTH, sheet.getLastColumn()).getValues();
}

function Sheets_buildHeaderKeyMap_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (!lastColumn) return {};
  var values = sheet.getRange(NFB_HEADER_START_ROW, 1, NFB_HEADER_DEPTH, lastColumn).getValues();
  var paths = Sheets_extractColumnPaths_(values);
  var map = {};
  for (var col = 0; col < paths.length; col++) {
    map[Sheets_pathKey_(paths[col])] = col + 1;
  }
  return map;
}

/**
 * 固定メタ列（id, No., createdAt, ..., deletedBy）の 0-based インデックス マップ。
 * ヘッダー パスから動的に解決するため、シート上で列位置が想定と異なっても動作する。
 * 存在しないキーはマップに含まれない（呼び出し側で有無を確認してから参照すること）。
 */
function Sheets_buildFixedColMapFromPaths_(columnPaths) {
  var map = {};
  if (!columnPaths || !columnPaths.length) return map;
  for (var i = 0; i < columnPaths.length; i++) {
    var p = columnPaths[i];
    if (p && p.path && p.path.length === 1 && NFB_RESERVED_HEADER_KEYS[p.path[0]]) {
      map[p.path[0]] = p.index;
    }
  }
  return map;
}

function Sheets_buildFixedColMapFromSheet_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (!lastColumn) return {};
  var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);
  return Sheets_buildFixedColMapFromPaths_(columnPaths);
}

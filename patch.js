// patch.js
// Robust function-level patcher for nested_form_builder GAS sources.
// - Avoids brittle regex that can cut functions mid-body
// - Replaces functions by parsing matching braces (simple JS lexer-lite)
// - Appends helper function only once (with a stable marker)
// - Replaces SyncRecords_ from whichever file currently defines it (Code.gs etc.)

const fs = require("fs");
const path = require("path");

/** ------------------------------
 *  Low-level utilities
 *  ------------------------------ */

const readText = (filePath) => fs.readFileSync(filePath, "utf8");
const writeText = (filePath, content) =>
  fs.writeFileSync(filePath, content, "utf8");
const resolvePath = (rel) => path.resolve(__dirname, rel);

const log = {
  ok: (msg) => console.log(`✅ ${msg}`),
  warn: (msg) => console.log(`⚠️  ${msg}`),
  err: (msg) => console.error(`❌ ${msg}`),
};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find the index of the matching '}' for a '{' at openBraceIndex,
 * skipping strings and comments.
 */
function findMatchingBraceIndex(src, openBraceIndex) {
  let i = openBraceIndex;
  if (src[i] !== "{") throw new Error("openBraceIndex must point to '{'");

  let depth = 0;
  let inSQuote = false;
  let inDQuote = false;
  let inTmpl = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (; i < src.length; i++) {
    const ch = src[i];
    const prev = i > 0 ? src[i - 1] : "";
    const next = i + 1 < src.length ? src[i + 1] : "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (prev === "*" && ch === "/") inBlockComment = false;
      continue;
    }

    if (inSQuote) {
      if (ch === "'" && prev !== "\\") inSQuote = false;
      continue;
    }
    if (inDQuote) {
      if (ch === `"` && prev !== "\\") inDQuote = false;
      continue;
    }
    if (inTmpl) {
      if (ch === "`" && prev !== "\\") inTmpl = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === "'") {
      inSQuote = true;
      continue;
    }
    if (ch === `"`) {
      inDQuote = true;
      continue;
    }
    if (ch === "`") {
      inTmpl = true;
      continue;
    }

    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
      continue;
    }
  }

  return -1;
}

/**
 * Locate a function declaration `function <name>(...) { ... }`
 * and return { startIndex, endIndex } for the whole declaration.
 */
function findFunctionRange(src, funcName) {
  const re = new RegExp(`\\bfunction\\s+${escapeRegExp(funcName)}\\s*\\(`, "m");
  const m = re.exec(src);
  if (!m) return null;

  const startIndex = m.index;

  const braceIndex = src.indexOf("{", m.index);
  if (braceIndex === -1) return null;

  const endBraceIndex = findMatchingBraceIndex(src, braceIndex);
  if (endBraceIndex === -1) return null;

  let endIndex = endBraceIndex + 1;
  if (src[endIndex] === "\r" && src[endIndex + 1] === "\n") endIndex += 2;
  else if (src[endIndex] === "\n") endIndex += 1;

  return { startIndex, endIndex };
}

/**
 * Replace a function by name with newSource (full `function Name_(...) { ... }` string).
 * Returns true if patched.
 */
function replaceFunctionInFile(relPath, funcName, newSource) {
  const fullPath = resolvePath(relPath);
  if (!fs.existsSync(fullPath)) {
    log.err(`File not found: ${fullPath}`);
    return false;
  }

  const src = readText(fullPath);
  const range = findFunctionRange(src, funcName);

  if (!range) {
    return false;
  }

  const before = src.slice(0, range.startIndex);
  const after = src.slice(range.endIndex);

  const normalizedNew = newSource.endsWith("\n") ? newSource : newSource + "\n";

  writeText(fullPath, before + normalizedNew + after);
  log.ok(`Patched: ${relPath} :: ${funcName}`);
  return true;
}

/**
 * Try replacing a function across multiple candidate files.
 * - Patches the first file where the function is found.
 * - If not found, prints a useful error.
 */
function replaceFunctionInFiles(candidateRelPaths, funcName, newSource) {
  const tried = [];
  for (const rel of candidateRelPaths) {
    tried.push(rel);
    const fullPath = resolvePath(rel);
    if (!fs.existsSync(fullPath)) continue;
    if (replaceFunctionInFile(rel, funcName, newSource)) return true;
  }
  log.warn(`Function not found in any candidate files: ${funcName}`);
  log.warn(`Tried: ${tried.join(", ")}`);
  return false;
}

/**
 * Append a helper block once (idempotent)
 */
function appendOnce(relPath, uniqueNeedle, blockToAppend) {
  const fullPath = resolvePath(relPath);
  if (!fs.existsSync(fullPath)) {
    log.err(`File not found: ${fullPath}`);
    return false;
  }

  const src = readText(fullPath);
  if (src.includes(uniqueNeedle)) {
    log.warn(`Already present: ${relPath} :: ${uniqueNeedle}`);
    return false;
  }

  const out = src.replace(/\s*$/, "\n") + blockToAppend.replace(/^\s*/, "\n");
  writeText(fullPath, out);
  log.ok(`Patched: ${relPath} (Appended helper)`);
  return true;
}

/** ------------------------------
 *  Replacement sources
 *  ------------------------------ */

// 1) gas/sheetsRecords.gs
const sheetsRecordsPath = "gas/sheetsRecords.gs";

const Sheets_purgeExpiredDeletedRows_New = `function Sheets_purgeExpiredDeletedRows_(sheet, retentionDays) {
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
}`;

const Sheets_getAllRecords_New = `function Sheets_getAllRecords_(sheet, temporalTypeMap, options) {
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

    // ソート（メモリ上）
    validRows.sort(function(a, b) {
      var aId = String(a[ID_INDEX] == null ? "" : a[ID_INDEX]);
      var bId = String(b[ID_INDEX] == null ? "" : b[ID_INDEX]);
      if (aId < bId) return -1;
      if (aId > bId) return 1;
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
}`;

// 2) gas/sheetsDatetime.gs (append helper once)
const sheetsDatetimePath = "gas/sheetsDatetime.gs";
const temporalFormatsMemoryAdd = `
/* ---- PATCH: temporal formats (memory) ---- */
function Sheets_applyTemporalFormatsToMemory_(columnPaths, values, dataRowCount, explicitTypeMap) {
  if (!dataRowCount) return;

  var reservedKeys = {
    "id": true, "No.": true, "createdAt": true, "modifiedAt": true,
    "deletedAt": true, "createdBy": true, "modifiedBy": true, "deletedBy": true
  };
  var hasExplicitMap = explicitTypeMap && typeof explicitTypeMap === "object";

  for (var j = 0; j < columnPaths.length; j++) {
    var colInfo = columnPaths[j];
    if (reservedKeys[colInfo.key]) continue;

    var colIndex = colInfo.index;
    var temporalType = null;

    if (hasExplicitMap && explicitTypeMap[colInfo.key]) {
      temporalType = explicitTypeMap[colInfo.key];
    } else {
      temporalType = Sheets_detectTemporalColumnType_(values, colIndex);
    }

    if (temporalType === "date" || temporalType === "time") {
      for (var i = 0; i < dataRowCount; i++) {
        var cell = values[i][colIndex];
        if (cell === null || cell === undefined || cell === "") continue;
        if (cell instanceof Date || (typeof cell === "number" && isFinite(cell))) continue;
        var parsed = Sheets_parseDateLikeToJstDate_(cell);
        if (parsed) values[i][colIndex] = parsed;
      }
    }
  }
}
/* ---- /PATCH ---- */
`;

// 3) gas/sheetsRowOps.gs
const sheetsRowOpsPath = "gas/sheetsRowOps.gs";

const Sheets_upsertRecordById_New = `function Sheets_upsertRecordById_(sheet, order, ctx, temporalTypeMap) {
  Sheets_prepareResponses_(ctx);
  Sheets_ensureHeaderMatrix_(sheet, ctx.order);
  var keyToColumn = Sheets_buildHeaderKeyMap_(sheet);

  var reservedHeaderKeys = {
    "id": true, "No.": true, "createdAt": true, "modifiedAt": true,
    "deletedAt": true, "createdBy": true, "modifiedBy": true, "deletedBy": true
  };

  var lastColumn = Math.max(sheet.getLastColumn(), 8);
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
    ctx.id = ctx.id || Sheets_generateRecordId_();

    rowData[0] = ctx.id;
    rowData[1] = maxNo + 1;
    rowData[2] = currentTs; // createdAt
    rowData[3] = currentTs; // modifiedAt
    rowData[5] = email;     // createdBy
    rowData[6] = email;     // modifiedBy
  } else {
    var existingValues = sheet.getRange(rowIndex, 1, 1, lastColumn).getValues()[0];
    for (var c = 0; c < lastColumn; c++) rowData[c] = existingValues[c] !== undefined ? existingValues[c] : "";

    for (var key in keyToColumn) {
      if (keyToColumn.hasOwnProperty(key) && !reservedHeaderKeys[key]) {
        var colIdx = keyToColumn[key] - 1;
        if (colIdx >= 0 && colIdx < lastColumn) rowData[colIdx] = "";
      }
    }
    rowData[3] = currentTs; // modifiedAt
    rowData[6] = email;     // modifiedBy
  }

  formats[2] = "0";
  formats[3] = "0";

  for (var k = 0; k < ctx.order.length; k++) {
    var kName = String(ctx.order[k] || "");
    if (!kName || reservedHeaderKeys[kName]) continue;
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
}`;

const Sheets_deleteRecordById_New = `function Sheets_deleteRecordById_(sheet, id) {
  var rowIndex = Sheets_findRowById_(sheet, id);
  if (rowIndex === -1) return { ok: false, error: "Record not found" };

  var now = Date.now();
  var email = Session.getActiveUser().getEmail() || "";

  var range = sheet.getRange(rowIndex, 2, 1, 7); // Col 2(No) to Col 8(deletedBy)
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
}`;

// 4) SyncRecords_ replacement (bulk/memory version)
const SyncRecords_New = `function SyncRecords_(ctx) {
  return ExecuteWithSheet_(ctx, function(sheet) {
    return WithScriptLock_("同期", function() {
      Sheets_purgeExpiredDeletedRows_(sheet, ResolveDeletedRecordRetentionDays_(ctx));
      var nowMs = Date.now();
      var order = ctx.order || [];
      if (ctx.raw.formSchema) {
        order = Sheets_buildOrderFromSchema_(ctx.raw.formSchema);
      }
      var temporalTypeMap = ResolveTemporalTypeMap_(ctx);
      Sheets_ensureHeaderMatrix_(sheet, order);
      var keyToColumn = Sheets_buildHeaderKeyMap_(sheet);

      var reservedHeaderKeys = {
        "id": true, "No.": true, "createdAt": true, "modifiedAt": true,
        "deletedAt": true, "createdBy": true, "modifiedBy": true, "deletedBy": true
      };

      var lastColumn = Math.max(sheet.getLastColumn(), 8);
      var lastRow = sheet.getLastRow();
      var dataStartRow = NFB_DATA_START_ROW;

      // 全データを取得
      var existingData = [];
      var existingFormats = [];
      if (lastRow >= dataStartRow) {
        var dataRange = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, lastColumn);
        existingData = dataRange.getValues();
        existingFormats = dataRange.getNumberFormats();
      }

      var existingRowMap = {};
      var maxNo = 0;
      for (var i = 0; i < existingData.length; i++) {
        var id = String(existingData[i][0] || "").trim();
        if (id) existingRowMap[id] = i;
        var noVal = Number(existingData[i][1]);
        if (isFinite(noVal) && noVal > maxNo) maxNo = noVal;
      }

      var uploadRecords = ctx.raw.uploadRecords || [];
      var modifiedCount = 0;
      var uploadedRecordIds = {};
      var currentUserEmail = Session.getActiveUser().getEmail() || "";

      for (var j = 0; j < uploadRecords.length; j++) {
        var rec = uploadRecords[j];
        var recId = rec.id || Sheets_generateRecordId_();
        var recModifiedAt = parseInt(rec.modifiedAtUnixMs, 10) || Sheets_toUnixMs_(rec.modifiedAt, true) || nowMs;

        var localIndex = existingRowMap.hasOwnProperty(recId) ? existingRowMap[recId] : -1;
        var sheetModifiedAt = 0;

        if (localIndex !== -1) {
          var modAtVal = existingData[localIndex][3];
          sheetModifiedAt = Sheets_toUnixMs_(modAtVal, true) || 0;
        }

        var shouldApplyRecord = (localIndex === -1) || (recModifiedAt > sheetModifiedAt);
        if (shouldApplyRecord) {
          var rowData;
          var rowFormats;

          if (localIndex === -1) {
            rowData = new Array(lastColumn).fill("");
            rowFormats = new Array(lastColumn).fill("General");
            rowData[0] = recId;
            maxNo++;
            rowData[1] = maxNo;
            rowData[2] = nowMs; // createdAt
            rowData[5] = rec.createdBy || currentUserEmail;

            localIndex = existingData.length;
            existingData.push(rowData);
            existingFormats.push(rowFormats);
            existingRowMap[recId] = localIndex;
          } else {
            rowData = existingData[localIndex];
            rowFormats = existingFormats[localIndex];
            for (var key in keyToColumn) {
              if (keyToColumn.hasOwnProperty(key) && !reservedHeaderKeys[key]) {
                var cIdx = keyToColumn[key] - 1;
                if (cIdx >= 0 && cIdx < lastColumn) rowData[cIdx] = "";
              }
            }
          }

          rowData[3] = recModifiedAt;
          rowData[6] = currentUserEmail;
          rowFormats[2] = "0";
          rowFormats[3] = "0";

          if (rec.deletedAt) {
            rowData[4] = Sheets_toUnixMs_(rec.deletedAt, true) || rec.deletedAt;
            rowData[7] = rec.deletedBy || currentUserEmail;
            rowFormats[4] = "0";
          } else {
            rowData[4] = "";
            rowData[7] = "";
          }

          for (var k = 0; k < order.length; k++) {
            var kName = String(order[k] || "");
            if (!kName || reservedHeaderKeys[kName]) continue;
            var colIdx = keyToColumn[kName] - 1;
            if (colIdx < 0) continue;

            var val = (rec.data && rec.data.hasOwnProperty(kName)) ? rec.data[kName] : "";
            var tType = temporalTypeMap && temporalTypeMap[kName] ? temporalTypeMap[kName] : null;
            var norm = Sheets_resolveTemporalCell_(val, tType);

            rowData[colIdx] = norm.value;
            if (norm.numberFormat) rowFormats[colIdx] = norm.numberFormat;
          }

          rec["No."] = rowData[1];
          uploadedRecordIds[String(recId)] = true;
          modifiedCount++;
        }
      }

      var forceFullSync = !!ctx.raw.forceFullSync;

      // 一括書き込み
      if (modifiedCount > 0) {
        Sheets_ensureRowCapacity_(sheet, dataStartRow + existingData.length - 1);
        if (existingData.length > 0) {
          var outRange = sheet.getRange(dataStartRow, 1, existingData.length, lastColumn);
          outRange.setValues(existingData);
          outRange.setNumberFormats(existingFormats);
        }
        SetServerModifiedAt_(nowMs);
        Sheets_touchSheetLastUpdated_(sheet, nowMs);
      } else if (forceFullSync) {
        SetServerModifiedAt_(nowMs);
        Sheets_touchSheetLastUpdated_(sheet, nowMs);
      }

      var serverModifiedAt = GetServerModifiedAt_();
      var lastServerReadAt = parseInt(ctx.raw.lastServerReadAt, 10) || 0;

      // 返却データ構築
      var returnRecords = [];
      var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);

      Sheets_applyTemporalFormatsToMemory_(columnPaths, existingData, existingData.length, temporalTypeMap);

      for (var r = 0; r < existingData.length; r++) {
        var aRec = Sheets_buildRecordFromRow_(existingData[r], columnPaths);
        if (!aRec) continue;

        if (forceFullSync) {
          returnRecords.push(aRec);
        } else {
          var aModAt = parseInt(aRec.modifiedAtUnixMs, 10) || 0;
          if (aModAt > lastServerReadAt || uploadedRecordIds[String(aRec.id)]) {
            returnRecords.push(aRec);
          }
        }
      }

      var headerMatrix = Sheets_readHeaderMatrix_(sheet);

      return {
        ok: true,
        serverModifiedAt: serverModifiedAt,
        serverCommitToken: serverModifiedAt,
        records: returnRecords.map(SerializeRecord_),
        headerMatrix: headerMatrix
      };
    });
  });
}`;

/** ------------------------------
 *  Execute patches
 *  ------------------------------ */

console.log("Applying patches (function-safe) ...");

// sheetsRecords
if (
  !replaceFunctionInFile(
    sheetsRecordsPath,
    "Sheets_purgeExpiredDeletedRows_",
    Sheets_purgeExpiredDeletedRows_New,
  )
) {
  log.warn(
    `Function not found: ${sheetsRecordsPath} :: Sheets_purgeExpiredDeletedRows_`,
  );
}
if (
  !replaceFunctionInFile(
    sheetsRecordsPath,
    "Sheets_getAllRecords_",
    Sheets_getAllRecords_New,
  )
) {
  log.warn(`Function not found: ${sheetsRecordsPath} :: Sheets_getAllRecords_`);
}

// sheetsDatetime (append once)
appendOnce(
  sheetsDatetimePath,
  "Sheets_applyTemporalFormatsToMemory_",
  temporalFormatsMemoryAdd,
);

// sheetsRowOps
if (
  !replaceFunctionInFile(
    sheetsRowOpsPath,
    "Sheets_upsertRecordById_",
    Sheets_upsertRecordById_New,
  )
) {
  log.warn(
    `Function not found: ${sheetsRowOpsPath} :: Sheets_upsertRecordById_`,
  );
}
if (
  !replaceFunctionInFile(
    sheetsRowOpsPath,
    "Sheets_deleteRecordById_",
    Sheets_deleteRecordById_New,
  )
) {
  log.warn(
    `Function not found: ${sheetsRowOpsPath} :: Sheets_deleteRecordById_`,
  );
}

// SyncRecords_ : file location can vary (Code.gs / formsCrud.gs etc.)
replaceFunctionInFiles(
  [
    "gas/Code.gs",
    "gas/formsCrud.gs",
    "gas/formsPublicApi.gs",
    "gas/model.gs",
    "gas/formsStorage.gs",
    "gas/formsParsing.gs",
  ],
  "SyncRecords_",
  SyncRecords_New,
);

console.log("Done.");

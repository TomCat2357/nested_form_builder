// Split from sheets.gs



function Sheets_exportResultMatrixToNewSpreadsheet_(spreadsheetTitle, headerRows, rows, themeColors) {
  if (!headerRows || !headerRows.length) throw new Error("headerRows is required");
  if (!Array.isArray(rows)) throw new Error("rows must be an array");

  var normalizedHeaderRows = Array.isArray(headerRows) ? headerRows : [];
  var normalizedRows = Array.isArray(rows) ? rows : [];

  var maxColumns = 0;
  for (var i = 0; i < normalizedHeaderRows.length; i++) {
    var headerLength = Array.isArray(normalizedHeaderRows[i]) ? normalizedHeaderRows[i].length : 0;
    if (headerLength > maxColumns) maxColumns = headerLength;
  }
  for (var j = 0; j < normalizedRows.length; j++) {
    var rowLength = Array.isArray(normalizedRows[j]) ? normalizedRows[j].length : 0;
    if (rowLength > maxColumns) maxColumns = rowLength;
  }
  if (maxColumns <= 0) throw new Error("No columns to export");

  var normalizeRow = function(row) {
    var source = Array.isArray(row) ? row : [];
    var next = [];
    for (var idx = 0; idx < maxColumns; idx++) {
      var value = source[idx];
      if (value === null || value === undefined) {
        next.push("");
      } else {
        next.push(String(value));
      }
    }
    return next;
  };

  var exportRows = [];
  for (var h = 0; h < normalizedHeaderRows.length; h++) {
    exportRows.push(normalizeRow(normalizedHeaderRows[h]));
  }
  for (var r = 0; r < normalizedRows.length; r++) {
    exportRows.push(normalizeRow(normalizedRows[r]));
  }

  var now = new Date();
  var pad = function(n) { return n < 10 ? "0" + n : String(n); };
  var defaultTitle = "検索結果_" +
    now.getFullYear() + "-" +
    pad(now.getMonth() + 1) + "-" +
    pad(now.getDate()) + "_" +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());
  var title = String(spreadsheetTitle || "").trim() || defaultTitle;

  var ss = SpreadsheetApp.create(title);
  var sheet = ss.getSheets()[0];
  Sheets_ensureColumnExists_(sheet, maxColumns);
  Sheets_ensureRowCapacity_(sheet, exportRows.length);

  if (exportRows.length > 0) {
    sheet.getRange(1, 1, exportRows.length, maxColumns).setValues(exportRows);
  }
  sheet.setFrozenRows(normalizedHeaderRows.length);

  var headerCount = normalizedHeaderRows.length;
  var dataRowCount = normalizedRows.length;
  var primary = (themeColors && themeColors.primary) || "#2f6fed";
  var primarySoft = (themeColors && themeColors.primarySoft) || "#dbeafe";
  var textColor = "#1a1a2e";
  var borderColor = (themeColors && themeColors.border) || "#e6e8f0";
  var surface = (themeColors && themeColors.surface) || "#ffffff";

  if (headerCount > 0 && maxColumns > 0) {
    var headerRange = sheet.getRange(1, 1, headerCount, maxColumns);
    headerRange.setBackground(primary)
               .setFontColor("#ffffff")
               .setFontWeight("bold");
    headerRange.setBorder(true, true, true, true, true, true,
      primary, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }

  if (dataRowCount > 0 && maxColumns > 0) {
    var bgColors = [];
    var fontColors = [];
    for (var s = 0; s < dataRowCount; s++) {
      var bg = (s % 2 === 0) ? surface : primarySoft;
      bgColors.push(new Array(maxColumns).fill(bg));
      fontColors.push(new Array(maxColumns).fill(textColor));
    }
    var dataRange = sheet.getRange(headerCount + 1, 1, dataRowCount, maxColumns);
    dataRange.setBackgrounds(bgColors).setFontColors(fontColors);
    dataRange.setBorder(true, true, true, true, true, true,
      borderColor, SpreadsheetApp.BorderStyle.SOLID);
  }

  return {
    ok: true,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
    exportedCount: normalizedRows.length,
    headerCount: normalizedHeaderRows.length
  };
}

function Sheets_appendRowsToSpreadsheet_(spreadsheetId, rows, themeColors, headerCount, rowOffset) {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: true, appendedCount: 0 };
  }

  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheets()[0];
  var lastRow = sheet.getLastRow();
  var maxColumns = 0;
  for (var i = 0; i < rows.length; i++) {
    var rowLen = Array.isArray(rows[i]) ? rows[i].length : 0;
    if (rowLen > maxColumns) maxColumns = rowLen;
  }
  if (maxColumns <= 0) return { ok: true, appendedCount: 0 };

  Sheets_ensureColumnExists_(sheet, maxColumns);
  Sheets_ensureRowCapacity_(sheet, lastRow + rows.length);

  var normalizedRows = [];
  for (var j = 0; j < rows.length; j++) {
    var source = Array.isArray(rows[j]) ? rows[j] : [];
    var normalized = [];
    for (var k = 0; k < maxColumns; k++) {
      var value = source[k];
      if (value === null || value === undefined) {
        normalized.push("");
      } else {
        normalized.push(String(value));
      }
    }
    normalizedRows.push(normalized);
  }

  sheet.getRange(lastRow + 1, 1, normalizedRows.length, maxColumns).setValues(normalizedRows);

  var offset = typeof rowOffset === "number" ? rowOffset : 0;
  var primarySoft = (themeColors && themeColors.primarySoft) || "#dbeafe";
  var textColor = "#1a1a2e";
  var borderColor = (themeColors && themeColors.border) || "#e6e8f0";
  var surface = (themeColors && themeColors.surface) || "#ffffff";

  var bgColors = [];
  var fontColors = [];
  for (var m = 0; m < normalizedRows.length; m++) {
    var bg = ((offset + m) % 2 === 0) ? surface : primarySoft;
    bgColors.push(new Array(maxColumns).fill(bg));
    fontColors.push(new Array(maxColumns).fill(textColor));
  }
  var appendedRange = sheet.getRange(lastRow + 1, 1, normalizedRows.length, maxColumns);
  appendedRange.setBackgrounds(bgColors).setFontColors(fontColors);
  appendedRange.setBorder(true, true, true, true, true, true,
    borderColor, SpreadsheetApp.BorderStyle.SOLID);

  return { ok: true, appendedCount: normalizedRows.length };
}


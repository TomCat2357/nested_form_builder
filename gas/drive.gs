/**
 * drive.gs
 * Google Drive連携機能
 */

/**
 * Google DriveのURLからテーマCSSを取得
 * @param {string} url - Google DriveのファイルURL
 * @return {Object} { ok: true, css: string, fileName: string, fileUrl: string }
 */
function nfbImportThemeFromDrive(url) {
  return nfbSafeCall_(function() {
    if (!url || typeof url !== "string") {
      throw new Error("Google Drive URLが指定されていません");
    }

    var fileId = ExtractFileIdFromUrl_(url);
    if (!fileId) {
      throw new Error("無効なGoogle DriveファイルURLです");
    }

    var file;
    try {
      file = DriveApp.getFileById(fileId);
    } catch (accessError) {
      throw new Error("ファイルへのアクセスに失敗しました: " + nfbErrorToString_(accessError));
    }

    var css = file.getBlob().getDataAsString();
    if (!css) {
      throw new Error("テーマファイルが空です");
    }

    return {
      ok: true,
      css: css,
      fileName: file.getName(),
      fileUrl: file.getUrl(),
    };
  });
}


/**
 * フロントエンドで生成したExcelファイルをGoogle Driveに保存する
 * @param {Object} payload - { filename: string, base64: string }
 * @return {Object} { ok: true, fileUrl: string, fileName: string }
 */
function nfbSaveExcelToDrive(payload) {
  return nfbSafeCall_(function() {
    if (!payload || !payload.base64 || !payload.filename) {
      throw new Error("ファイルデータが不足しています");
    }

    var bytes = Utilities.base64Decode(payload.base64);
    var mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    var blob = Utilities.newBlob(bytes, mimeType, payload.filename);

    var file = DriveApp.createFile(blob);

    return {
      ok: true,
      fileUrl: file.getUrl(),
      fileName: file.getName()
    };
  });
}

/**
 * 個別レコードの印刷様式を Google ドキュメントとしてマイドライブ直下に保存する
 * @param {Object} payload - { fileName, formTitle, recordId, recordNo, modifiedAt, showHeader, exportedAtIso, items }
 * @return {Object} { ok: true, fileUrl: string, fileName: string, fileId: string }
 */
function nfbCreateRecordPrintDocument(payload) {
  return nfbSafeCall_(function() {
    var normalizedPayload = nfbNormalizePrintDocumentPayload_(payload);

    var doc = DocumentApp.create(normalizedPayload.fileName);
    var body = doc.getBody();
    if (body && typeof body.clear === "function") {
      body.clear();
    }

    for (var i = 0; i < normalizedPayload.records.length; i++) {
      nfbWritePrintDocument_(body, normalizedPayload.records[i]);
      if (i < normalizedPayload.records.length - 1 && body && typeof body.appendPageBreak === "function") {
        body.appendPageBreak();
      }
    }

    doc.saveAndClose();

    var file = DriveApp.getFileById(doc.getId());
    return {
      ok: true,
      fileUrl: file.getUrl(),
      fileName: file.getName(),
      fileId: file.getId()
    };
  });
}

function nfbNormalizePrintDocumentPayload_(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("印刷様式のデータが不足しています");
  }

  var fileName = String(payload.fileName || "").trim();
  if (!fileName) {
    throw new Error("fileName is required");
  }

  var rawRecords = Array.isArray(payload.records) ? payload.records : [payload];
  var records = [];
  for (var i = 0; i < rawRecords.length; i++) {
    records.push(nfbNormalizePrintDocumentRecord_(rawRecords[i], i));
  }

  if (!records.length) {
    throw new Error("印刷様式の出力対象がありません");
  }

  return {
    fileName: fileName,
    records: records
  };
}

function nfbNormalizePrintDocumentRecord_(payload, index) {
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error("印刷様式のデータが不足しています");
  }

  return {
    formTitle: String(payload.formTitle || "").trim() || "受付フォーム",
    recordId: String(payload.recordId || "").trim() || ("record-" + (index + 1)),
    recordNo: payload.recordNo === undefined || payload.recordNo === null ? "" : String(payload.recordNo).trim(),
    modifiedAt: payload.modifiedAt === undefined || payload.modifiedAt === null ? "" : String(payload.modifiedAt).trim(),
    showHeader: payload.showHeader !== false,
    exportedAtIso: payload.exportedAtIso,
    parentRecordId: payload.parentRecordId || "",
    parentRepresentativeValue: payload.parentRepresentativeValue || "",
    items: payload.items
  };
}

function nfbWritePrintDocument_(body, payload) {
  if (payload.showHeader !== false) {
    var title = body.appendParagraph(payload.formTitle || "受付フォーム");
    title.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    nfbStylePrintDocumentParagraph_(title, {
      fontFamily: "Arial",
      fontSize: 16,
      bold: true,
      color: "#202124",
      spacingAfter: 6
    });

    nfbAppendPrintDocumentMetaTable_(body, {
      exportedAtIso: payload.exportedAtIso,
      modifiedAt: payload.modifiedAt,
      recordNo: payload.recordNo,
      recordId: payload.recordId,
      parentRecordId: payload.parentRecordId,
      parentRepresentativeValue: payload.parentRepresentativeValue
    });
  }

  var items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    var emptyParagraph = body.appendParagraph("出力できる項目がありません。");
    nfbStylePrintDocumentParagraph_(emptyParagraph, {
      fontFamily: "Arial",
      fontSize: 11,
      color: "#5f6368",
      spacingBefore: 10
    });
    return;
  }

  nfbAppendPrintDocumentItemsTable_(body, items);
}

function nfbAppendPrintDocumentMetaTable_(body, payload) {
  var rows = [
    ["出力日時", nfbFormatPrintDocumentExportedAt_(payload.exportedAtIso)],
    ["最終更新日時", payload.modifiedAt ? payload.modifiedAt : "-"],
    ["レコードNo", payload.recordNo ? payload.recordNo : "-"],
    ["回答ID", payload.recordId ? payload.recordId : "-"]
  ];

  if (payload.parentRecordId) {
    rows.push(["親レコードID", payload.parentRecordId]);
    if (payload.parentRepresentativeValue && payload.parentRepresentativeValue !== payload.parentRecordId) {
      rows.push(["親レコード代表値", payload.parentRepresentativeValue]);
    }
  }

  var table = body.appendTable();
  for (var i = 0; i < rows.length; i++) {
    var row = table.appendTableRow();
    var labelCell = row.appendTableCell("");
    var valueCell = row.appendTableCell("");

    nfbStylePrintDocumentCell_(labelCell, { backgroundColor: "#f1f3f4" });
    nfbSetPrintDocumentCellText_(labelCell, rows[i][0], {
      fontFamily: "Arial",
      fontSize: 9,
      bold: true,
      color: "#5f6368"
    });
    nfbSetPrintDocumentCellText_(valueCell, rows[i][1], {
      fontFamily: "Arial",
      fontSize: 10,
      color: "#202124"
    });
  }
  table.setColumnWidth(0, 120);
  table.setColumnWidth(1, 348);
}

function nfbAppendPrintDocumentItemsTable_(body, items) {
  var table = body.appendTable();
  var headerRow = table.appendTableRow();
  var labelHeaderCell = headerRow.appendTableCell("");
  var valueHeaderCell = headerRow.appendTableCell("");
  table.setColumnWidth(0, 120);
  table.setColumnWidth(1, 348);

  nfbStylePrintDocumentCell_(labelHeaderCell, { backgroundColor: "#1a73e8" });
  nfbStylePrintDocumentCell_(valueHeaderCell, { backgroundColor: "#1a73e8" });
  nfbSetPrintDocumentCellText_(labelHeaderCell, "項目", {
    fontFamily: "Arial",
    fontSize: 10,
    bold: true,
    color: "#ffffff"
  });
  nfbSetPrintDocumentCellText_(valueHeaderCell, "回答", {
    fontFamily: "Arial",
    fontSize: 10,
    bold: true,
    color: "#ffffff"
  });

  for (var i = 0; i < items.length; i++) {
    nfbAppendPrintDocumentTableRow_(table, items[i]);
  }
}

function nfbAppendPrintDocumentTableRow_(table, item) {
  var type = item && item.type ? String(item.type) : "text";
  var label = item && item.label ? String(item.label) : (type === "message" ? "メッセージ" : "項目");
  var value = item && item.value !== undefined && item.value !== null ? String(item.value) : "";
  var depth = item && item.depth !== undefined && item.depth !== null ? Number(item.depth) : 0;
  if (!isFinite(depth) || depth < 0) depth = 0;

  var row = table.appendTableRow();
  var labelCell = row.appendTableCell("");
  var valueCell = row.appendTableCell("");
  var baseIndent = depth * 14;

  if (type === "message") {
    nfbStylePrintDocumentCell_(labelCell, { backgroundColor: "#e8f0fe" });
    nfbStylePrintDocumentCell_(valueCell, { backgroundColor: "#e8f0fe" });
    nfbSetPrintDocumentCellText_(labelCell, label, {
      fontFamily: "Arial",
      fontSize: 10,
      bold: true,
      color: "#1a73e8",
      indentStart: baseIndent,
      spacingAfter: 0
    });
    nfbSetPrintDocumentCellText_(valueCell, "", {
      fontFamily: "Arial",
      fontSize: 10,
      color: "#1a73e8",
      spacingAfter: 0
    });
    return;
  }

  nfbSetPrintDocumentCellText_(labelCell, label, {
    fontFamily: "Arial",
    fontSize: 9,
    bold: true,
    color: "#5f6368",
    indentStart: baseIndent,
    spacingAfter: 0
  });

  nfbSetPrintDocumentCellText_(valueCell, value, {
    fontFamily: "Arial",
    fontSize: 10,
    color: "#202124",
    spacingAfter: 0
  });
}

function nfbSetPrintDocumentCellText_(cell, value, options) {
  if (!cell) return;

  var normalizedValue = value === undefined || value === null ? "" : String(value);
  var lines = normalizedValue ? normalizedValue.split(/\r?\n/) : [""];
  var firstParagraph = cell.getChild(0).asParagraph();
  firstParagraph.editAsText().setText(lines[0] || " ");
  nfbStylePrintDocumentParagraph_(firstParagraph, options || {});

  for (var i = 1; i < lines.length; i++) {
    var paragraph = cell.appendParagraph(lines[i] || " ");
    nfbStylePrintDocumentParagraph_(paragraph, {
      fontFamily: options && options.fontFamily,
      fontSize: options && options.fontSize,
      bold: options && options.bold,
      color: options && options.color,
      indentStart: options && options.indentStart,
      spacingBefore: 2,
      spacingAfter: 0
    });
  }
}

function nfbStylePrintDocumentCell_(cell, options) {
  if (!cell) return cell;
  if (options.backgroundColor && typeof cell.setBackgroundColor === "function") {
    cell.setBackgroundColor(options.backgroundColor);
  }
  return cell;
}

function nfbStylePrintDocumentParagraph_(paragraph, options) {
  if (!paragraph) return paragraph;

  var text = paragraph.editAsText();
  if (options.fontFamily) text.setFontFamily(options.fontFamily);
  if (typeof options.fontSize === "number") text.setFontSize(options.fontSize);
  if (typeof options.bold === "boolean") text.setBold(options.bold);
  if (options.color) text.setForegroundColor(options.color);
  if (typeof options.indentStart === "number" && typeof paragraph.setIndentStart === "function") {
    paragraph.setIndentStart(options.indentStart);
  }
  if (typeof options.spacingBefore === "number" && typeof paragraph.setSpacingBefore === "function") {
    paragraph.setSpacingBefore(options.spacingBefore);
  }
  if (typeof options.spacingAfter === "number" && typeof paragraph.setSpacingAfter === "function") {
    paragraph.setSpacingAfter(options.spacingAfter);
  }
  return paragraph;
}

function nfbFormatPrintDocumentExportedAt_(value) {
  var date = value ? new Date(value) : new Date();
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    date = new Date();
  }
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss");
}

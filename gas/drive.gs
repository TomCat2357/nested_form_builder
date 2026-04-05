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
    var outputFolderUrl = "";
    var outputAutoCreated = false;
    if (payload && payload.templateSourceUrl && normalizedPayload.records.length === 1) {
      var templateDriveSettings = payload.driveSettings || {};
      var templateFolderResult = templateDriveSettings.useTemporaryFolder
        ? nfbResolveUploadFolder_(templateDriveSettings)
        : { folder: nfbResolveOrCreateFolder_(templateDriveSettings, nfbBuildDriveTemplateContext_(templateDriveSettings)), autoCreated: false };
      var templateFolder = templateFolderResult.folder;
      var templateContext = nfbBuildRecordOutputContext_({
        driveSettings: templateDriveSettings,
        recordContext: {
          formId: payload.formId || "",
          formTitle: payload.formTitle || "",
          recordId: payload.recordId || "",
          recordNo: payload.recordNo || "",
          modifiedAt: payload.modifiedAt || ""
        }
      }, templateFolder.getUrl());
      var templatedFile = nfbCreateGoogleDocumentFileFromTemplate_(
        String(payload.templateSourceUrl),
        templateFolder,
        normalizedPayload.fileName,
        templateContext
      );
      return {
        ok: true,
        fileUrl: templatedFile.getUrl(),
        fileName: templatedFile.getName(),
        fileId: templatedFile.getId(),
        folderUrl: templateFolder.getUrl(),
        autoCreated: templateFolderResult.autoCreated === true
      };
    }

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

    // driveSettings がある場合はフォルダに移動・ファイル名テンプレート適用
    if (payload && payload.driveSettings) {
      var ds = payload.driveSettings;
      var ctx = {
        responses: ds.responses || {},
        fieldLabels: ds.fieldLabels || {},
        fieldValues: ds.fieldValues || {},
        recordId: ds.recordId || normalizedPayload.records[0].recordId || "",
        now: new Date()
      };

      // ファイル名テンプレートの解決
      var fileNameTemplate = ds.fileNameTemplate ? String(ds.fileNameTemplate).trim() : "";
      if (fileNameTemplate) {
        var resolvedFileName = nfbResolveTemplate_(fileNameTemplate, ctx);
        if (resolvedFileName) {
          file.setName(resolvedFileName);
        }
      }

      var folderResult = ds.useTemporaryFolder
        ? nfbResolveUploadFolder_(ds)
        : { folder: nfbResolveOrCreateFolder_(ds, ctx), autoCreated: false };
      var folder = folderResult.folder;
      var finalFileName = file.getName();
      nfbTrashExistingFile_(folder, finalFileName);
      file.moveTo(folder);
      outputFolderUrl = folder.getUrl();
      outputAutoCreated = folderResult.autoCreated === true;
    }

    return {
      ok: true,
      fileUrl: file.getUrl(),
      fileName: file.getName(),
      fileId: file.getId(),
      folderUrl: outputFolderUrl,
      autoCreated: outputAutoCreated
    };
  });
}

function nfbExecuteRecordOutputAction(payload) {
  return nfbSafeCall_(function() {
    var action = payload && payload.action ? payload.action : {};
    var outputType = action.outputType === "pdf" ? "pdf" : (action.outputType === "gmail" ? "gmail" : "googleDoc");
    var driveSettings = payload && payload.driveSettings ? payload.driveSettings : {};
    var fileNameTemplate = nfbResolveRecordOutputFileNameTemplate_(payload, action, outputType);
    if (nfbRequiresRecordOutputFileNameTemplate_(action, outputType) && !fileNameTemplate) {
      throw new Error("出力ファイル名が指定されていません");
    }

    var folderResult = nfbResolveUploadFolder_(driveSettings);
    var folder = folderResult.folder;
    var outputContext = nfbBuildRecordOutputContext_(payload, folder.getUrl());
    var finalBaseName = fileNameTemplate
      ? (nfbResolveTemplate_(fileNameTemplate, outputContext) || ("record_" + outputContext.recordId))
      : "";

    if (outputType === "gmail") {
      return nfbCreateGmailDraftOutput_(payload, action, folder, folderResult, outputContext, finalBaseName);
    }

    if (outputType === "pdf") {
      return nfbCreatePdfOutput_(payload, action, folder, folderResult, outputContext, finalBaseName);
    }

    return nfbCreateGoogleDocumentOutput_(payload, action, folder, folderResult, outputContext, finalBaseName);
  });
}

function nfbBuildRecordOutputContext_(payload, folderUrl) {
  var driveSettings = payload && payload.driveSettings ? payload.driveSettings : {};
  var recordContext = payload && payload.recordContext ? payload.recordContext : {};
  var now = new Date();
  var formId = recordContext.formId || driveSettings.formId || "";
  var recordId = recordContext.recordId || driveSettings.recordId || "";
  var webAppUrl = ScriptApp.getService().getUrl() || "";
  var recordUrl = webAppUrl && formId && recordId
    ? webAppUrl + "?form=" + encodeURIComponent(formId) + "&record=" + encodeURIComponent(recordId)
    : "";

  return {
    responses: driveSettings.responses || {},
    fieldLabels: driveSettings.fieldLabels || {},
    fieldValues: driveSettings.fieldValues || {},
    formId: formId,
    recordId: recordId,
    recordNo: recordContext.recordNo || "",
    formTitle: recordContext.formTitle || "",
    folderUrl: folderUrl || "",
    recordUrl: recordUrl,
    now: now
  };
}

function nfbResolveRecordOutputFileNameTemplate_(payload, action, outputType) {
  var settings = payload && payload.settings ? payload.settings : {};
  var actionTemplate = action && action.fileNameTemplate ? String(action.fileNameTemplate).trim() : "";
  var sharedTemplate = settings && settings.standardPrintFileNameTemplate
    ? String(settings.standardPrintFileNameTemplate).trim()
    : "";

  if (outputType === "gmail") {
    return nfbBodyTemplateUsesPdf_(action) ? (sharedTemplate || actionTemplate) : "";
  }

  return actionTemplate || sharedTemplate;
}

function nfbRequiresRecordOutputFileNameTemplate_(action, outputType) {
  return outputType !== "gmail" || nfbBodyTemplateUsesPdf_(action);
}

function nfbBodyTemplateUsesPdf_(action) {
  return String(action && action.gmailTemplateBody || "").indexOf("{_PDF}") !== -1;
}

function nfbResolveRecordOutputTemplateSourceUrl_(payload, action) {
  if (action && action.useCustomTemplate) {
    return action.templateUrl ? String(action.templateUrl).trim() : "";
  }
  return payload && payload.settings && payload.settings.standardPrintTemplateUrl
    ? String(payload.settings.standardPrintTemplateUrl).trim()
    : "";
}

function nfbCreateGoogleDocumentOutput_(payload, action, folder, folderResult, outputContext, finalBaseName) {
  var docFile = nfbCreateRecordOutputGoogleDocument_(payload, action, folder, outputContext, finalBaseName);
  return {
    ok: true,
    outputType: "googleDoc",
    fileUrl: docFile.getUrl(),
    fileName: docFile.getName(),
    fileId: docFile.getId(),
    folderUrl: folder.getUrl(),
    autoCreated: folderResult.autoCreated === true,
    openUrl: docFile.getUrl()
  };
}

function nfbCreatePdfOutput_(payload, action, folder, folderResult, outputContext, finalBaseName) {
  var docFile = nfbCreateRecordOutputGoogleDocument_(payload, action, folder, outputContext, finalBaseName + "__tmp");
  var pdfName = /\.pdf$/i.test(finalBaseName) ? finalBaseName : finalBaseName + ".pdf";
  nfbTrashExistingFile_(folder, pdfName);
  var pdfFile = folder.createFile(docFile.getBlob().getAs(MimeType.PDF).setName(pdfName));
  docFile.setTrashed(true);
  return {
    ok: true,
    outputType: "pdf",
    fileUrl: pdfFile.getUrl(),
    fileName: pdfFile.getName(),
    fileId: pdfFile.getId(),
    folderUrl: folder.getUrl(),
    autoCreated: folderResult.autoCreated === true,
    openUrl: pdfFile.getUrl()
  };
}

function nfbCreateGmailDraftOutput_(payload, action, folder, folderResult, outputContext, finalBaseName) {
  action = action || {};
  var to = nfbResolveTemplate_(String(action && action.gmailTemplateTo || ""), outputContext);
  var cc = nfbResolveTemplate_(String(action && action.gmailTemplateCc || ""), outputContext);
  var bcc = nfbResolveTemplate_(String(action && action.gmailTemplateBcc || ""), outputContext);
  var subject = nfbResolveTemplate_(String(action && action.gmailTemplateSubject || ""), outputContext);
  var bodyTemplate = String(action && action.gmailTemplateBody || "");
  var shouldInsertPdfUrl = bodyTemplate.indexOf("{_PDF}") !== -1;
  var pdfResult = null;
  if (shouldInsertPdfUrl) {
    var pdfAction = {};
    for (var actionKey in action) {
      if (Object.prototype.hasOwnProperty.call(action, actionKey)) {
        pdfAction[actionKey] = action[actionKey];
      }
    }
    pdfAction.useCustomTemplate = false;
    pdfAction.templateUrl = "";
    pdfResult = nfbCreatePdfOutput_(payload, pdfAction, folder, folderResult, outputContext, finalBaseName);
  }
  var replacements = nfbBuildTemplateReplacementMap_(outputContext);
  replacements["{_PDF}"] = pdfResult ? pdfResult.fileUrl : "";
  var body = nfbResolveTemplateTokens_(bodyTemplate, replacements, true);
  var openUrl = nfbBuildGmailComposeUrl_({
    to: to,
    cc: cc,
    bcc: bcc,
    subject: subject,
    body: body
  });

  return {
    ok: true,
    outputType: "gmail",
    draftId: "",
    folderUrl: folder.getUrl(),
    autoCreated: folderResult.autoCreated === true,
    fileId: pdfResult ? pdfResult.fileId : "",
    fileUrl: pdfResult ? pdfResult.fileUrl : "",
    openUrl: openUrl
  };
}

function nfbBuildGmailComposeUrl_(params) {
  var query = ["view=cm", "fs=1"];
  var mappings = [
    ["to", params && params.to],
    ["cc", params && params.cc],
    ["bcc", params && params.bcc],
    ["su", params && params.subject],
    ["body", params && params.body]
  ];

  for (var i = 0; i < mappings.length; i++) {
    var value = mappings[i][1] === undefined || mappings[i][1] === null ? "" : String(mappings[i][1]);
    if (!value) continue;
    query.push(mappings[i][0] + "=" + encodeURIComponent(value));
  }

  return "https://mail.google.com/mail/?" + query.join("&");
}

function nfbCreateRecordOutputGoogleDocument_(payload, action, folder, outputContext, finalBaseName) {
  var sourceUrl = nfbResolveRecordOutputTemplateSourceUrl_(payload, action);
  if (sourceUrl) {
    return nfbCreateGoogleDocumentFileFromTemplate_(sourceUrl, folder, finalBaseName, outputContext);
  }
  return nfbCreateGoogleDocumentFileFromPrintPayload_(payload && payload.recordContext ? payload.recordContext.printPayload : null, folder, finalBaseName);
}

function nfbCreateGoogleDocumentFileFromTemplate_(sourceUrl, folder, finalBaseName, outputContext) {
  var parsed = Forms_parseGoogleDriveUrl_(sourceUrl);
  if (!parsed.id || parsed.type !== "file") {
    throw new Error("無効なGoogle DriveファイルURLです");
  }

  var sourceFile;
  try {
    sourceFile = DriveApp.getFileById(parsed.id);
  } catch (accessError) {
    throw new Error("ソースファイルへのアクセスに失敗しました: " + nfbErrorToString_(accessError));
  }

  nfbTrashExistingFile_(folder, finalBaseName);
  var copiedFile = sourceFile.makeCopy(finalBaseName, folder);
  try {
    var doc = DocumentApp.openById(copiedFile.getId());
    nfbApplyTemplateReplacementsToGoogleDocument_(doc, nfbBuildTemplateReplacementMap_(outputContext));
    doc.saveAndClose();
  } catch (error) {
    copiedFile.setTrashed(true);
    throw new Error("Google ドキュメントテンプレートの差し込みに失敗しました: " + nfbErrorToString_(error));
  }
  return copiedFile;
}

function nfbCreateGoogleDocumentFileFromPrintPayload_(printPayload, folder, finalBaseName) {
  var normalizedPayload = nfbNormalizePrintDocumentPayload_({
    fileName: finalBaseName,
    records: printPayload && Array.isArray(printPayload.records) ? printPayload.records : null,
    formTitle: printPayload && printPayload.formTitle,
    formId: printPayload && printPayload.formId,
    recordId: printPayload && printPayload.recordId,
    recordNo: printPayload && printPayload.recordNo,
    modifiedAt: printPayload && printPayload.modifiedAt,
    showHeader: printPayload && printPayload.showHeader,
    exportedAtIso: printPayload && printPayload.exportedAtIso,
    items: printPayload && printPayload.items
  });
  var doc = DocumentApp.create(finalBaseName);
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
  nfbTrashExistingFile_(folder, finalBaseName);
  file.moveTo(folder);
  file.setName(finalBaseName);
  return file;
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
      recordId: payload.recordId
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
    ["ID", payload.recordId ? payload.recordId : "-"]
  ];

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

// =========================================================================
// テンプレート解決・フォルダ操作・ファイルアップロード
// =========================================================================

/**
 * テンプレート文字列のプレースホルダーを解決する
 * @param {string} template - テンプレート文字列
 * @param {Object} context - { responses, fieldLabels, fieldValues, now }
 * @return {string}
 */
function nfbTemplateValueToString_(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    var parts = [];
    for (var i = 0; i < value.length; i++) {
      if (value[i] === undefined || value[i] === null) continue;
      parts.push(String(value[i]));
    }
    return parts.join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function nfbBuildTemplateReplacementMap_(context) {
  var now = context && context.now ? context.now : new Date();
  var tz = Session.getScriptTimeZone();
  var responses = (context && context.responses) || {};
  var fieldLabels = (context && context.fieldLabels) || {};
  var fieldValues = (context && context.fieldValues) || {};
  var recordId = context && context.recordId ? String(context.recordId).trim() : "";
  var recordUrl = context && context.recordUrl ? String(context.recordUrl).trim() : "";
  var folderUrl = context && context.folderUrl ? String(context.folderUrl).trim() : "";
  var dateFormats = {
    "YYYY-MM-DD": "yyyy-MM-dd",
    "HH:mm:ss": "HH:mm:ss",
    "YYYY": "yyyy",
    "MM": "MM",
    "DD": "dd",
    "HH": "HH",
    "mm": "mm",
    "ss": "ss"
  };
  var replacements = {};
  var dateKeys = Object.keys(dateFormats).sort(function(a, b) { return b.length - a.length; });
  for (var i = 0; i < dateKeys.length; i++) {
    replacements["{" + dateKeys[i] + "}"] = Utilities.formatDate(now, tz, dateFormats[dateKeys[i]]);
  }
  replacements["{ID}"] = recordId;
  replacements["{_record_url}"] = recordUrl;
  replacements["{_folder_url}"] = folderUrl;

  for (var fid in fieldLabels) {
    if (!fieldLabels.hasOwnProperty(fid)) continue;
    var label = fieldLabels[fid];
    if (!label) continue;
    var token = "{" + label + "}";
    if (replacements.hasOwnProperty(token)) continue;
    var value = Object.prototype.hasOwnProperty.call(fieldValues, fid) ? fieldValues[fid] : responses[fid];
    replacements[token] = nfbTemplateValueToString_(value);
  }

  return replacements;
}

function nfbResolveTemplateTokens_(template, replacements, removeUnknownPlaceholders) {
  if (!template || typeof template !== "string") return "";

  var escapedOpenBraceToken = "__NFB_ESCAPED_OPEN_BRACE__";
  var escapedCloseBraceToken = "__NFB_ESCAPED_CLOSE_BRACE__";
  var result = String(template)
    .replace(/\\\{/g, escapedOpenBraceToken)
    .replace(/\\\}/g, escapedCloseBraceToken);
  var tokens = Object.keys(replacements).sort(function(a, b) { return b.length - a.length; });
  var markerPrefix = "__NFB_TEMPLATE_MARKER__";
  var markerPairs = [];
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    if (result.indexOf(token) === -1) continue;
    var marker = markerPrefix + i + "__";
    result = result.split(token).join(marker);
    markerPairs.push({ marker: marker, value: replacements[token] });
  }
  for (var j = 0; j < markerPairs.length; j++) {
    result = result.split(markerPairs[j].marker).join(markerPairs[j].value);
  }
  if (removeUnknownPlaceholders !== false) {
    result = result.replace(/\{([^{}]+)\}/g, "");
  }

  return result
    .split(escapedOpenBraceToken).join("{")
    .split(escapedCloseBraceToken).join("}");
}

function nfbResolveTemplate_(template, context) {
  return nfbResolveTemplateTokens_(template, nfbBuildTemplateReplacementMap_(context), true);
}

/**
 * driveSettings からフォルダを解決または作成する
 * @param {Object} driveSettings - { rootFolderUrl, folderNameTemplate, responses, fieldLabels, fieldValues }
 * @param {Object} context - { responses, fieldLabels, fieldValues, now }（driveSettingsから構築可能）
 * @return {Folder}
 */
function nfbResolveFolderFromInput_(input) {
  var normalizedInput = input === undefined || input === null ? "" : String(input).trim();
  if (!normalizedInput) {
    throw new Error("フォルダURLが指定されていません");
  }

  var parsed = Forms_parseGoogleDriveUrl_(normalizedInput);
  if (parsed.type !== "folder" || !parsed.id) {
    throw new Error("無効なフォルダURLです: " + normalizedInput);
  }

  try {
    return DriveApp.getFolderById(parsed.id);
  } catch (error) {
    throw new Error("フォルダへのアクセスに失敗しました: " + nfbErrorToString_(error));
  }
}

function nfbResolveRootFolder_(driveSettings) {
  var rootUrl = driveSettings && driveSettings.rootFolderUrl ? String(driveSettings.rootFolderUrl).trim() : "";
  if (!rootUrl) {
    return DriveApp.getRootFolder();
  }
  return nfbResolveFolderFromInput_(rootUrl);
}

function nfbBuildDriveTemplateContext_(driveSettings, context) {
  return context || {
    responses: (driveSettings && driveSettings.responses) || {},
    fieldLabels: (driveSettings && driveSettings.fieldLabels) || {},
    fieldValues: (driveSettings && driveSettings.fieldValues) || {},
    formId: driveSettings && driveSettings.formId ? String(driveSettings.formId).trim() : "",
    recordId: driveSettings && driveSettings.recordId ? String(driveSettings.recordId).trim() : "",
    folderUrl: driveSettings && driveSettings.folderUrl ? String(driveSettings.folderUrl).trim() : "",
    now: new Date()
  };
}

function nfbResolveOrCreateFolder_(driveSettings, context) {
  var directFolderUrl = driveSettings && driveSettings.folderUrl ? String(driveSettings.folderUrl).trim() : "";
  if (directFolderUrl) {
    return nfbResolveFolderFromInput_(directFolderUrl);
  }

  var rootFolder = nfbResolveRootFolder_(driveSettings);

  var folderTemplate = driveSettings && driveSettings.folderNameTemplate ? String(driveSettings.folderNameTemplate).trim() : "";
  if (!folderTemplate) {
    return rootFolder;
  }

  var ctx = nfbBuildDriveTemplateContext_(driveSettings, context);

  var folderName = nfbResolveTemplate_(folderTemplate, ctx);
  if (!folderName) {
    return rootFolder;
  }

  // 同名フォルダが既にあればそれを返す
  var existingFolders = rootFolder.getFoldersByName(folderName);
  if (existingFolders.hasNext()) {
    return existingFolders.next();
  }

  return rootFolder.createFolder(folderName);
}

function nfbBuildRecordTempFolderName_(driveSettings) {
  var rawRecordId = driveSettings && driveSettings.recordId ? String(driveSettings.recordId).trim() : "";
  var safeRecordId = rawRecordId ? rawRecordId.replace(/[^A-Za-z0-9_-]/g, "_") : "record";
  return NFB_RECORD_TEMP_FOLDER_PREFIX + safeRecordId + "_" + Utilities.getUuid().slice(0, 8);
}

function nfbResolveUploadFolder_(driveSettings) {
  var directFolderUrl = driveSettings && driveSettings.folderUrl ? String(driveSettings.folderUrl).trim() : "";
  if (directFolderUrl) {
    return {
      folder: nfbResolveFolderFromInput_(directFolderUrl),
      autoCreated: false
    };
  }

  var rootFolder = nfbResolveRootFolder_(driveSettings);
  return {
    folder: rootFolder.createFolder(nfbBuildRecordTempFolderName_(driveSettings)),
    autoCreated: true
  };
}

function nfbIsRecordTempFolder_(folder) {
  if (!folder || typeof folder.getName !== "function") return false;
  var folderName = String(folder.getName() || "");
  return folderName.indexOf(NFB_RECORD_TEMP_FOLDER_PREFIX) === 0;
}

function nfbNormalizeDriveFileIds_(fileIds) {
  var seen = {};
  var normalized = [];
  var source = Array.isArray(fileIds) ? fileIds : [];
  for (var i = 0; i < source.length; i++) {
    var fileId = typeof source[i] === "string" ? source[i].trim() : "";
    if (!fileId || seen[fileId]) continue;
    seen[fileId] = true;
    normalized.push(fileId);
  }
  return normalized;
}

function nfbMoveFilesToFolder_(fileIds, folder) {
  var normalizedFileIds = nfbNormalizeDriveFileIds_(fileIds);
  for (var i = 0; i < normalizedFileIds.length; i++) {
    var file;
    try {
      file = DriveApp.getFileById(normalizedFileIds[i]);
    } catch (error) {
      throw new Error("ファイルへのアクセスに失敗しました: " + nfbErrorToString_(error));
    }
    if (file && typeof file.isTrashed === "function" && file.isTrashed()) {
      continue;
    }
    file.moveTo(folder);
  }
}

function nfbTrashFilesByIds_(fileIds) {
  var normalizedFileIds = nfbNormalizeDriveFileIds_(fileIds);
  for (var i = 0; i < normalizedFileIds.length; i++) {
    var file;
    try {
      file = DriveApp.getFileById(normalizedFileIds[i]);
    } catch (error) {
      throw new Error("ファイルへのアクセスに失敗しました: " + nfbErrorToString_(error));
    }
    file.setTrashed(true);
  }
}

function nfbTrashDriveFilesByIds(payload) {
  return nfbSafeCall_(function() {
    var fileIds = Array.isArray(payload) ? payload : (payload && payload.fileIds);
    var normalizedFileIds = nfbNormalizeDriveFileIds_(fileIds);
    nfbTrashFilesByIds_(normalizedFileIds);
    return {
      ok: true,
      trashedIds: normalizedFileIds
    };
  });
}

function nfbFinalizeRecordDriveFolder(payload) {
  return nfbSafeCall_(function() {
    var currentDriveFolderUrl = payload && payload.currentDriveFolderUrl ? String(payload.currentDriveFolderUrl).trim() : "";
    var inputDriveFolderUrl = payload && payload.inputDriveFolderUrl ? String(payload.inputDriveFolderUrl).trim() : "";
    var currentFolder = currentDriveFolderUrl ? nfbResolveFolderFromInput_(currentDriveFolderUrl) : null;
    var inputFolder = inputDriveFolderUrl ? nfbResolveFolderFromInput_(inputDriveFolderUrl) : null;
    var targetFolder = inputFolder || currentFolder;

    nfbTrashFilesByIds_(payload && payload.trashFileIds);

    if (!targetFolder) {
      return {
        ok: true,
        folderUrl: ""
      };
    }

    if (inputFolder && currentFolder && inputFolder.getId() !== currentFolder.getId()) {
      nfbMoveFilesToFolder_(payload && payload.fileIds, inputFolder);
    }

    var isCurrentTarget = currentFolder && (!inputFolder || inputFolder.getId() === currentFolder.getId());
    if (isCurrentTarget && nfbIsRecordTempFolder_(currentFolder)) {
      var folderNameTemplate = payload && payload.folderNameTemplate ? String(payload.folderNameTemplate).trim() : "";
      if (folderNameTemplate) {
        var resolvedFolderName = nfbResolveTemplate_(folderNameTemplate, {
          responses: payload && payload.responses ? payload.responses : {},
          fieldLabels: payload && payload.fieldLabels ? payload.fieldLabels : {},
          fieldValues: payload && payload.fieldValues ? payload.fieldValues : {},
          recordId: payload && payload.recordId ? payload.recordId : "",
          now: new Date()
        });
        if (resolvedFolderName) {
          currentFolder.setName(resolvedFolderName);
        }
      }
    }

    return {
      ok: true,
      folderUrl: targetFolder.getUrl(),
      autoCreated: nfbIsRecordTempFolder_(targetFolder)
    };
  });
}

/**
 * フォルダ内の同名ファイルをゴミ箱に移動する（上書き前処理）
 * @param {Folder} folder
 * @param {string} fileName
 */
function nfbTrashExistingFile_(folder, fileName) {
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }
}

function nfbEscapeRegExp_(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nfbEscapeReplaceTextReplacement_(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "\\$");
}

function nfbApplyTemplateReplacementsToText_(textElement, replacements) {
  if (!textElement || typeof textElement.replaceText !== "function") return;

  var tokens = Object.keys(replacements).sort(function(a, b) { return b.length - a.length; });
  var markerPrefix = "__NFB_DOC_TEMPLATE_MARKER__";
  var markerPairs = [];
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    var marker = markerPrefix + i + "__";
    textElement.replaceText(nfbEscapeRegExp_(token), marker);
    markerPairs.push({ marker: marker, value: replacements[token] });
  }
  for (var j = 0; j < markerPairs.length; j++) {
    textElement.replaceText(
      nfbEscapeRegExp_(markerPairs[j].marker),
      nfbEscapeReplaceTextReplacement_(markerPairs[j].value)
    );
  }
}

function nfbApplyTemplateReplacementsToElement_(element, replacements) {
  if (!element) return;

  if (typeof element.editAsText === "function") {
    var textElement = element.editAsText();
    if (textElement && typeof textElement.getText === "function" && typeof textElement.replaceText === "function") {
      nfbApplyTemplateReplacementsToText_(textElement, replacements);
      return;
    }
  }

  if (typeof element.getNumChildren === "function" && typeof element.getChild === "function") {
    for (var i = 0; i < element.getNumChildren(); i++) {
      nfbApplyTemplateReplacementsToElement_(element.getChild(i), replacements);
    }
  }
}

function nfbApplyTemplateReplacementsToGoogleDocument_(doc, replacements) {
  if (!doc) return;
  if (typeof doc.getBody === "function") {
    nfbApplyTemplateReplacementsToElement_(doc.getBody(), replacements);
  }
  if (typeof doc.getHeader === "function") {
    nfbApplyTemplateReplacementsToElement_(doc.getHeader(), replacements);
  }
  if (typeof doc.getFooter === "function") {
    nfbApplyTemplateReplacementsToElement_(doc.getFooter(), replacements);
  }
}

/**
 * ローカルファイルをGoogle Driveにアップロードする
 * @param {Object} payload - { base64, fileName, mimeType, driveSettings }
 * @return {Object} { ok: true, fileUrl, fileName, fileId }
 */
function nfbUploadFileToDrive(payload) {
  return nfbSafeCall_(function() {
    if (!payload || !payload.base64 || !payload.fileName) {
      throw new Error("ファイルデータが不足しています");
    }

    var bytes = Utilities.base64Decode(payload.base64);
    var mimeType = payload.mimeType || "application/octet-stream";
    var fileName = String(payload.fileName).trim();
    var blob = Utilities.newBlob(bytes, mimeType, fileName);

    var folderResult = nfbResolveUploadFolder_(payload.driveSettings);
    var folder = folderResult.folder;
    nfbTrashExistingFile_(folder, fileName);

    var file = folder.createFile(blob);

    return {
      ok: true,
      fileUrl: file.getUrl(),
      fileName: file.getName(),
      fileId: file.getId(),
      folderUrl: folder.getUrl(),
      autoCreated: folderResult.autoCreated === true
    };
  });
}

/**
 * Google Driveのファイルをコピーして指定フォルダに保存する
 * @param {Object} payload - { sourceUrl, driveSettings }
 * @return {Object} { ok: true, fileUrl, fileName, fileId }
 */
function nfbCopyDriveFileToDrive(payload) {
  return nfbSafeCall_(function() {
    if (!payload || !payload.sourceUrl) {
      throw new Error("ソースファイルのURLが指定されていません");
    }

    var parsed = Forms_parseGoogleDriveUrl_(payload.sourceUrl);
    if (!parsed.id || parsed.type !== "file") {
      throw new Error("無効なGoogle DriveファイルURLです");
    }

    var sourceFile;
    try {
      sourceFile = DriveApp.getFileById(parsed.id);
    } catch (accessError) {
      throw new Error("ソースファイルへのアクセスに失敗しました: " + nfbErrorToString_(accessError));
    }

    var originalName = sourceFile.getName();
    var folderResult = nfbResolveUploadFolder_(payload.driveSettings);
    var folder = folderResult.folder;
    var ctx = nfbBuildDriveTemplateContext_(payload.driveSettings);
    var resolvedName = payload && payload.fileNameTemplate
      ? nfbResolveTemplate_(String(payload.fileNameTemplate), ctx)
      : "";
    var finalName = resolvedName || originalName;
    nfbTrashExistingFile_(folder, finalName);

    var copiedFile = sourceFile.makeCopy(finalName, folder);

    return {
      ok: true,
      fileUrl: copiedFile.getUrl(),
      fileName: copiedFile.getName(),
      fileId: copiedFile.getId(),
      folderUrl: folder.getUrl(),
      autoCreated: folderResult.autoCreated === true
    };
  });
}

function nfbCreateGoogleDocumentFromTemplate(payload) {
  return nfbSafeCall_(function() {
    if (!payload || !payload.sourceUrl) {
      throw new Error("ソースファイルのURLが指定されていません");
    }
    if (!payload.driveSettings) {
      throw new Error("出力先設定が不足しています");
    }

    var parsed = Forms_parseGoogleDriveUrl_(payload.sourceUrl);
    if (!parsed.id || parsed.type !== "file") {
      throw new Error("無効なGoogle DriveファイルURLです");
    }

    var sourceFile;
    try {
      sourceFile = DriveApp.getFileById(parsed.id);
    } catch (accessError) {
      throw new Error("ソースファイルへのアクセスに失敗しました: " + nfbErrorToString_(accessError));
    }

    var folderResult = nfbResolveUploadFolder_(payload.driveSettings);
    var folder = folderResult.folder;
    var ctx = nfbBuildDriveTemplateContext_(payload.driveSettings);
    var resolvedName = payload && payload.fileNameTemplate
      ? nfbResolveTemplate_(String(payload.fileNameTemplate), ctx)
      : "";
    var finalName = resolvedName || sourceFile.getName();
    nfbTrashExistingFile_(folder, finalName);

    var copiedFile = sourceFile.makeCopy(finalName, folder);
    var doc;
    try {
      doc = DocumentApp.openById(copiedFile.getId());
      nfbApplyTemplateReplacementsToGoogleDocument_(doc, nfbBuildTemplateReplacementMap_(ctx));
      doc.saveAndClose();
    } catch (error) {
      throw new Error("Google ドキュメントテンプレートの差し込みに失敗しました: " + nfbErrorToString_(error));
    }

    return {
      ok: true,
      fileUrl: copiedFile.getUrl(),
      fileName: copiedFile.getName(),
      fileId: copiedFile.getId(),
      folderUrl: folder.getUrl(),
      autoCreated: folderResult.autoCreated === true
    };
  });
}

function nfbFindDriveFileInFolder(payload) {
  return nfbSafeCall_(function() {
    if (!payload || !payload.fileNameTemplate || !payload.driveSettings) {
      throw new Error("検索条件が不足しています");
    }
    var ctx = nfbBuildDriveTemplateContext_(payload.driveSettings);
    var finalName = nfbResolveTemplate_(String(payload.fileNameTemplate), ctx);
    if (!finalName) {
      throw new Error("ファイル名を解決できませんでした");
    }
    var folderResult = nfbResolveUploadFolder_(payload.driveSettings);
    var folder = folderResult.folder;
    var files = folder.getFilesByName(finalName);
    if (files.hasNext()) {
      var found = files.next();
      return {
        ok: true,
        found: true,
        fileUrl: found.getUrl(),
        fileName: found.getName(),
        fileId: found.getId(),
        folderUrl: folder.getUrl(),
      };
    }
    return { ok: true, found: false, fileName: finalName, folderUrl: folder.getUrl() };
  });
}

// =========================================================================
// 印刷様式ユーティリティ（既存）
// =========================================================================

function nfbFormatPrintDocumentExportedAt_(value) {
  var date = value ? new Date(value) : new Date();
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    date = new Date();
  }
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss");
}

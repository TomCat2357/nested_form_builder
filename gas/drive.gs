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
 * フロントエンドで生成したファイルをGoogle Driveに保存する（汎用）
 * @param {Object} payload - { filename: string, base64: string, mimeType: string }
 * @return {Object} { ok: true, fileUrl: string, fileName: string }
 */
function nfbSaveFileToDrive(payload) {
  return nfbSafeCall_(function() {
    if (!payload || !payload.base64 || !payload.filename) {
      throw new Error("ファイルデータが不足しています");
    }

    var bytes = Utilities.base64Decode(payload.base64);
    var mimeType = payload.mimeType || "application/octet-stream";
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
    var outputType = action.outputType === "gmail" ? "gmail" : (action.outputType === "googleDoc" ? "googleDoc" : "pdf");
    var fileNameTemplate = nfbResolveRecordOutputFileNameTemplate_(payload, action, outputType);
    if (nfbRequiresRecordOutputFileNameTemplate_(action, outputType) && !fileNameTemplate) {
      throw new Error("出力ファイル名が指定されていません");
    }

    var driveSettings = payload && payload.driveSettings ? payload.driveSettings : {};
    var initialFolderUrl = driveSettings.folderUrl ? String(driveSettings.folderUrl).trim() : "";
    var outputContext = nfbBuildRecordOutputContext_(payload, initialFolderUrl);
    var finalBaseName = fileNameTemplate
      ? (nfbResolveTemplate_(fileNameTemplate, outputContext) || ("record_" + outputContext.recordId))
      : "";

    if (outputType === "gmail") {
      return nfbCreateGmailDraftOutput_(payload, action, outputContext, finalBaseName);
    }

    if (outputType === "googleDoc") {
      return nfbCreateGoogleDocInRootOutput_(payload, action, outputContext, finalBaseName);
    }

    return nfbCreatePdfDownloadOutput_(payload, action, outputContext, finalBaseName);
  });
}

function nfbExecuteBatchGoogleDocOutput(payload) {
  return nfbSafeCall_(function() {
    var records = payload && payload.records;
    if (!records || !records.length) throw new Error("レコードが選択されていません");

    var fileName = payload.fileNameTemplate || "一括出力";
    var tmpBase = fileName + "__tmp_" + Utilities.getUuid();
    var rootFolder = DriveApp.getRootFolder();

    // 1件目のレコードでベースDocを作成
    var firstPayload = records[0];
    var firstAction = firstPayload.action || {};
    var firstFolderUrl = (firstPayload.driveSettings && firstPayload.driveSettings.folderUrl) || "";
    var firstContext = nfbBuildRecordOutputContext_(firstPayload, firstFolderUrl);
    var firstSourceUrl = nfbResolveRecordOutputTemplateSourceUrl_(firstPayload, firstAction);

    var combinedFile;
    if (firstSourceUrl) {
      combinedFile = nfbCreateGoogleDocumentFileFromTemplate_(firstSourceUrl, rootFolder, tmpBase, firstContext);
    } else {
      var firstPrintPayload = firstPayload.recordContext ? firstPayload.recordContext.printPayload : null;
      combinedFile = nfbCreateGoogleDocumentFileInRoot_(firstPrintPayload, tmpBase);
    }

    // 2件目以降: 改ページ + body要素コピー
    if (records.length > 1) {
      var combinedDoc = DocumentApp.openById(combinedFile.getId());
      var combinedBody = combinedDoc.getBody();

      for (var i = 1; i < records.length; i++) {
        combinedBody.appendPageBreak();

        var recPayload = records[i];
        var recAction = recPayload.action || {};
        var recFolderUrl = (recPayload.driveSettings && recPayload.driveSettings.folderUrl) || "";
        var recContext = nfbBuildRecordOutputContext_(recPayload, recFolderUrl);
        var recSourceUrl = nfbResolveRecordOutputTemplateSourceUrl_(recPayload, recAction);

        var tempFile;
        if (recSourceUrl) {
          tempFile = nfbCreateGoogleDocumentFileFromTemplate_(recSourceUrl, rootFolder, tmpBase + "_" + i, recContext);
        } else {
          var recPrintPayload = recPayload.recordContext ? recPayload.recordContext.printPayload : null;
          tempFile = nfbCreateGoogleDocumentFileInRoot_(recPrintPayload, tmpBase + "_" + i);
        }

        var tempDoc = DocumentApp.openById(tempFile.getId());
        var tempBody = tempDoc.getBody();
        nfbCopyBodyElements_(tempBody, combinedBody);
        tempDoc.saveAndClose();
        tempFile.setTrashed(true);
      }

      combinedDoc.saveAndClose();
    }

    // 最終ファイル名に変更
    combinedFile.setName(fileName);

    return {
      ok: true,
      outputType: "googleDoc",
      openUrl: combinedFile.getUrl(),
      fileName: combinedFile.getName()
    };
  });
}

function nfbCopyBodyElements_(sourceBody, targetBody) {
  var numChildren = sourceBody.getNumChildren();
  for (var i = 0; i < numChildren; i++) {
    var element = sourceBody.getChild(i);
    var type = element.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH) {
      targetBody.appendParagraph(element.copy());
    } else if (type === DocumentApp.ElementType.TABLE) {
      targetBody.appendTable(element.copy());
    } else if (type === DocumentApp.ElementType.LIST_ITEM) {
      targetBody.appendListItem(element.copy());
    } else if (type === DocumentApp.ElementType.HORIZONTAL_RULE) {
      targetBody.appendHorizontalRule();
    } else if (type === DocumentApp.ElementType.PAGE_BREAK) {
      targetBody.appendPageBreak();
    }
  }
}

function nfbBuildRecordOutputContext_(payload, folderUrl) {
  var driveSettings = payload && payload.driveSettings ? payload.driveSettings : {};
  var recordContext = payload && payload.recordContext ? payload.recordContext : {};
  var now = new Date();
  var formId = recordContext.formId || driveSettings.formId || "";
  var recordId = recordContext.recordId || driveSettings.recordId || "";
  var webAppUrl = ScriptApp.getService().getUrl() || "";
  var formUrl = webAppUrl && formId
    ? webAppUrl + "?form=" + encodeURIComponent(formId)
    : "";
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
    formUrl: formUrl,
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
    return (action && action.gmailAttachPdf)
      ? (sharedTemplate || nfbResolveStandardPrintFileNameTemplate_(settings))
      : "";
  }

  return actionTemplate || sharedTemplate || nfbResolveStandardPrintFileNameTemplate_(settings);
}

function nfbResolveStandardPrintFileNameTemplate_(settings) {
  var configuredTemplate = settings && settings.standardPrintFileNameTemplate
    ? String(settings.standardPrintFileNameTemplate).trim()
    : "";
  return configuredTemplate || "{ID}_{YYYY}-{MM}-{DD}";
}

function nfbRequiresRecordOutputFileNameTemplate_(action, outputType) {
  return outputType !== "gmail" || !!(action && action.gmailAttachPdf);
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
  var pdfFile = nfbCreatePdfFileFromGoogleDocument_(docFile, folder, finalBaseName);
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

function nfbCreateGmailDraftOutput_(payload, action, outputContext, finalBaseName) {
  action = action || {};
  var to = nfbResolveTemplate_(String(action && action.gmailTemplateTo || ""), outputContext);
  var cc = nfbResolveTemplate_(String(action && action.gmailTemplateCc || ""), outputContext);
  var bcc = nfbResolveTemplate_(String(action && action.gmailTemplateBcc || ""), outputContext);
  var subject = nfbResolveTemplate_(String(action && action.gmailTemplateSubject || ""), outputContext);
  var bodyTemplate = String(action && action.gmailTemplateBody || "");

  var needsPdf = !!(action && action.gmailAttachPdf);

  var attachments = [];

  if (needsPdf) {
    var documentAction = nfbCloneRecordOutputActionForGeneratedFile_(action);
    var tmpName = finalBaseName + "__tmp_" + Utilities.getUuid();
    var docFile = nfbCreateRecordOutputGoogleDocumentInRoot_(payload, documentAction, outputContext, tmpName);
    var pdfName = /\.pdf$/i.test(finalBaseName) ? finalBaseName : finalBaseName + ".pdf";
    var pdfBlob = docFile.getBlob().getAs(MimeType.PDF).setName(pdfName);
    attachments.push(pdfBlob);
    docFile.setTrashed(true);
  }

  var body = nfbResolveTemplate_(bodyTemplate, outputContext, { allowGmailOnlyTokens: true });

  var draftOptions = {};
  if (cc) draftOptions.cc = cc;
  if (bcc) draftOptions.bcc = bcc;
  if (attachments.length > 0) draftOptions.attachments = attachments;

  var draft = GmailApp.createDraft(to, subject, body, draftOptions);

  return {
    ok: true,
    outputType: "gmail",
    draftId: draft.getId(),
    openUrl: "https://mail.google.com/mail/#drafts"
  };
}

function nfbCreatePdfDownloadOutput_(payload, action, outputContext, finalBaseName) {
  var tmpName = finalBaseName + "__tmp_" + Utilities.getUuid();
  var docFile = nfbCreateRecordOutputGoogleDocumentInRoot_(payload, action, outputContext, tmpName);
  var pdfName = /\.pdf$/i.test(finalBaseName) ? finalBaseName : finalBaseName + ".pdf";
  var pdfBlob = docFile.getBlob().getAs(MimeType.PDF).setName(pdfName);
  var base64 = Utilities.base64Encode(pdfBlob.getBytes());
  docFile.setTrashed(true);
  return {
    ok: true,
    outputType: "pdf",
    pdfBase64: base64,
    fileName: pdfName
  };
}

function nfbCreateGoogleDocInRootOutput_(payload, action, outputContext, finalBaseName) {
  var docFile = nfbCreateRecordOutputGoogleDocumentInRoot_(payload, action, outputContext, finalBaseName);
  return {
    ok: true,
    outputType: "googleDoc",
    openUrl: docFile.getUrl(),
    fileName: docFile.getName()
  };
}

function nfbCreateRecordOutputGoogleDocumentInRoot_(payload, action, outputContext, finalBaseName) {
  var sourceUrl = nfbResolveRecordOutputTemplateSourceUrl_(payload, action);
  if (sourceUrl) {
    var rootFolder = DriveApp.getRootFolder();
    return nfbCreateGoogleDocumentFileFromTemplate_(sourceUrl, rootFolder, finalBaseName, outputContext);
  }
  var printPayload = payload && payload.recordContext ? payload.recordContext.printPayload : null;
  return nfbCreateGoogleDocumentFileInRoot_(printPayload, finalBaseName);
}

function nfbCreateGoogleDocumentFileInRoot_(printPayload, finalBaseName) {
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
  return DriveApp.getFileById(doc.getId());
}

function nfbCloneTemplateContext_(context) {
  var cloned = {};
  var source = context || {};
  for (var key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      cloned[key] = source[key];
    }
  }
  return cloned;
}

function nfbCloneRecordOutputActionForGeneratedFile_(action) {
  var cloned = {};
  var source = action || {};
  for (var key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      cloned[key] = source[key];
    }
  }
  cloned.useCustomTemplate = false;
  cloned.templateUrl = "";
  return cloned;
}

function nfbCreatePdfFileFromGoogleDocument_(docFile, folder, finalBaseName) {
  var pdfName = /\.pdf$/i.test(finalBaseName) ? finalBaseName : finalBaseName + ".pdf";
  nfbTrashExistingFile_(folder, pdfName);
  return folder.createFile(docFile.getBlob().getAs(MimeType.PDF).setName(pdfName));
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
    nfbApplyTemplateReplacementsToGoogleDocument_(doc, outputContext);
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

function nfbBuildFieldLabelValueMap_(context) {
  var responses = (context && context.responses) || {};
  var fieldLabels = (context && context.fieldLabels) || {};
  var fieldValues = (context && context.fieldValues) || {};
  var labelValueMap = {};

  for (var fid in fieldLabels) {
    if (!Object.prototype.hasOwnProperty.call(fieldLabels, fid)) continue;
    var label = fieldLabels[fid];
    if (!label || Object.prototype.hasOwnProperty.call(labelValueMap, label)) continue;
    var value = Object.prototype.hasOwnProperty.call(fieldValues, fid) ? fieldValues[fid] : responses[fid];
    labelValueMap[label] = nfbTemplateValueToString_(value);
  }

  return labelValueMap;
}

function nfbGetTemplateDateParts_(date, tz) {
  return {
    year: Number(Utilities.formatDate(date, tz, "yyyy")),
    month: Number(Utilities.formatDate(date, tz, "M")),
    day: Number(Utilities.formatDate(date, tz, "d")),
    hour: Number(Utilities.formatDate(date, tz, "H")),
    minute: Number(Utilities.formatDate(date, tz, "m")),
    second: Number(Utilities.formatDate(date, tz, "s"))
  };
}

function nfbDatePartsIsSameOrAfter_(dateParts, comparison) {
  if (dateParts.year !== comparison.year) return dateParts.year > comparison.year;
  if (dateParts.month !== comparison.month) return dateParts.month > comparison.month;
  return dateParts.day >= comparison.day;
}

function nfbResolveJapaneseEra_(dateParts) {
  var eras = [
    { name: "令和", year: 2019, month: 5, day: 1 },
    { name: "平成", year: 1989, month: 1, day: 8 },
    { name: "昭和", year: 1926, month: 12, day: 25 },
    { name: "大正", year: 1912, month: 7, day: 30 },
    { name: "明治", year: 1868, month: 1, day: 25 }
  ];

  for (var i = 0; i < eras.length; i++) {
    if (nfbDatePartsIsSameOrAfter_(dateParts, eras[i])) {
      return {
        name: eras[i].name,
        year: dateParts.year - eras[i].year + 1
      };
    }
  }

  return {
    name: "",
    year: dateParts.year
  };
}

function nfbIsReservedTemplateToken_(tokenName) {
  return tokenName === "ID"
    || tokenName === "gg"
    || tokenName === "_folder_url"
    || tokenName === "_record_url"
    || tokenName === "_form_url"
    || /^Y+$/.test(tokenName)
    || /^M+$/.test(tokenName)
    || /^D+$/.test(tokenName)
    || /^H+$/.test(tokenName)
    || /^m+$/.test(tokenName)
    || /^s+$/.test(tokenName)
    || /^e+$/.test(tokenName);
}

function nfbResolveReservedTemplateToken_(tokenName, context, options) {
  var now = context && context.now ? context.now : new Date();
  var tz = Session.getScriptTimeZone();
  var dateParts = nfbGetTemplateDateParts_(now, tz);
  var era = nfbResolveJapaneseEra_(dateParts);
  var recordId = context && context.recordId ? String(context.recordId).trim() : "";
  var recordUrl = context && context.recordUrl ? String(context.recordUrl).trim() : "";
  var folderUrl = context && context.folderUrl ? String(context.folderUrl).trim() : "";
  var formUrl = context && context.formUrl ? String(context.formUrl).trim() : "";
  var allowGmailOnlyTokens = options && options.allowGmailOnlyTokens === true;

  if (tokenName === "ID") return recordId;
  if (tokenName === "gg") return era.name;
  if (/^Y+$/.test(tokenName)) return String(dateParts.year).padStart(tokenName.length, "0");
  if (/^M+$/.test(tokenName)) return String(dateParts.month).padStart(tokenName.length, "0");
  if (/^D+$/.test(tokenName)) return String(dateParts.day).padStart(tokenName.length, "0");
  if (/^H+$/.test(tokenName)) return String(dateParts.hour).padStart(tokenName.length, "0");
  if (/^m+$/.test(tokenName)) return String(dateParts.minute).padStart(tokenName.length, "0");
  if (/^s+$/.test(tokenName)) return String(dateParts.second).padStart(tokenName.length, "0");
  if (/^e+$/.test(tokenName)) return String(era.year).padStart(tokenName.length, "0");
  if (tokenName === "_folder_url") return allowGmailOnlyTokens ? folderUrl : "";
  if (tokenName === "_record_url") return allowGmailOnlyTokens ? recordUrl : "";
  if (tokenName === "_form_url") return allowGmailOnlyTokens ? formUrl : "";
  return null;
}

function nfbResolveFieldTemplateToken_(tokenName, context) {
  var labelValueMap = nfbBuildFieldLabelValueMap_(context);
  return Object.prototype.hasOwnProperty.call(labelValueMap, tokenName) ? labelValueMap[tokenName] : "";
}

function nfbResolveTemplateTokenValue_(tokenName, context, options) {
  var forceFieldReference = options && options.forceFieldReference === true;
  if (!forceFieldReference) {
    var reservedValue = nfbResolveReservedTemplateToken_(tokenName, context, options);
    if (reservedValue !== null) {
      return reservedValue;
    }
  }
  return nfbResolveFieldTemplateToken_(tokenName, context);
}

function nfbResolveTemplateTokens_(template, context, options) {
  if (!template || typeof template !== "string") return "";

  var escapedOpenBraceToken = "__NFB_ESCAPED_OPEN_BRACE__";
  var escapedCloseBraceToken = "__NFB_ESCAPED_CLOSE_BRACE__";
  var result = String(template)
    .replace(/\\\{/g, escapedOpenBraceToken)
    .replace(/\\\}/g, escapedCloseBraceToken)
    .replace(/\{([^{}]+)\}/g, function(match, tokenBody) {
      var rawTokenName = tokenBody || "";
      var forceFieldReference = rawTokenName.indexOf("\\") === 0;
      var tokenName = forceFieldReference ? rawTokenName.slice(1) : rawTokenName;
      if (!tokenName) return "";

      var pipeIndex = tokenName.indexOf("|");
      if (pipeIndex >= 0) {
        var fieldPart = tokenName.substring(0, pipeIndex);
        var transformersPart = tokenName.substring(pipeIndex + 1);
        var resolvedValue = nfbResolveTemplateTokenValue_(fieldPart, context, {
          allowGmailOnlyTokens: options && options.allowGmailOnlyTokens === true,
          forceFieldReference: forceFieldReference
        });
        return nfbApplyPipeTransformers_(resolvedValue, transformersPart);
      }

      return nfbResolveTemplateTokenValue_(tokenName, context, {
        allowGmailOnlyTokens: options && options.allowGmailOnlyTokens === true,
        forceFieldReference: forceFieldReference
      });
    });

  return result
    .split(escapedOpenBraceToken).join("{")
    .split(escapedCloseBraceToken).join("}");
}

function nfbResolveTemplate_(template, context, options) {
  return nfbResolveTemplateTokens_(template, context, options);
}

// ---------------------------------------------------------------------------
// Pipe transformer system: {field|transform:args|transform2:args2}
// ---------------------------------------------------------------------------

function nfbSplitEscaped_(str, delimiter) {
  var SENTINEL = "__NFB_ESC_" + delimiter.charCodeAt(0) + "__";
  var escaped = str.split("\\" + delimiter).join(SENTINEL);
  var parts = escaped.split(delimiter);
  for (var i = 0; i < parts.length; i++) {
    parts[i] = parts[i].split(SENTINEL).join(delimiter);
  }
  return parts;
}

function nfbParsePipeTransformers_(transformerString) {
  var parts = nfbSplitEscaped_(transformerString, "|");
  var result = [];
  for (var i = 0; i < parts.length; i++) {
    var segment = parts[i];
    var colonIndex = segment.indexOf(":");
    if (colonIndex >= 0) {
      result.push({ name: segment.substring(0, colonIndex), args: segment.substring(colonIndex + 1) });
    } else {
      result.push({ name: segment, args: "" });
    }
  }
  return result;
}

function nfbApplyPipeTransformers_(value, transformerString) {
  var transformers = nfbParsePipeTransformers_(transformerString);
  var current = value === undefined || value === null ? "" : String(value);
  for (var i = 0; i < transformers.length; i++) {
    current = nfbApplyOneTransformer_(current, transformers[i].name, transformers[i].args);
  }
  return current;
}

var NFB_TRANSFORMERS_ = {
  "date":     nfbTransformDate_,
  "time":     nfbTransformTime_,
  "left":     nfbTransformLeft_,
  "right":    nfbTransformRight_,
  "mid":      nfbTransformMid_,
  "pad":      nfbTransformPad_,
  "padRight": nfbTransformPadRight_,
  "upper":    function(v) { return v.toUpperCase(); },
  "lower":    function(v) { return v.toLowerCase(); },
  "trim":     function(v) { return v.replace(/^\s+|\s+$/g, ""); },
  "default":  function(v, a) { return v ? v : String(a); },
  "replace":  nfbTransformReplace_,
  "match":    nfbTransformMatch_,
  "number":   nfbTransformNumber_,
  "if":       nfbTransformIf_,
  "map":      nfbTransformMap_,
  "kana":     nfbTransformKana_,
  "zen":      nfbTransformZen_,
  "han":      nfbTransformHan_
};

function nfbApplyOneTransformer_(value, name, args) {
  var fn = NFB_TRANSFORMERS_[name];
  return fn ? fn(value, args) : value;
}

function nfbParseDateString_(value) {
  var str = String(value).replace(/^\s+|\s+$/g, "");
  var m = str.match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  var m2 = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return { year: Number(m2[1]), month: Number(m2[2]), day: Number(m2[3]) };
  return null;
}

var NFB_DAY_OF_WEEK_SHORT_ = ["日", "月", "火", "水", "木", "金", "土"];
var NFB_DAY_OF_WEEK_LONG_ = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

function nfbTransformDate_(value, formatStr) {
  var dateParts = nfbParseDateString_(value);
  if (!dateParts) return value;

  var era = nfbResolveJapaneseEra_(dateParts);
  var dow = new Date(dateParts.year, dateParts.month - 1, dateParts.day).getDay();
  var result = formatStr;

  // Longer tokens first to avoid partial replacement
  result = result.split("dddd").join(NFB_DAY_OF_WEEK_LONG_[dow]);
  result = result.split("ddd").join(NFB_DAY_OF_WEEK_SHORT_[dow]);
  result = result.split("gge").join(era.name + String(era.year));
  result = result.split("gg").join(era.name);
  result = result.split("YYYY").join(String(dateParts.year));
  result = result.split("YY").join(("0" + dateParts.year).slice(-2));
  result = result.split("MM").join(("0" + dateParts.month).slice(-2));
  result = result.split("DD").join(("0" + dateParts.day).slice(-2));
  result = result.split("ee").join(("0" + era.year).slice(-2));
  // Single-char tokens after their multi-char variants are already consumed
  result = result.split("M").join(String(dateParts.month));
  result = result.split("D").join(String(dateParts.day));
  result = result.split("e").join(String(era.year));

  return result;
}

function nfbTransformLeft_(value, args) {
  var n = parseInt(args, 10);
  if (isNaN(n) || n < 0) return value;
  return value.substring(0, n);
}

function nfbTransformRight_(value, args) {
  var n = parseInt(args, 10);
  if (isNaN(n) || n < 0) return value;
  return n >= value.length ? value : value.substring(value.length - n);
}

function nfbTransformMid_(value, args) {
  var parts = args.split(",");
  var start = parseInt(parts[0], 10);
  var length = parts.length > 1 ? parseInt(parts[1], 10) : undefined;
  if (isNaN(start) || start < 0) return value;
  if (length !== undefined && (isNaN(length) || length < 0)) return value;
  return length !== undefined ? value.substr(start, length) : value.substring(start);
}

function nfbTransformPad_(value, args) {
  var parts = args.split(",");
  var length = parseInt(parts[0], 10);
  var padChar = parts.length > 1 ? parts[1] : "0";
  if (isNaN(length) || length <= 0) return value;
  var result = value;
  while (result.length < length) result = padChar + result;
  return result;
}

function nfbTransformPadRight_(value, args) {
  var parts = args.split(",");
  var length = parseInt(parts[0], 10);
  var padChar = parts.length > 1 ? parts[1] : " ";
  if (isNaN(length) || length <= 0) return value;
  var result = value;
  while (result.length < length) result = result + padChar;
  return result;
}

function nfbTransformReplace_(value, args) {
  var commaIndex = args.indexOf(",");
  if (commaIndex < 0) return value;
  var from = args.substring(0, commaIndex);
  var to = args.substring(commaIndex + 1);
  return value.split(from).join(to);
}

// ---------------------------------------------------------------------------
// time transformer: {field|time:HH時mm分ss秒}
// ---------------------------------------------------------------------------

function nfbParseTimeString_(value) {
  var str = String(value).replace(/^\s+|\s+$/g, "");
  // Try datetime format first (2024-01-15 14:30:00 or 2024-01-15T14:30:00)
  var dtMatch = str.match(/[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dtMatch) {
    return { hour: Number(dtMatch[1]), minute: Number(dtMatch[2]), second: dtMatch[3] ? Number(dtMatch[3]) : 0 };
  }
  // Bare time format (14:30 or 14:30:00)
  var tMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (tMatch) {
    return { hour: Number(tMatch[1]), minute: Number(tMatch[2]), second: tMatch[3] ? Number(tMatch[3]) : 0 };
  }
  return null;
}

function nfbTransformTime_(value, formatStr) {
  var timeParts = nfbParseTimeString_(value);
  if (!timeParts) return value;

  var result = formatStr;
  result = result.split("HH").join(("0" + timeParts.hour).slice(-2));
  result = result.split("mm").join(("0" + timeParts.minute).slice(-2));
  result = result.split("ss").join(("0" + timeParts.second).slice(-2));
  result = result.split("H").join(String(timeParts.hour));
  result = result.split("m").join(String(timeParts.minute));
  result = result.split("s").join(String(timeParts.second));

  return result;
}

// ---------------------------------------------------------------------------
// match transformer: {field|match:PATTERN,GROUP}
// ---------------------------------------------------------------------------

function nfbTransformMatch_(value, args) {
  var lastComma = args.lastIndexOf(",");
  var pattern, groupIndex;
  if (lastComma >= 0) {
    var possibleGroup = args.substring(lastComma + 1).replace(/^\s+|\s+$/g, "");
    if (/^\d+$/.test(possibleGroup)) {
      pattern = args.substring(0, lastComma);
      groupIndex = parseInt(possibleGroup, 10);
    } else {
      pattern = args;
      groupIndex = 0;
    }
  } else {
    pattern = args;
    groupIndex = 0;
  }
  try {
    var re = new RegExp(pattern);
    var m = value.match(re);
    return m && m[groupIndex] !== undefined ? m[groupIndex] : "";
  } catch (e) {
    return value;
  }
}

// ---------------------------------------------------------------------------
// number transformer: {field|number:#,##0.00}
// ---------------------------------------------------------------------------

function nfbTransformNumber_(value, formatStr) {
  var num = parseFloat(String(value).replace(/^\s+|\s+$/g, ""));
  if (isNaN(num)) return value;

  var isNeg = num < 0;
  num = Math.abs(num);

  // Parse format: find prefix, numeric part, suffix
  var fmtMatch = formatStr.match(/^([^#0,.]*)([#0,.]+)(.*)$/);
  if (!fmtMatch) return value;
  var prefix = fmtMatch[1];
  var numFmt = fmtMatch[2];
  var suffix = fmtMatch[3];

  // Determine decimal places from format
  var dotIndex = numFmt.indexOf(".");
  var decimalPlaces = 0;
  var useThousands = numFmt.indexOf(",") >= 0;
  if (dotIndex >= 0) {
    decimalPlaces = numFmt.length - dotIndex - 1;
  }

  // Format the number
  var fixed = num.toFixed(decimalPlaces);
  var intPart, decPart;
  if (decimalPlaces > 0) {
    var parts = fixed.split(".");
    intPart = parts[0];
    decPart = parts[1];
  } else {
    intPart = fixed.split(".")[0];
    decPart = "";
  }

  // Add thousands separator
  if (useThousands) {
    var formatted = "";
    for (var i = intPart.length - 1, count = 0; i >= 0; i--, count++) {
      if (count > 0 && count % 3 === 0) formatted = "," + formatted;
      formatted = intPart.charAt(i) + formatted;
    }
    intPart = formatted;
  }

  var result = (isNeg ? "-" : "") + prefix + intPart;
  if (decimalPlaces > 0) result += "." + decPart;
  result += suffix;

  return result;
}

// ---------------------------------------------------------------------------
// if transformer: {field|if:VAL,THEN,ELSE}
// ---------------------------------------------------------------------------

function nfbTransformIf_(value, args) {
  var firstComma = args.indexOf(",");
  if (firstComma < 0) return value;
  var testVal = args.substring(0, firstComma);
  var rest = args.substring(firstComma + 1);
  var secondComma = rest.indexOf(",");
  var thenVal, elseVal;
  if (secondComma >= 0) {
    thenVal = rest.substring(0, secondComma);
    elseVal = rest.substring(secondComma + 1);
  } else {
    thenVal = rest;
    elseVal = "";
  }
  // Empty testVal = test for non-empty value
  if (testVal === "") {
    return value ? thenVal : elseVal;
  }
  return value === testVal ? thenVal : elseVal;
}

// ---------------------------------------------------------------------------
// map transformer: {field|map:A=X;B=Y;*=Z}
// ---------------------------------------------------------------------------

function nfbTransformMap_(value, args) {
  var entries = args.split(";");
  var fallback = value;
  for (var i = 0; i < entries.length; i++) {
    var eqIndex = entries[i].indexOf("=");
    if (eqIndex < 0) continue;
    var key = entries[i].substring(0, eqIndex);
    var val = entries[i].substring(eqIndex + 1);
    if (key === "*") { fallback = val; continue; }
    if (value === key) return val;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// kana/zen/han transformers
// ---------------------------------------------------------------------------

function nfbTransformKana_(value) {
  var result = "";
  for (var i = 0; i < value.length; i++) {
    var code = value.charCodeAt(i);
    // Hiragana U+3041-U+3096 → Katakana U+30A1-U+30F6
    if (code >= 0x3041 && code <= 0x3096) {
      result += String.fromCharCode(code + 0x60);
    } else {
      result += value.charAt(i);
    }
  }
  return result;
}

var NFB_HALFWIDTH_KANA_MAP_ = {
  "\uFF66": "\u30F2", "\uFF67": "\u30A1", "\uFF68": "\u30A3", "\uFF69": "\u30A5",
  "\uFF6A": "\u30A7", "\uFF6B": "\u30A9", "\uFF6C": "\u30E3", "\uFF6D": "\u30E5",
  "\uFF6E": "\u30E7", "\uFF6F": "\u30C3", "\uFF70": "\u30FC",
  "\uFF71": "\u30A2", "\uFF72": "\u30A4", "\uFF73": "\u30A6", "\uFF74": "\u30A8",
  "\uFF75": "\u30AA", "\uFF76": "\u30AB", "\uFF77": "\u30AD", "\uFF78": "\u30AF",
  "\uFF79": "\u30B1", "\uFF7A": "\u30B3", "\uFF7B": "\u30B5", "\uFF7C": "\u30B7",
  "\uFF7D": "\u30B9", "\uFF7E": "\u30BB", "\uFF7F": "\u30BD", "\uFF80": "\u30BF",
  "\uFF81": "\u30C1", "\uFF82": "\u30C4", "\uFF83": "\u30C6", "\uFF84": "\u30C8",
  "\uFF85": "\u30CA", "\uFF86": "\u30CB", "\uFF87": "\u30CC", "\uFF88": "\u30CD",
  "\uFF89": "\u30CE", "\uFF8A": "\u30CF", "\uFF8B": "\u30D2", "\uFF8C": "\u30D5",
  "\uFF8D": "\u30D8", "\uFF8E": "\u30DB", "\uFF8F": "\u30DE", "\uFF90": "\u30DF",
  "\uFF91": "\u30E0", "\uFF92": "\u30E1", "\uFF93": "\u30E2", "\uFF94": "\u30E4",
  "\uFF95": "\u30E6", "\uFF96": "\u30E8", "\uFF97": "\u30E9", "\uFF98": "\u30EA",
  "\uFF99": "\u30EB", "\uFF9A": "\u30EC", "\uFF9B": "\u30ED", "\uFF9C": "\u30EF",
  "\uFF9D": "\u30F3"
};

// Dakuten map: base char → dakuten form
var NFB_DAKUTEN_MAP_ = {
  "\u30AB": "\u30AC", "\u30AD": "\u30AE", "\u30AF": "\u30B0", "\u30B1": "\u30B2", "\u30B3": "\u30B4",
  "\u30B5": "\u30B6", "\u30B7": "\u30B8", "\u30B9": "\u30BA", "\u30BB": "\u30BC", "\u30BD": "\u30BE",
  "\u30BF": "\u30C0", "\u30C1": "\u30C2", "\u30C4": "\u30C5", "\u30C6": "\u30C7", "\u30C8": "\u30C9",
  "\u30CF": "\u30D0", "\u30D2": "\u30D3", "\u30D5": "\u30D6", "\u30D8": "\u30D9", "\u30DB": "\u30DC",
  "\u30A6": "\u30F4"
};

// Handakuten map: base char → handakuten form
var NFB_HANDAKUTEN_MAP_ = {
  "\u30CF": "\u30D1", "\u30D2": "\u30D4", "\u30D5": "\u30D7", "\u30D8": "\u30DA", "\u30DB": "\u30DD"
};

function nfbTransformZen_(value) {
  var result = "";
  for (var i = 0; i < value.length; i++) {
    var ch = value.charAt(i);
    var code = value.charCodeAt(i);

    // ASCII half-width (0x21-0x7E) → full-width (0xFF01-0xFF5E)
    if (code >= 0x21 && code <= 0x7E) {
      result += String.fromCharCode(code + 0xFEE0);
      continue;
    }
    // Space → full-width space
    if (code === 0x20) {
      result += "\u3000";
      continue;
    }

    // Half-width katakana → full-width katakana
    var mapped = NFB_HALFWIDTH_KANA_MAP_[ch];
    if (mapped) {
      // Check for dakuten/handakuten combining mark
      var next = i + 1 < value.length ? value.charAt(i + 1) : "";
      if (next === "\uFF9E" && NFB_DAKUTEN_MAP_[mapped]) {
        result += NFB_DAKUTEN_MAP_[mapped];
        i++;
      } else if (next === "\uFF9F" && NFB_HANDAKUTEN_MAP_[mapped]) {
        result += NFB_HANDAKUTEN_MAP_[mapped];
        i++;
      } else {
        result += mapped;
      }
      continue;
    }

    result += ch;
  }
  return result;
}

// Build reverse map for han (full-width → half-width)
var NFB_FULLWIDTH_KANA_TO_HALF_ = {};
var NFB_DAKUTEN_TO_HALF_ = {};
var NFB_HANDAKUTEN_TO_HALF_ = {};

(function() {
  var k;
  for (k in NFB_HALFWIDTH_KANA_MAP_) {
    if (Object.prototype.hasOwnProperty.call(NFB_HALFWIDTH_KANA_MAP_, k)) {
      NFB_FULLWIDTH_KANA_TO_HALF_[NFB_HALFWIDTH_KANA_MAP_[k]] = k;
    }
  }
  for (k in NFB_DAKUTEN_MAP_) {
    if (Object.prototype.hasOwnProperty.call(NFB_DAKUTEN_MAP_, k)) {
      // Find the half-width base for the undakuten form
      var halfBase = NFB_FULLWIDTH_KANA_TO_HALF_[k];
      if (halfBase) {
        NFB_DAKUTEN_TO_HALF_[NFB_DAKUTEN_MAP_[k]] = halfBase + "\uFF9E";
      }
    }
  }
  for (k in NFB_HANDAKUTEN_MAP_) {
    if (Object.prototype.hasOwnProperty.call(NFB_HANDAKUTEN_MAP_, k)) {
      var halfBase2 = NFB_FULLWIDTH_KANA_TO_HALF_[k];
      if (halfBase2) {
        NFB_HANDAKUTEN_TO_HALF_[NFB_HANDAKUTEN_MAP_[k]] = halfBase2 + "\uFF9F";
      }
    }
  }
})();

function nfbTransformHan_(value) {
  var result = "";
  for (var i = 0; i < value.length; i++) {
    var ch = value.charAt(i);
    var code = value.charCodeAt(i);

    // Full-width ASCII (0xFF01-0xFF5E) → half-width (0x21-0x7E)
    if (code >= 0xFF01 && code <= 0xFF5E) {
      result += String.fromCharCode(code - 0xFEE0);
      continue;
    }
    // Full-width space → half-width space
    if (code === 0x3000) {
      result += " ";
      continue;
    }

    // Dakuten/handakuten katakana → half-width + combining mark
    if (NFB_DAKUTEN_TO_HALF_[ch]) {
      result += NFB_DAKUTEN_TO_HALF_[ch];
      continue;
    }
    if (NFB_HANDAKUTEN_TO_HALF_[ch]) {
      result += NFB_HANDAKUTEN_TO_HALF_[ch];
      continue;
    }
    // Plain full-width katakana → half-width katakana
    if (NFB_FULLWIDTH_KANA_TO_HALF_[ch]) {
      result += NFB_FULLWIDTH_KANA_TO_HALF_[ch];
      continue;
    }

    result += ch;
  }
  return result;
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

function nfbResolveFolderFromInputIfExists_(input) {
  var normalizedInput = input === undefined || input === null ? "" : String(input).trim();
  if (!normalizedInput) {
    return null;
  }

  var parsed = Forms_parseGoogleDriveUrl_(normalizedInput);
  if (parsed.type !== "folder" || !parsed.id) {
    return null;
  }

  try {
    var folder = DriveApp.getFolderById(parsed.id);
    if (folder && typeof folder.isTrashed === "function" && folder.isTrashed()) {
      return null;
    }
    return folder;
  } catch (error) {
    return null;
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

function nfbApplyFolderNameTemplateIfNeeded_(folder, driveSettings, context) {
  if (!folder || !nfbIsRecordTempFolder_(folder)) {
    return folder;
  }

  var folderTemplate = driveSettings && driveSettings.folderNameTemplate ? String(driveSettings.folderNameTemplate).trim() : "";
  if (!folderTemplate) {
    return folder;
  }

  var resolvedName = nfbResolveTemplate_(folderTemplate, nfbBuildDriveTemplateContext_(driveSettings, context));
  if (!resolvedName) {
    return folder;
  }

  var currentName = typeof folder.getName === "function" ? String(folder.getName() || "") : "";
  if (currentName !== resolvedName && typeof folder.setName === "function") {
    folder.setName(resolvedName);
  }
  return folder;
}

function nfbResolveUploadFolder_(driveSettings) {
  var context = nfbBuildDriveTemplateContext_(driveSettings);
  var directFolderUrl = driveSettings && driveSettings.folderUrl ? String(driveSettings.folderUrl).trim() : "";
  if (directFolderUrl) {
    var directFolder = nfbResolveFolderFromInput_(directFolderUrl);
    nfbApplyFolderNameTemplateIfNeeded_(directFolder, driveSettings, context);
    return {
      folder: directFolder,
      autoCreated: false
    };
  }

  var rootFolder = nfbResolveRootFolder_(driveSettings);
  var createdFolder = rootFolder.createFolder(nfbBuildRecordTempFolderName_(driveSettings));
  nfbApplyFolderNameTemplateIfNeeded_(createdFolder, driveSettings, context);
  return {
    folder: createdFolder,
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
    var folderUrlToTrash = payload && payload.folderUrlToTrash ? String(payload.folderUrlToTrash).trim() : "";
    var currentFolder = currentDriveFolderUrl ? nfbResolveFolderFromInputIfExists_(currentDriveFolderUrl) : null;
    var inputFolder = inputDriveFolderUrl ? nfbResolveFolderFromInput_(inputDriveFolderUrl) : null;
    var targetFolder = inputFolder || currentFolder;

    nfbTrashFilesByIds_(payload && payload.trashFileIds);
    if (folderUrlToTrash) {
      var folderToTrash = nfbResolveFolderFromInputIfExists_(folderUrlToTrash);
      if (folderToTrash && typeof folderToTrash.setTrashed === "function") {
        folderToTrash.setTrashed(true);
      }
    }

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

function nfbEscapeJavaRegex_(str) {
  return String(str).replace(/([\\^$.|?*+()\[\]{}])/g, "\\$1");
}

function nfbApplyTemplateReplacementsToGoogleDocument_(doc, context, options) {
  if (!doc) return;

  var sections = [];
  try { var body = doc.getBody(); if (body) sections.push(body); } catch(e) {}
  try { var header = doc.getHeader(); if (header) sections.push(header); } catch(e) {}
  try { var footer = doc.getFooter(); if (footer) sections.push(footer); } catch(e) {}
  if (!sections.length) return;

  // ドキュメント全テキストから {TOKEN} を収集して解決値を求める
  var tokenValueMap = {};
  for (var s = 0; s < sections.length; s++) {
    var sectionText = "";
    try { sectionText = sections[s].getText(); } catch(e) { continue; }
    if (!sectionText) continue;
    var tokenRegex = /\{([^{}]+)\}/g;
    var match;
    while ((match = tokenRegex.exec(sectionText)) !== null) {
      var rawTokenName = match[1] || "";
      if (!rawTokenName) continue;
      var fullToken = match[0];
      if (Object.prototype.hasOwnProperty.call(tokenValueMap, fullToken)) continue;
      var forceField = rawTokenName.charAt(0) === "\\";
      var tokenName = forceField ? rawTokenName.slice(1) : rawTokenName;

      var pipeIdx = tokenName.indexOf("|");
      var value;
      if (pipeIdx >= 0) {
        var fPart = tokenName.substring(0, pipeIdx);
        var tPart = tokenName.substring(pipeIdx + 1);
        var raw = nfbResolveTemplateTokenValue_(fPart, context, {
          allowGmailOnlyTokens: !!(options && options.allowGmailOnlyTokens),
          forceFieldReference: forceField
        });
        value = nfbApplyPipeTransformers_(raw, tPart);
      } else {
        value = nfbResolveTemplateTokenValue_(tokenName, context, {
          allowGmailOnlyTokens: !!(options && options.allowGmailOnlyTokens),
          forceFieldReference: forceField
        });
      }
      tokenValueMap[fullToken] = String(value === null || value === undefined ? "" : value);
    }
  }

  // replaceText でトークンを置換（画像・罫線・書式を保持）
  for (var s2 = 0; s2 < sections.length; s2++) {
    for (var token in tokenValueMap) {
      if (!Object.prototype.hasOwnProperty.call(tokenValueMap, token)) continue;
      try {
        sections[s2].replaceText(
          nfbEscapeJavaRegex_(token),
          nfbEscapeReplaceTextReplacement_(tokenValueMap[token])
        );
      } catch(e) {}
    }
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
      nfbApplyTemplateReplacementsToGoogleDocument_(doc, ctx);
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
    var outputType = payload.outputType === "pdf" ? "pdf" : (payload.outputType === "gmail" ? "gmail" : "googleDoc");
    if (outputType === "pdf" && finalName && !/\.pdf$/i.test(finalName)) {
      finalName += ".pdf";
    }
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

/**
 * driveOutput.gs
 * レコード出力オーケストレーション（PDF/Gmail/GoogleDoc生成）
 */

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

    // fileNameTemplate + templateContext がある場合（driveSettings無し）、ファイル名テンプレートを解決
    if (payload && payload.fileNameTemplate && !payload.driveSettings) {
      var tc = payload.templateContext || {};
      var fnCtx = {
        responses: tc.responses || {},
        fieldLabels: tc.fieldLabels || {},
        fieldValues: tc.fieldValues || {},
        fileUploadMeta: tc.fileUploadMeta || {},
        recordId: tc.recordId || normalizedPayload.records[0].recordId || "",
        formId: tc.formId || "",
        recordNo: tc.recordNo || "",
        formTitle: tc.formTitle || "",
        now: new Date()
      };
      var resolvedName = nfbResolveTemplate_(String(payload.fileNameTemplate), fnCtx);
      if (resolvedName) {
        file.setName(resolvedName);
      }
    }

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

  var ctx = nfbBuildDriveTemplateContext_(driveSettings);
  ctx.formId = recordContext.formId || ctx.formId || "";
  ctx.recordId = recordContext.recordId || ctx.recordId || "";
  ctx.folderUrl = folderUrl || ctx.folderUrl || "";
  ctx.recordNo = recordContext.recordNo || "";
  ctx.formTitle = recordContext.formTitle || "";

  var webAppUrl = ScriptApp.getService().getUrl() || "";
  ctx.formUrl = webAppUrl && ctx.formId
    ? webAppUrl + "?form=" + encodeURIComponent(ctx.formId)
    : "";
  ctx.recordUrl = webAppUrl && ctx.formId && ctx.recordId
    ? webAppUrl + "?form=" + encodeURIComponent(ctx.formId) + "&record=" + encodeURIComponent(ctx.recordId)
    : "";

  return ctx;
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
  return configuredTemplate || "{@_id}_{@_NOW|time:YYYY-MM-DD}";
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

function nfbResolveGmailTemplateFields_(action, outputContext) {
  action = action || {};
  return {
    to: nfbResolveTemplate_(String(action.gmailTemplateTo || ""), outputContext),
    cc: nfbResolveTemplate_(String(action.gmailTemplateCc || ""), outputContext),
    bcc: nfbResolveTemplate_(String(action.gmailTemplateBcc || ""), outputContext),
    subject: nfbResolveTemplate_(String(action.gmailTemplateSubject || ""), outputContext),
    body: nfbResolveTemplate_(String(action.gmailTemplateBody || ""), outputContext, { allowGmailOnlyTokens: true })
  };
}

function nfbCreateTempPdfBlob_(payload, action, outputContext, finalBaseName) {
  var documentAction = nfbCloneRecordOutputActionForGeneratedFile_(action);
  var tmpName = finalBaseName + "__tmp_" + Utilities.getUuid();
  var docFile = nfbCreateRecordOutputGoogleDocumentInRoot_(payload, documentAction, outputContext, tmpName);
  var pdfName = /\.pdf$/i.test(finalBaseName) ? finalBaseName : finalBaseName + ".pdf";
  var pdfBlob = docFile.getBlob().getAs(MimeType.PDF).setName(pdfName);
  docFile.setTrashed(true);
  return pdfBlob;
}

function nfbCreateGmailDraftOutput_(payload, action, outputContext, finalBaseName) {
  var emailFields = nfbResolveGmailTemplateFields_(action, outputContext);
  var attachments = [];

  if (action && action.gmailAttachPdf) {
    attachments.push(nfbCreateTempPdfBlob_(payload, action, outputContext, finalBaseName));
  }

  var draftOptions = {};
  if (emailFields.cc) draftOptions.cc = emailFields.cc;
  if (emailFields.bcc) draftOptions.bcc = emailFields.bcc;
  if (attachments.length > 0) draftOptions.attachments = attachments;

  var draft = GmailApp.createDraft(emailFields.to, emailFields.subject, emailFields.body, draftOptions);

  return {
    ok: true,
    outputType: "gmail",
    draftId: draft.getId(),
    openUrl: "https://mail.google.com/mail/#drafts"
  };
}

function nfbCreatePdfDownloadOutput_(payload, action, outputContext, finalBaseName) {
  var pdfBlob = nfbCreateTempPdfBlob_(payload, action, outputContext, finalBaseName);
  var base64 = Utilities.base64Encode(pdfBlob.getBytes());
  return {
    ok: true,
    outputType: "pdf",
    pdfBase64: base64,
    fileName: pdfBlob.getName()
  };
}

function nfbCreateGoogleDocInRootOutput_(payload, action, outputContext, finalBaseName) {
  var driveSettings = payload && payload.driveSettings ? payload.driveSettings : {};
  var folder = nfbResolveRootFolder_(driveSettings);
  var docFile = nfbCreateRecordOutputGoogleDocument_(payload, action, folder, outputContext, finalBaseName);
  return {
    ok: true,
    outputType: "googleDoc",
    openUrl: docFile.getUrl(),
    fileName: docFile.getName()
  };
}

function nfbCreateRecordOutputGoogleDocumentInRoot_(payload, action, outputContext, finalBaseName) {
  return nfbCreateRecordOutputGoogleDocument_(payload, action, DriveApp.getRootFolder(), outputContext, finalBaseName);
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

function nfbCloneRecordOutputActionForGeneratedFile_(action) {
  var cloned = Object.assign({}, action || {});
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
  var file = nfbCreateGoogleDocumentFileInRoot_(printPayload, finalBaseName);
  nfbTrashExistingFile_(folder, finalBaseName);
  file.moveTo(folder);
  return file;
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
      var isRef = rawTokenName.charAt(0) === "@";
      var tokenName = isRef ? rawTokenName.slice(1) : rawTokenName;

      var pipeIdx = tokenName.indexOf("|");
      var value;
      if (pipeIdx >= 0) {
        var fPart = tokenName.substring(0, pipeIdx);
        var tPart = tokenName.substring(pipeIdx + 1);
        var raw = nfbResolveTemplateTokenValue_(fPart, context, {
          allowGmailOnlyTokens: !!(options && options.allowGmailOnlyTokens),
          isRef: isRef
        });
        value = nfbApplyPipeTransformers_(raw, tPart, context);
      } else {
        value = nfbResolveTemplateTokenValue_(tokenName, context, {
          allowGmailOnlyTokens: !!(options && options.allowGmailOnlyTokens),
          isRef: isRef
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

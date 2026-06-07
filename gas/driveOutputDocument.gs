/**
 * driveOutputDocument.gs
 * 出力ドキュメント（Google Doc / PDF）の生成プリミティブとテンプレート差し込み。
 * オーケストレーション（出力種別の振り分け・コンテキスト合成）は driveOutput.gs を参照。
 * バンドル時に連結されるため関数はグローバル。
 */

/**
 * 一時ファイル名を組み立てる（`<baseName>__tmp_<uuid>`）。
 */
function nfbBuildTmpName_(baseName) {
  return baseName + "__tmp_" + Utilities.getUuid();
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

function nfbCreateTempPdfBlob_(payload, action, outputContext, finalBaseName) {
  var tmpName = nfbBuildTmpName_(finalBaseName);
  var docFile = nfbCreateRecordOutputGoogleDocumentInRoot_(payload, action, outputContext, tmpName);
  var pdfName = /\.pdf$/i.test(finalBaseName) ? finalBaseName : finalBaseName + ".pdf";
  var pdfBlob = docFile.getBlob().getAs(MimeType.PDF).setName(pdfName);
  docFile.setTrashed(true);
  return pdfBlob;
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

// Google ドキュメント出力: テンプレ（または自動生成）の Doc をマイドライブ直下に作成し、
// そのファイルを開くリンクを返す。PDF 化やゴミ箱移動はしない。
// 印刷様式はレコードの Drive フォルダには保存しないため、driveSettings のフォルダ情報は使わない。
function nfbCreateGoogleDocOutput_(payload, action, outputContext, finalBaseName) {
  var docFile = nfbCreateRecordOutputGoogleDocumentInRoot_(payload, action, outputContext, finalBaseName);
  return {
    ok: true,
    outputType: "googleDoc",
    openUrl: docFile.getUrl(),
    fileUrl: docFile.getUrl(),
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

  var sourceFile = nfbGetDriveFileById_(parsed.id, "ソースファイルへのアクセスに失敗しました: ");

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
  // ネストした {...}（サブテンプレート）を含むトークンも拾うため balanced scanner を使う
  var tokenValueMap = {};
  var row = nfbBuildTemplateRow_(context, {
    allowGmailOnlyTokens: !!(options && options.allowGmailOnlyTokens)
  });
  for (var s = 0; s < sections.length; s++) {
    var sectionText = "";
    try { sectionText = sections[s].getText(); } catch(e) { continue; }
    if (!sectionText) continue;
    var collected = nfbEvaluateTemplateCollect_(sectionText);
    for (var t = 0; t < collected.length; t++) {
      var tok = collected[t];
      var fullToken = tok.fullToken;
      if (Object.prototype.hasOwnProperty.call(tokenValueMap, fullToken)) continue;
      if (!tok.body) continue;
      // トークン単体を再評価（fullToken 全体を評価器に渡す）
      var resolvedString;
      try {
        resolvedString = nfbEvaluateTemplate_(fullToken, row, { logError: nfbLogTemplateError_ });
      } catch (e) {
        nfbLogTemplateError_(e, fullToken);
        resolvedString = fullToken;
      }
      tokenValueMap[fullToken] = String(resolvedString === null || resolvedString === undefined ? "" : resolvedString);
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

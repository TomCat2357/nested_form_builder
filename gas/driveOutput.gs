/**
 * driveOutput.gs
 * レコード出力オーケストレーション（出力種別の振り分け・テンプレートコンテキスト合成）。
 * Google Doc / PDF の生成プリミティブは driveOutputDocument.gs、
 * Gmail下書き出力は driveGmailOutput.gs を参照。
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
      var templateFolderResult = nfbResolveOutputFolder_(
        templateDriveSettings,
        nfbBuildDriveTemplateContext_(templateDriveSettings)
      );
      var templateFolder = templateFolderResult.folder;
      var templateContext = nfbNormalizeRecordTemplateContext_({
        driveSettings: templateDriveSettings,
        templateContext: payload.templateContext,
        recordContext: {
          formId: payload.formId || "",
          formTitle: payload.formTitle || "",
          recordId: payload.recordId || "",
          recordNo: payload.recordNo || "",
          modifiedAt: payload.modifiedAt || ""
        },
        includeWebAppUrls: true
      });
      var templateBaseName = normalizedPayload.fileName;
      var tplFileNameTemplate = templateDriveSettings.fileNameTemplate
        ? String(templateDriveSettings.fileNameTemplate).trim()
        : (Nfb_trimStr_(payload.fileNameTemplate));
      if (tplFileNameTemplate) {
        var resolvedBaseName = nfbResolveTemplateTokens_(tplFileNameTemplate, templateContext);
        if (resolvedBaseName) {
          templateBaseName = resolvedBaseName;
        }
      }
      var templatedFile = nfbCreateGoogleDocumentFileFromTemplate_(
        String(payload.templateSourceUrl),
        templateFolder,
        templateBaseName,
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
      var fnCtx = nfbNormalizeRecordTemplateContext_({
        templateContext: payload.templateContext,
        fallbackRecordId: normalizedPayload.records[0].recordId
      });
      var resolvedName = nfbResolveTemplateTokens_(String(payload.fileNameTemplate), fnCtx);
      if (resolvedName) {
        file.setName(resolvedName);
      }
    }

    // driveSettings がある場合はフォルダに移動・ファイル名テンプレート適用
    if (payload && payload.driveSettings) {
      var ds = payload.driveSettings;
      var ctx = nfbNormalizeRecordTemplateContext_({
        driveSettings: ds,
        fallbackRecordId: normalizedPayload.records[0].recordId
      });

      // ファイル名テンプレートの解決
      var fileNameTemplate = Nfb_trimStr_(ds.fileNameTemplate);
      if (fileNameTemplate) {
        var resolvedFileName = nfbResolveTemplateTokens_(fileNameTemplate, ctx);
        if (resolvedFileName) {
          file.setName(resolvedFileName);
        }
      }

      var folderResult = nfbResolveOutputFolder_(ds, ctx);
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
    var outputType = action.outputType === "gmail" ? "gmail"
      : (action.outputType === "googleDoc" ? "googleDoc" : "pdf");
    var fileNameTemplate = nfbResolveRecordOutputFileNameTemplate_(payload, action, outputType);
    if (nfbRequiresRecordOutputFileNameTemplate_(action, outputType) && !fileNameTemplate) {
      throw new Error("出力ファイル名が指定されていません");
    }

    var outputContext = nfbBuildRecordOutputContext_(payload);
    var finalBaseName = fileNameTemplate
      ? (nfbResolveTemplateTokens_(fileNameTemplate, outputContext) || ("record_" + outputContext.recordId))
      : "";

    if (outputType === "gmail") {
      return nfbCreateGmailDraftOutput_(payload, action, outputContext, finalBaseName);
    }

    if (outputType === "googleDoc") {
      return nfbCreateGoogleDocOutput_(payload, action, outputContext, finalBaseName);
    }

    return nfbCreatePdfDownloadOutput_(payload, action, outputContext, finalBaseName);
  });
}

function nfbExecuteBatchGoogleDocOutput(payload) {
  return nfbSafeCall_(function() {
    var records = payload && payload.records;
    if (!records || !records.length) throw new Error("レコードが選択されていません");

    var fileName = payload.fileNameTemplate || "一括出力";
    var tmpBase = nfbBuildTmpName_(fileName);
    var firstDriveSettings = records[0] && records[0].driveSettings ? records[0].driveSettings : {};
    var rootFolder = nfbResolveRootFolder_(firstDriveSettings);

    // 1件目のレコードでベースDocを作成
    var firstPayload = records[0];
    var firstAction = firstPayload.action || {};
    var firstContext = nfbBuildRecordOutputContext_(firstPayload);
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
        var recContext = nfbBuildRecordOutputContext_(recPayload);
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
      openUrl: combinedFile.getUrl(),
      fileName: combinedFile.getName()
    };
  });
}
function nfbBuildRecordOutputContext_(payload) {
  return nfbNormalizeRecordTemplateContext_({
    driveSettings: payload && payload.driveSettings,
    recordContext: payload && payload.recordContext,
    includeWebAppUrls: true
  });
}

/**
 * payload の各ソース（driveSettings / templateContext / recordContext）から
 * テンプレート解決用コンテキストを統一フォーマットで合成する。
 *
 * sources = {
 *   driveSettings,         // optional - データフィールドの主ソース
 *   templateContext,       // optional - データフィールドのフォールバックソース
 *   recordContext,         // optional - 識別子フィールドの最優先ソース
 *   fallbackRecordId,      // optional - recordId が他全ソースで空の場合の最終フォールバック
 *   includeWebAppUrls      // bool    - true で recordUrl/formUrl を ScriptApp から算出
 * }
 *
 * 優先順位:
 *  - データ系 (responses/fieldPaths/fieldValues/fileUploadMeta):
 *      fieldPaths を持つ方を採用。両方持つなら driveSettings 優先。
 *  - 識別子系 (recordId/formId/recordNo/formTitle):
 *      recordContext > templateContext > driveSettings の順で最初の非空を採用。
 */
function nfbNormalizeRecordTemplateContext_(sources) {
  sources = sources || {};
  var driveSettings = sources.driveSettings || null;
  var templateContext = sources.templateContext || null;
  var recordContext = sources.recordContext || null;
  var fallbackRecordId = sources.fallbackRecordId || "";
  var includeWebAppUrls = sources.includeWebAppUrls === true;

  function hasFieldPaths(src) {
    return !!(src && src.fieldPaths && Object.keys(src.fieldPaths).length);
  }
  var dataSrc;
  if (hasFieldPaths(driveSettings)) {
    dataSrc = driveSettings;
  } else if (hasFieldPaths(templateContext)) {
    dataSrc = templateContext;
  } else {
    dataSrc = driveSettings || templateContext || {};
  }

  function pickStr(key) {
    var candidates = [recordContext, templateContext, driveSettings];
    for (var i = 0; i < candidates.length; i++) {
      var src = candidates[i];
      if (src && src[key]) return String(src[key]).trim();
    }
    return "";
  }

  var ctx = {
    responses: nfbPlainObject_(dataSrc && dataSrc.responses),
    fieldPaths: nfbPlainObject_(dataSrc && dataSrc.fieldPaths),
    fieldValues: nfbPlainObject_(dataSrc && dataSrc.fieldValues),
    dataValues: nfbPlainObject_(dataSrc && dataSrc.dataValues),
    fileUploadMeta: nfbPlainObject_(dataSrc && dataSrc.fileUploadMeta),
    childFormMeta: nfbPlainObject_(dataSrc && dataSrc.childFormMeta),
    recordId: pickStr("recordId") || fallbackRecordId,
    formId: pickStr("formId"),
    recordNo: pickStr("recordNo"),
    formTitle: pickStr("formTitle"),
    recordUrl: "",
    formUrl: "",
    now: new Date()
  };

  if (includeWebAppUrls) {
    var webAppUrl = ScriptApp.getService().getUrl() || "";
    ctx.formUrl = webAppUrl && ctx.formId
      ? webAppUrl + "?form=" + encodeURIComponent(ctx.formId)
      : "";
    ctx.recordUrl = webAppUrl && ctx.formId && ctx.recordId
      ? webAppUrl + "?form=" + encodeURIComponent(ctx.formId) + "&record=" + encodeURIComponent(ctx.recordId)
      : "";
  }

  return ctx;
}

function nfbResolveRecordOutputFileNameTemplate_(payload, action, outputType) {
  var settings = payload && payload.settings ? payload.settings : {};
  var actionTemplate = action ? Nfb_trimStr_(action.fileNameTemplate) : "";
  var sharedTemplate = settings ? Nfb_trimStr_(settings.standardPrintFileNameTemplate) : "";

  if (outputType === "gmail") {
    return (action && action.gmailAttachPdf)
      ? (sharedTemplate || nfbResolveStandardPrintFileNameTemplate_(settings))
      : "";
  }

  return actionTemplate || sharedTemplate || nfbResolveStandardPrintFileNameTemplate_(settings);
}

function nfbResolveStandardPrintFileNameTemplate_(settings) {
  var configuredTemplate = settings ? Nfb_trimStr_(settings.standardPrintFileNameTemplate) : "";
  return configuredTemplate || "{{`_id`}}_{{TIME_FORMAT(NOW(), 'YYYY-MM-DD')}}";
}

// gmail 以外（pdf / googleDoc）はファイル名テンプレートが必須。
function nfbRequiresRecordOutputFileNameTemplate_(action, outputType) {
  return outputType !== "gmail" || !!(action && action.gmailAttachPdf);
}

// カード側でカスタムテンプレートが有効かつ URL が指定されていればそれを使い、
// 未指定（または無効）ならフォーム共通の標準印刷出力様式にフォールバックする。
function nfbResolveRecordOutputTemplateSourceUrl_(payload, action) {
  if (action && action.useCustomTemplate) {
    var actionUrl = Nfb_trimStr_(action.templateUrl);
    if (actionUrl) return actionUrl;
  }
  return payload && payload.settings ? Nfb_trimStr_(payload.settings.standardPrintTemplateUrl) : "";
}

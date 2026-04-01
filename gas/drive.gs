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
    ["ID", payload.recordId ? payload.recordId : "-"]
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

// =========================================================================
// テンプレート解決・フォルダ操作・ファイルアップロード
// =========================================================================

/**
 * テンプレート文字列のプレースホルダーを解決する
 * @param {string} template - テンプレート文字列
 * @param {Object} context - { responses, fieldLabels, now }
 * @return {string}
 */
function nfbResolveTemplate_(template, context) {
  if (!template || typeof template !== "string") return "";

  var now = context && context.now ? context.now : new Date();
  var tz = Session.getScriptTimeZone();
  var responses = (context && context.responses) || {};
  var fieldLabels = (context && context.fieldLabels) || {};
  var recordId = context && context.recordId ? String(context.recordId).trim() : "";

  // 日時プレースホルダーのマッピング
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

  var result = template;

  // 日時プレースホルダーを先に解決（長いパターンから）
  var dateKeys = Object.keys(dateFormats).sort(function(a, b) { return b.length - a.length; });
  for (var i = 0; i < dateKeys.length; i++) {
    var key = dateKeys[i];
    var pattern = "{" + key + "}";
    if (result.indexOf(pattern) !== -1) {
      var formatted = Utilities.formatDate(now, tz, dateFormats[key]);
      result = result.split(pattern).join(formatted);
    }
  }

  if (result.indexOf("{ID}") !== -1) {
    result = result.split("{ID}").join(recordId);
  }

  // フィールドラベルプレースホルダーを解決
  // fieldLabels は { fieldId: "ラベル" } 形式
  // ラベル → fieldId の逆引きマップを作成
  var labelToId = {};
  for (var fid in fieldLabels) {
    if (!fieldLabels.hasOwnProperty(fid)) continue;
    var label = fieldLabels[fid];
    if (label && !labelToId.hasOwnProperty(label)) {
      labelToId[label] = fid;
    }
  }

  // {ラベル名} パターンを解決
  result = result.replace(/\{([^{}]+)\}/g, function(match, labelName) {
    var fieldId = labelToId[labelName];
    if (fieldId !== undefined) {
      var val = responses[fieldId];
      if (val === undefined || val === null) return "";
      if (Array.isArray(val)) return val.join(", ");
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    }
    return "";
  });

  return result;
}

/**
 * driveSettings からフォルダを解決または作成する
 * @param {Object} driveSettings - { rootFolderUrl, folderNameTemplate, responses, fieldLabels }
 * @param {Object} context - { responses, fieldLabels, now }（driveSettingsから構築可能）
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
    recordId: driveSettings && driveSettings.recordId ? String(driveSettings.recordId).trim() : "",
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
    nfbTrashExistingFile_(folder, originalName);

    var copiedFile = sourceFile.makeCopy(originalName, folder);

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

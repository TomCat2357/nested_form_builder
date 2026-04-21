/**
 * driveFile.gs
 * ファイルのアップロード・コピー・保存・検索（公開API）
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
 * base64エンコードされたデータをBlobに変換する
 * @param {string} base64 - base64エンコードされたデータ
 * @param {string} fileName - ファイル名
 * @param {string} [mimeType] - MIMEタイプ（省略時は application/octet-stream）
 * @return {Blob}
 */
function nfbDecodeBase64ToBlob_(base64, fileName, mimeType) {
  var bytes = Utilities.base64Decode(base64);
  var resolvedMimeType = mimeType || "application/octet-stream";
  return Utilities.newBlob(bytes, resolvedMimeType, String(fileName).trim());
}

/**
 * フロントエンドで生成したExcelファイルをGoogle Driveに保存する
 * nfbSaveFileToDrive に Excel 用 mimeType を設定して委譲
 * @param {Object} payload - { filename: string, base64: string }
 * @return {Object} { ok: true, fileUrl: string, fileName: string }
 */
function nfbSaveExcelToDrive(payload) {
  return nfbSaveFileToDrive({
    filename: payload && payload.filename,
    base64: payload && payload.base64,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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

    var blob = nfbDecodeBase64ToBlob_(payload.base64, payload.filename, payload.mimeType);
    var file = DriveApp.createFile(blob);

    return {
      ok: true,
      fileUrl: file.getUrl(),
      fileName: file.getName()
    };
  });
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

    var fileName = String(payload.fileName).trim();
    var blob = nfbDecodeBase64ToBlob_(payload.base64, fileName, payload.mimeType);

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
/**
 * ソースファイルを指定フォルダにコピーする共通処理
 * @param {Object} payload - { sourceUrl, driveSettings, fileNameTemplate }
 * @return {Object} { copiedFile, folder, autoCreated, ctx }
 */
function nfbCopyFileToDriveFolder_(payload) {
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

  var folderResult = nfbResolveUploadFolder_(payload.driveSettings);
  var folder = folderResult.folder;
  var ctx = nfbBuildDriveTemplateContext_(payload.driveSettings);
  var resolvedName = payload.fileNameTemplate
    ? nfbResolveTemplateTokens_(String(payload.fileNameTemplate), ctx)
    : "";
  var finalName = resolvedName || sourceFile.getName();
  nfbTrashExistingFile_(folder, finalName);

  var copiedFile = sourceFile.makeCopy(finalName, folder);

  return {
    copiedFile: copiedFile,
    folder: folder,
    autoCreated: folderResult.autoCreated === true,
    ctx: ctx
  };
}

function nfbCopyDriveFileToDrive(payload) {
  return nfbSafeCall_(function() {
    var result = nfbCopyFileToDriveFolder_(payload);
    return {
      ok: true,
      fileUrl: result.copiedFile.getUrl(),
      fileName: result.copiedFile.getName(),
      fileId: result.copiedFile.getId(),
      folderUrl: result.folder.getUrl(),
      autoCreated: result.autoCreated
    };
  });
}

function nfbCreateGoogleDocumentFromTemplate(payload) {
  return nfbSafeCall_(function() {
    if (!payload || !payload.driveSettings) {
      throw new Error("出力先設定が不足しています");
    }

    var result = nfbCopyFileToDriveFolder_(payload);
    var doc;
    try {
      doc = DocumentApp.openById(result.copiedFile.getId());
      nfbApplyTemplateReplacementsToGoogleDocument_(doc, result.ctx);
      doc.saveAndClose();
    } catch (error) {
      throw new Error("Google ドキュメントテンプレートの差し込みに失敗しました: " + nfbErrorToString_(error));
    }

    return {
      ok: true,
      fileUrl: result.copiedFile.getUrl(),
      fileName: result.copiedFile.getName(),
      fileId: result.copiedFile.getId(),
      folderUrl: result.folder.getUrl(),
      autoCreated: result.autoCreated
    };
  });
}

function nfbFindDriveFileInFolder(payload) {
  return nfbSafeCall_(function() {
    if (!payload || !payload.fileNameTemplate || !payload.driveSettings) {
      throw new Error("検索条件が不足しています");
    }
    var ctx = nfbBuildDriveTemplateContext_(payload.driveSettings);
    var finalName = nfbResolveTemplateTokens_(String(payload.fileNameTemplate), ctx);
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

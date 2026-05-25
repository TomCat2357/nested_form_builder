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

    var file = nfbGetDriveFileById_(fileId, "ファイルへのアクセスに失敗しました: ");

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
 * DriveApp.getFileById のラッパ。アクセス失敗時は errorPrefix を付けて日本語例外を投げる。
 * @param {string} fileId
 * @param {string} errorPrefix - 例: "ファイルへのアクセスに失敗しました: "
 * @return {File}
 */
function nfbGetDriveFileById_(fileId, errorPrefix) {
  try {
    return DriveApp.getFileById(fileId);
  } catch (accessError) {
    throw new Error(errorPrefix + nfbErrorToString_(accessError));
  }
}

/**
 * アップロードを検証する。デコード前に呼ぶことでメモリ枯渇を防ぐ。
 * - サイズ: base64 長から概算バイト数を算出し NFB_MAX_UPLOAD_BYTES 超過を拒否
 * - 拡張子: NFB_BLOCKED_UPLOAD_EXTENSIONS に含まれる実行可能形式を拒否
 * @param {string} base64
 * @param {string} fileName
 */
function nfbValidateUpload_(base64, fileName) {
  var b64 = String(base64 || "");
  var len = b64.length;
  var padding = 0;
  if (len >= 1 && b64.charAt(len - 1) === "=") padding++;
  if (len >= 2 && b64.charAt(len - 2) === "=") padding++;
  var approxBytes = Math.floor(len * 3 / 4) - padding;
  if (approxBytes > NFB_MAX_UPLOAD_BYTES) {
    throw new Error("ファイルサイズが上限(25MB)を超えています");
  }

  var name = String(fileName || "");
  var dotIndex = name.lastIndexOf(".");
  if (dotIndex >= 0 && dotIndex < name.length - 1) {
    var ext = name.slice(dotIndex + 1).toLowerCase().trim();
    if (NFB_BLOCKED_UPLOAD_EXTENSIONS.indexOf(ext) !== -1) {
      throw new Error("このファイル形式はアップロードできません: ." + ext);
    }
  }
}

/**
 * base64エンコードされたデータをBlobに変換する
 * @param {string} base64 - base64エンコードされたデータ
 * @param {string} fileName - ファイル名
 * @param {string} [mimeType] - MIMEタイプ（省略時は application/octet-stream）
 * @return {Blob}
 */
function nfbDecodeBase64ToBlob_(base64, fileName, mimeType) {
  nfbValidateUpload_(base64, fileName);
  var bytes = Utilities.base64Decode(base64);
  var resolvedMimeType = mimeType || "application/octet-stream";
  return Utilities.newBlob(bytes, resolvedMimeType, String(fileName).trim());
}

/**
 * Drive ファイル操作成功レスポンスを共通形状で組み立てる
 * @param {File} file - 対象ファイル
 * @param {Folder} folder - 保存先フォルダ
 * @param {boolean} autoCreated - フォルダが自動生成されたか
 * @return {Object} { ok, fileUrl, fileName, fileId, folderUrl, autoCreated }
 */
function nfbBuildDriveFileResponse_(file, folder, autoCreated) {
  return {
    ok: true,
    fileUrl: file.getUrl(),
    fileName: file.getName(),
    fileId: file.getId(),
    folderUrl: folder.getUrl(),
    autoCreated: autoCreated === true
  };
}

/**
 * Blob を Drive に保存する共通処理
 * driveSettings が null の場合はルート（ユーザーの My Drive）に保存する
 * @param {Blob} blob
 * @param {string} fileName
 * @param {Object|null} driveSettings - null の場合はフォルダ解決せず DriveApp.createFile を使う
 * @return {Object} { file, folder, autoCreated }
 */
function nfbPersistBlobToDrive_(blob, fileName, driveSettings) {
  if (!driveSettings) {
    return {
      file: DriveApp.createFile(blob),
      folder: null,
      autoCreated: false
    };
  }
  var folderResult = nfbResolveUploadFolder_(driveSettings);
  var folder = folderResult.folder;
  nfbTrashExistingFile_(folder, fileName);
  return {
    file: folder.createFile(blob),
    folder: folder,
    autoCreated: folderResult.autoCreated === true
  };
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
    if (!payload || !payload.base64) {
      throw new Error("ファイルデータが不足しています");
    }
    if (!payload.filename || !String(payload.filename).trim()) {
      throw new Error("ファイル名が指定されていません");
    }

    var fileName = String(payload.filename).trim();
    var blob = nfbDecodeBase64ToBlob_(payload.base64, fileName, payload.mimeType);
    var result = nfbPersistBlobToDrive_(blob, fileName, null);

    return {
      ok: true,
      fileUrl: result.file.getUrl(),
      fileName: result.file.getName()
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
    if (!payload || !payload.base64) {
      throw new Error("ファイルデータが不足しています");
    }
    if (!payload.fileName || !String(payload.fileName).trim()) {
      throw new Error("ファイル名が指定されていません");
    }

    var fileName = String(payload.fileName).trim();
    var blob = nfbDecodeBase64ToBlob_(payload.base64, fileName, payload.mimeType);
    var result = nfbPersistBlobToDrive_(blob, fileName, payload.driveSettings);

    return nfbBuildDriveFileResponse_(result.file, result.folder, result.autoCreated);
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

  var sourceFile = nfbGetDriveFileById_(parsed.id, "ソースファイルへのアクセスに失敗しました: ");

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
    return nfbBuildDriveFileResponse_(result.copiedFile, result.folder, result.autoCreated);
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

    return nfbBuildDriveFileResponse_(result.copiedFile, result.folder, result.autoCreated);
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

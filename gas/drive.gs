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
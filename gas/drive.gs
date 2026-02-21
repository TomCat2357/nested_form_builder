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
  try {
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
  } catch (error) {
    Logger.log('[nfbImportThemeFromDrive] Error: ' + nfbErrorToString_(error));
    throw new Error('テーマのインポートに失敗しました: ' + nfbErrorToString_(error));
  }
}

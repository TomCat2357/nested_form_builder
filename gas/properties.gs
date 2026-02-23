/**
 * properties.gs
 * プロパティ操作とフォームURL補助関数群
 */


/**
 * プロパティ保存モードを取得する（script/user）
 * @return {"script"|"user"}
 */
function Nfb_getPropertyStoreMode_() {
  var rawMode = String(NFB_PROPERTY_STORE_MODE || "").trim().toLowerCase();
  if (rawMode === NFB_PROPERTY_STORE_MODE_USER) {
    return NFB_PROPERTY_STORE_MODE_USER;
  }
  return NFB_PROPERTY_STORE_MODE_SCRIPT;
}

/**
 * 現在の保存モードに応じたPropertiesを取得
 * @return {GoogleAppsScript.Properties.Properties}
 */
function Nfb_getActiveProperties_() {
  if (Nfb_getPropertyStoreMode_() === NFB_PROPERTY_STORE_MODE_USER) {
    return PropertiesService.getUserProperties();
  }
  return PropertiesService.getScriptProperties();
}

/**
 * 管理者設定が有効か判定（scriptモード時のみ有効）
 * @return {boolean}
 */
function Nfb_isAdminSettingsEnabled_() {
  return Nfb_getPropertyStoreMode_() === NFB_PROPERTY_STORE_MODE_SCRIPT;
}

/**
 * URLからGoogle DriveファイルIDを抽出
 * Forms_parseGoogleDriveUrl_のラッパー関数（DRY原則に基づき統合）
 * @param {string} url - Google DriveファイルのURL
 * @return {string|null} ファイルID（抽出失敗時はnull）
 */
function ExtractFileIdFromUrl_(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  var parsed = Forms_parseGoogleDriveUrl_(url);
  // ファイルの場合のみIDを返す（フォルダの場合はnull）
  return (parsed.type === 'file') ? parsed.id : null;
}

/**
 * 全フォームのURLマップを取得
 * @return {Object} フォームURLマップ { formId: fileUrl, ... }
 */
function GetFormUrls_() {
  try {
    if (typeof Forms_getMapping_ !== 'function') {
      return {};
    }

    var mapping = Forms_getMapping_() || {};
    var urlMap = {};
    for (var formId in mapping) {
      if (!mapping.hasOwnProperty(formId)) continue;
      var entry = mapping[formId] || {};
      var fileUrl = entry.driveFileUrl || null;
      if (!fileUrl && entry.fileId) {
        if (typeof Forms_buildDriveFileUrlFromId_ === 'function') {
          fileUrl = Forms_buildDriveFileUrlFromId_(entry.fileId);
        } else {
          fileUrl = "https://drive.google.com/file/d/" + entry.fileId + "/view";
        }
      }
      if (fileUrl) {
        urlMap[formId] = fileUrl;
      }
    }

    return urlMap;
  } catch (error) {
    Logger.log('[GetFormUrls_] Error: ' + nfbErrorToString_(error));
    return {};
  }
}

/**
 * フォームURLマップを保存
 * @param {Object} urlMap - フォームURLマップ
 */
function SaveFormUrls_(urlMap) {
  try {
    if (typeof Forms_getMapping_ !== 'function' || typeof Forms_saveMapping_ !== 'function') {
      throw new Error('Forms mapping functions are unavailable');
    }

    var source = urlMap || {};
    var mapping = Forms_getMapping_() || {};

    for (var formId in source) {
      if (!source.hasOwnProperty(formId)) continue;
      var fileUrl = source[formId];
      if (!fileUrl) continue;

      var fileId = ExtractFileIdFromUrl_(fileUrl);
      var existing = mapping[formId] || {};
      mapping[formId] = {
        fileId: fileId || existing.fileId || null,
        driveFileUrl: fileUrl
      };
    }

    Forms_saveMapping_(mapping);
  } catch (error) {
    Logger.log('[SaveFormUrls_] Error: ' + nfbErrorToString_(error));
    throw new Error('フォームURLマップの保存に失敗しました: ' + nfbErrorToString_(error));
  }
}

/**
 * フォームURLを追加
 * @param {string} formId - フォームID
 * @param {string} fileUrl - Google DriveファイルURL
 * @return {Object} 成功メッセージ
 */
function AddFormUrl_(formId, fileUrl) {
  try {
    if (!formId || !fileUrl) {
      throw new Error('フォームIDまたはファイルURLが指定されていません');
    }

    // URLからファイルIDを抽出してバリデーション
    var fileId = ExtractFileIdFromUrl_(fileUrl);
    if (!fileId) {
      throw new Error('無効なGoogle DriveファイルURLです');
    }

    // ファイルへのアクセス権限を確認
    try {
      DriveApp.getFileById(fileId);
    } catch (accessError) {
      throw new Error('ファイルへのアクセス権限がありません: ' + nfbErrorToString_(accessError));
    }

    if (typeof Forms_getMapping_ !== 'function' || typeof Forms_saveMapping_ !== 'function') {
      throw new Error('Forms mapping functions are unavailable');
    }

    var mapping = Forms_getMapping_() || {};
    var existing = mapping[formId] || {};
    mapping[formId] = {
      fileId: fileId || existing.fileId || null,
      driveFileUrl: fileUrl
    };
    Forms_saveMapping_(mapping);

    return {
      ok: true,
      message: 'フォームURLを追加しました',
      formId: formId,
      fileUrl: fileUrl,
      fileId: fileId
    };
  } catch (error) {
    Logger.log('[AddFormUrl_] Error: ' + nfbErrorToString_(error));
    throw new Error('フォームURLの追加に失敗しました: ' + nfbErrorToString_(error));
  }
}

/**
 * 特定フォームのURLを取得
 * @param {string} formId - フォームID
 * @return {string|null} ファイルURL（存在しない場合はnull）
 */
function GetFormUrl_(formId) {
  try {
    if (!formId) {
      return null;
    }

    if (typeof Forms_getMapping_ !== 'function') {
      return null;
    }

    var mapping = Forms_getMapping_() || {};
    var entry = mapping[formId] || {};
    if (entry.driveFileUrl) {
      return entry.driveFileUrl;
    }
    if (entry.fileId) {
      if (typeof Forms_buildDriveFileUrlFromId_ === 'function') {
        return Forms_buildDriveFileUrlFromId_(entry.fileId);
      }
      return "https://drive.google.com/file/d/" + entry.fileId + "/view";
    }

    return null;
  } catch (error) {
    Logger.log('[GetFormUrl_] Error: ' + nfbErrorToString_(error));
    return null;
  }
}

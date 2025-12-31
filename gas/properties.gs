/**
 * properties.gs
 * UserPropertiesを使用してユーザーごとのフォームURLマップを管理
 */

var FORM_URLS_KEY = 'FORM_URLS_MAP';

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
    var userProps = PropertiesService.getUserProperties();
    var json = userProps.getProperty(FORM_URLS_KEY);

    if (!json) {
      return {};
    }

    return JSON.parse(json);
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
    var userProps = PropertiesService.getUserProperties();
    var json = JSON.stringify(urlMap || {});
    userProps.setProperty(FORM_URLS_KEY, json);
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

    var urlMap = GetFormUrls_();
    urlMap[formId] = fileUrl;
    SaveFormUrls_(urlMap);

    return {
      ok: true,
      message: 'フォームURLを追加しました',
      formId: formId,
      fileUrl: fileUrl
    };
  } catch (error) {
    Logger.log('[AddFormUrl_] Error: ' + nfbErrorToString_(error));
    throw new Error('フォームURLの追加に失敗しました: ' + nfbErrorToString_(error));
  }
}

/**
 * フォームURLを削除
 * @param {string} formId - フォームID
 * @return {Object} 成功メッセージ
 */
function RemoveFormUrl_(formId) {
  try {
    if (!formId) {
      throw new Error('フォームIDが指定されていません');
    }

    var urlMap = GetFormUrls_();

    if (!urlMap[formId]) {
      throw new Error('指定されたフォームIDは登録されていません: ' + formId);
    }

    delete urlMap[formId];
    SaveFormUrls_(urlMap);

    return {
      ok: true,
      message: 'フォームURLを削除しました',
      formId: formId
    };
  } catch (error) {
    Logger.log('[RemoveFormUrl_] Error: ' + nfbErrorToString_(error));
    throw new Error('フォームURLの削除に失敗しました: ' + nfbErrorToString_(error));
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

    var urlMap = GetFormUrls_();
    return urlMap[formId] || null;
  } catch (error) {
    Logger.log('[GetFormUrl_] Error: ' + nfbErrorToString_(error));
    return null;
  }
}

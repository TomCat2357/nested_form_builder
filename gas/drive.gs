/**
 * drive.gs
 * Google DriveでのフォームファイルURL管理機能
 */

/**
 * 保存先URLからフォルダIDとファイル名を解析
 * @param {string} saveUrl - 保存先URL（フォルダまたはファイル）
 * @param {string} defaultFileName - デフォルトファイル名
 * @return {Object} { folderId, fileName }
 */
function ParseSaveUrl_(saveUrl, defaultFileName) {
  var result = {
    folderId: null,
    fileName: defaultFileName
  };

  if (!saveUrl || saveUrl.trim() === '') {
    // 空白の場合はマイドライブルート
    return result;
  }

  var trimmedUrl = saveUrl.trim();

  // パターン1: フォルダURL
  // https://drive.google.com/drive/folders/{folderId}
  var folderMatch = trimmedUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    result.folderId = folderMatch[1];
    return result;
  }

  // パターン2: ファイルURL（編集画面など）
  // https://drive.google.com/file/d/{fileId}/...
  var fileMatch = trimmedUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    // ファイルIDからファイル名を取得
    try {
      var file = DriveApp.getFileById(fileMatch[1]);
      var parents = file.getParents();
      if (parents.hasNext()) {
        result.folderId = parents.next().getId();
      }
      result.fileName = file.getName();
      return result;
    } catch (e) {
      Logger.log('[ParseSaveUrl_] ファイルアクセスエラー: ' + e.message);
    }
  }

  // パターン3: フォルダID直接指定
  var folderIdMatch = trimmedUrl.match(/^([a-zA-Z0-9_-]{25,})$/);
  if (folderIdMatch) {
    result.folderId = folderIdMatch[1];
    return result;
  }

  // パターン4: フォルダURL + ファイル名（カスタム形式）
  // 例: https://drive.google.com/drive/folders/{folderId}/myform.json
  var customMatch = trimmedUrl.match(/\/folders\/([a-zA-Z0-9_-]+)\/(.+)$/);
  if (customMatch) {
    result.folderId = customMatch[1];
    result.fileName = customMatch[2];
    return result;
  }

  return result;
}

/**
 * 新しいフォームファイルを作成
 * @param {Object} formData - フォームデータ
 * @param {string} saveUrl - 保存先URL（オプション）
 * @return {Object} 作成されたフォームデータとファイルURL
 */
function CreateFormFile_(formData, saveUrl) {
  try {
    if (!formData || !formData.id) {
      throw new Error('フォームデータが不正です');
    }

    var defaultFileName = 'form_' + formData.id + '.json';
    var parsed = ParseSaveUrl_(saveUrl, defaultFileName);
    var jsonContent = JSON.stringify(formData, null, 2);

    var file;
    if (parsed.folderId) {
      // 指定フォルダに作成
      var folder = DriveApp.getFolderById(parsed.folderId);
      file = folder.createFile(parsed.fileName, jsonContent, MimeType.PLAIN_TEXT);
      Logger.log('[CreateFormFile_] Created in folder: ' + parsed.fileName);
    } else {
      // マイドライブルートに作成
      file = DriveApp.createFile(parsed.fileName, jsonContent, MimeType.PLAIN_TEXT);
      Logger.log('[CreateFormFile_] Created in My Drive: ' + parsed.fileName);
    }

    // 共有リンクを取得
    var fileUrl = file.getUrl();

    // ファイルURLを含めて返す
    formData.fileUrl = fileUrl;
    return {
      formData: formData,
      fileUrl: fileUrl
    };
  } catch (error) {
    Logger.log('[CreateFormFile_] Error: ' + error.message);
    throw new Error('フォームファイルの作成に失敗しました: ' + error.message);
  }
}

/**
 * URLからフォームデータを取得
 * @param {string} fileUrl - Google DriveファイルURL
 * @return {Object|null} フォームデータ（取得失敗時はnull）
 */
function GetFormByUrl_(fileUrl) {
  try {
    if (!fileUrl) {
      throw new Error('ファイルURLが指定されていません');
    }

    var fileId = ExtractFileIdFromUrl_(fileUrl);
    if (!fileId) {
      throw new Error('無効なファイルURLです: ' + fileUrl);
    }

    Logger.log('[GetFormByUrl_] Attempting to access file: ' + fileId);

    var file;
    try {
      file = DriveApp.getFileById(fileId);
    } catch (accessError) {
      Logger.log('[GetFormByUrl_] DriveApp.getFileById failed: ' + accessError.message);
      throw new Error('ファイルへのアクセスに失敗しました。ファイルが存在し、適切な共有設定がされているか確認してください。(File ID: ' + fileId + ')');
    }

    var content;
    try {
      content = file.getBlob().getDataAsString();
    } catch (readError) {
      Logger.log('[GetFormByUrl_] File read failed: ' + readError.message);
      throw new Error('ファイルの読み込みに失敗しました: ' + readError.message);
    }

    var formData;
    try {
      formData = JSON.parse(content);
    } catch (parseError) {
      Logger.log('[GetFormByUrl_] JSON parse failed: ' + parseError.message);
      throw new Error('ファイルの内容が不正なJSON形式です: ' + parseError.message);
    }

    // ファイルURLをフォームデータに追加
    formData.fileUrl = fileUrl;

    return formData;
  } catch (error) {
    Logger.log('[GetFormByUrl_] Error: ' + error.message);
    // エラーを呼び出し元に伝播させる（nullではなく）
    throw error;
  }
}

/**
 * URLマップから全フォーム一覧を取得
 * @param {Object} urlMap - フォームURLマップ { formId: fileUrl, ... }
 * @param {boolean} includeArchived - アーカイブ済みフォームを含めるか
 * @return {Array} フォーム配列
 */
function ListFormsFromUrls_(urlMap, includeArchived) {
  try {
    var forms = [];

    for (var formId in urlMap) {
      if (!urlMap.hasOwnProperty(formId)) {
        continue;
      }

      var fileUrl = urlMap[formId];
      var formData = GetFormByUrl_(fileUrl);

      if (!formData) {
        Logger.log('[ListFormsFromUrls_] Failed to get form: ' + formId);
        continue;
      }

      // アーカイブフィルタリング
      if (!includeArchived && formData.archived) {
        continue;
      }

      forms.push(formData);
    }

    return forms;
  } catch (error) {
    Logger.log('[ListFormsFromUrls_] Error: ' + error.message);
    throw new Error('フォーム一覧の取得に失敗しました: ' + error.message);
  }
}

/**
 * URLでフォームを更新
 * @param {string} fileUrl - Google DriveファイルURL
 * @param {Object} updates - 更新内容
 * @return {Object} 更新されたフォームデータ
 */
function UpdateFormByUrl_(fileUrl, updates) {
  try {
    if (!fileUrl || !updates) {
      throw new Error('ファイルURLまたは更新内容が不正です');
    }

    var fileId = ExtractFileIdFromUrl_(fileUrl);
    if (!fileId) {
      throw new Error('無効なファイルURLです');
    }

    var file = DriveApp.getFileById(fileId);

    // 既存データを読み込み
    var content = file.getBlob().getDataAsString();
    var currentData = JSON.parse(content);

    // 更新データをマージ
    var updatedData = MergeFormData_(currentData, updates);

    // ファイルに書き戻し
    var jsonContent = JSON.stringify(updatedData, null, 2);
    file.setContent(jsonContent);

    // ファイルURLを追加
    updatedData.fileUrl = fileUrl;

    Logger.log('[UpdateFormByUrl_] Updated: ' + file.getName());
    return updatedData;
  } catch (error) {
    Logger.log('[UpdateFormByUrl_] Error: ' + error.message);
    throw new Error('フォームの更新に失敗しました: ' + error.message);
  }
}

/**
 * フォームデータをマージ（内部ヘルパー）
 * @param {Object} current - 現在のフォームデータ
 * @param {Object} updates - 更新内容
 * @return {Object} マージ後のフォームデータ
 */
function MergeFormData_(current, updates) {
  var merged = {};

  // 現在のデータをコピー
  for (var key in current) {
    if (current.hasOwnProperty(key)) {
      merged[key] = current[key];
    }
  }

  // 更新データをマージ
  for (var key in updates) {
    if (updates.hasOwnProperty(key)) {
      merged[key] = updates[key];
    }
  }

  // 不変フィールドを保護
  merged.id = current.id;
  merged.createdAt = current.createdAt;
  merged.createdAtUnixMs = Sheets_toUnixMs_(current.createdAt);

  // modifiedAtを更新
  var nowDate = new Date();
  merged.modifiedAt = nowDate.toISOString();
  merged.modifiedAtUnixMs = nowDate.getTime();

  return merged;
}

// ========================================
// フォーム管理機能（Google Drive保存）
// ========================================

var FORMS_FOLDER_NAME = "Nested Form Builder - Forms";
var FORMS_PROPERTY_KEY = "nfb.forms.mapping"; // formId -> fileId mapping

/**
 * Google DriveのURLからIDを抽出
 * @param {string} url - Google DriveのURL
 * @return {Object} { type: "file"|"folder"|null, id: string|null }
 */
function Forms_parseGoogleDriveUrl_(url) {
  if (!url || typeof url !== "string") {
    return { type: null, id: null };
  }

  var trimmed = url.trim();
  if (!trimmed) {
    return { type: null, id: null };
  }

  // ファイルURL: https://drive.google.com/file/d/{fileId}/view
  var fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    return { type: "file", id: fileMatch[1] };
  }

  // フォルダURL: https://drive.google.com/drive/folders/{folderId}
  var folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    return { type: "folder", id: folderMatch[1] };
  }

  // open?id= 形式: https://drive.google.com/open?id={id}
  var openMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openMatch) {
    // ファイルかフォルダか判定が必要
    try {
      var item = DriveApp.getFileById(openMatch[1]);
      return { type: "file", id: openMatch[1] };
    } catch (e) {
      try {
        var folder = DriveApp.getFolderById(openMatch[1]);
        return { type: "folder", id: openMatch[1] };
      } catch (e2) {
        return { type: null, id: null };
      }
    }
  }

  // IDのみが渡された場合も試す
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    try {
      var testFile = DriveApp.getFileById(trimmed);
      return { type: "file", id: trimmed };
    } catch (e) {
      try {
        var testFolder = DriveApp.getFolderById(trimmed);
        return { type: "folder", id: trimmed };
      } catch (e2) {
        return { type: null, id: null };
      }
    }
  }

  return { type: null, id: null };
}

/**
 * プロパティサービスから全フォームマッピングを取得
 * @return {Object} formId -> fileId のマッピング
 */
function Forms_getMapping_() {
  var props = PropertiesService.getUserProperties();
  var json = props.getProperty(FORMS_PROPERTY_KEY);
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch (err) {
    Logger.log("Forms_getMapping_ parse error: " + err);
    return {};
  }
}

/**
 * プロパティサービスにフォームマッピングを保存
 * @param {Object} mapping - formId -> fileId のマッピング
 */
function Forms_saveMapping_(mapping) {
  var props = PropertiesService.getUserProperties();
  props.setProperty(FORMS_PROPERTY_KEY, JSON.stringify(mapping || {}));
}

/**
 * フォーム保存用フォルダを取得または作成
 * @return {Folder}
 */
function Forms_getOrCreateFolder_() {
  var folders = DriveApp.getFoldersByName(FORMS_FOLDER_NAME);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(FORMS_FOLDER_NAME);
}

/**
 * フォームをGoogle Driveに保存（新規作成または更新）
 * @param {Object} form - フォームオブジェクト
 * @param {string} targetUrl - 保存先URL（オプション）
 * @return {Object} { ok: true, fileId, fileUrl, form }
 */
function Forms_saveForm_(form, targetUrl) {
  if (!form || !form.id) {
    throw new Error("Form ID is required");
  }

  var mapping = Forms_getMapping_();
  var existingFileId = mapping[form.id];
  var file;
  var now = new Date().toISOString();
  var fileId = null;

  // タイムスタンプを追加
  var formWithTimestamp = {
    id: form.id,
    name: form.name || "無題のフォーム",
    description: form.description || "",
    schema: form.schema || [],
    settings: form.settings || {},
    schemaHash: form.schemaHash || "",
    importantFields: form.importantFields || [],
    displayFieldSettings: form.displayFieldSettings || [],
    createdAt: form.createdAt || now,
    modifiedAt: now,
    archived: !!form.archived,
    schemaVersion: form.schemaVersion || 1,
  };

  var content = JSON.stringify(formWithTimestamp, null, 2);
  var fileName = "form_" + form.id + ".json";

  // targetUrlが指定されている場合、その場所に保存
  if (targetUrl) {
    var parsed = Forms_parseGoogleDriveUrl_(targetUrl);

    if (parsed.type === "file") {
      // 既存ファイルに上書き
      try {
        file = DriveApp.getFileById(parsed.id);
        file.setContent(content);
        fileId = parsed.id;
      } catch (err) {
        throw new Error("指定されたファイルにアクセスできません: " + err.message);
      }
    } else if (parsed.type === "folder") {
      // 指定フォルダに新規作成
      try {
        var folder = DriveApp.getFolderById(parsed.id);
        file = folder.createFile(fileName, content, MimeType.PLAIN_TEXT);
        fileId = file.getId();
      } catch (err) {
        throw new Error("指定されたフォルダにアクセスできません: " + err.message);
      }
    } else {
      throw new Error("無効なGoogle Drive URLです");
    }
  } else {
    // targetUrlが未指定の場合、既存ファイルの更新または新規作成
    if (existingFileId) {
      // 既存ファイルがあれば更新
      try {
        file = DriveApp.getFileById(existingFileId);
        file.setContent(content);
        file.setName(fileName);
        fileId = existingFileId;
      } catch (err) {
        Logger.log("既存ファイルが見つからないため新規作成: " + err);
        existingFileId = null;
      }
    }

    // 既存ファイルがない場合、デフォルトフォルダに作成
    if (!existingFileId) {
      var defaultFolder = Forms_getOrCreateFolder_();
      file = defaultFolder.createFile(fileName, content, MimeType.PLAIN_TEXT);
      fileId = file.getId();
    }
  }

  // マッピングを更新
  mapping[form.id] = fileId;
  Forms_saveMapping_(mapping);

  return {
    ok: true,
    fileId: fileId,
    fileUrl: file.getUrl(),
    form: formWithTimestamp,
  };
}

/**
 * 全フォームを取得
 * @param {Object} options - { includeArchived: boolean }
 * @return {Array} フォーム配列
 */
function Forms_listForms_(options) {
  var includeArchived = !!(options && options.includeArchived);
  var mapping = Forms_getMapping_();
  var forms = [];

  for (var formId in mapping) {
    if (!mapping.hasOwnProperty(formId)) continue;
    var fileId = mapping[formId];
    try {
      var file = DriveApp.getFileById(fileId);
      var content = file.getBlob().getDataAsString();
      var form = JSON.parse(content);

      // アーカイブフィルタリング
      if (!includeArchived && form.archived) {
        continue;
      }

      forms.push(form);
    } catch (err) {
      Logger.log("Error loading form " + formId + ": " + err);
    }
  }

  return forms;
}

/**
 * 特定フォームを取得
 * @param {string} formId
 * @return {Object|null} フォームオブジェクトまたはnull
 */
function Forms_getForm_(formId) {
  if (!formId) return null;

  var mapping = Forms_getMapping_();
  var fileId = mapping[formId];

  if (!fileId) return null;

  try {
    var file = DriveApp.getFileById(fileId);
    var content = file.getBlob().getDataAsString();
    return JSON.parse(content);
  } catch (err) {
    Logger.log("Error loading form " + formId + ": " + err);
    return null;
  }
}

/**
 * フォームを削除
 * @param {string} formId
 * @return {Object} { ok: true }
 */
function Forms_deleteForm_(formId) {
  if (!formId) {
    throw new Error("Form ID is required");
  }

  var mapping = Forms_getMapping_();
  var fileId = mapping[formId];

  if (fileId) {
    try {
      var file = DriveApp.getFileById(fileId);
      file.setTrashed(true);
    } catch (err) {
      Logger.log("Error deleting file for form " + formId + ": " + err);
    }
  }

  delete mapping[formId];
  Forms_saveMapping_(mapping);

  return { ok: true };
}

/**
 * フォームのアーカイブ状態を変更
 * @param {string} formId
 * @param {boolean} archived
 * @return {Object} { ok: true, form }
 */
function Forms_setFormArchivedState_(formId, archived) {
  var form = Forms_getForm_(formId);
  if (!form) {
    throw new Error("Form not found: " + formId);
  }

  form.archived = !!archived;
  form.modifiedAt = new Date().toISOString();

  return Forms_saveForm_(form);
}

// ========================================
// Public API Functions (google.script.run経由で呼び出し可能)
// ========================================

/**
 * フォーム一覧を取得
 */
function nfbListForms(options) {
  try {
    var forms = Forms_listForms_(options || {});
    return {
      ok: true,
      forms: forms,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
    };
  }
}

/**
 * 特定フォームを取得
 */
function nfbGetForm(formId) {
  try {
    var form = Forms_getForm_(formId);
    if (!form) {
      return {
        ok: false,
        error: "Form not found",
      };
    }
    return {
      ok: true,
      form: form,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
    };
  }
}

/**
 * フォームを保存（新規作成または更新）
 * @param {Object} payload - { form: Object, targetUrl: string }
 */
function nfbSaveForm(payload) {
  try {
    var form = payload.form || payload;
    var targetUrl = payload.targetUrl || null;
    var result = Forms_saveForm_(form, targetUrl);
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
    };
  }
}

/**
 * フォームを削除
 */
function nfbDeleteForm(formId) {
  try {
    return Forms_deleteForm_(formId);
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
    };
  }
}

/**
 * フォームをアーカイブ
 */
function nfbArchiveForm(formId) {
  try {
    return Forms_setFormArchivedState_(formId, true);
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
    };
  }
}

/**
 * フォームのアーカイブを解除
 */
function nfbUnarchiveForm(formId) {
  try {
    return Forms_setFormArchivedState_(formId, false);
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
    };
  }
}

/**
 * Google DriveのURL（ファイルまたはフォルダ）からフォームをインポート
 * @param {string} url - Google DriveのURL
 * @return {Object} { ok: true, forms: Array, skipped: number }
 */
function Forms_importFromDrive_(url) {
  if (!url || typeof url !== "string") {
    throw new Error("URLが必要です");
  }

  var parsed = Forms_parseGoogleDriveUrl_(url);
  if (!parsed.type) {
    throw new Error("無効なGoogle Drive URLです");
  }

  var mapping = Forms_getMapping_();
  var existingFormIds = Object.keys(mapping);
  var forms = [];
  var skipped = 0;

  if (parsed.type === "file") {
    // ファイルの場合：そのファイルを読み込む
    try {
      var file = DriveApp.getFileById(parsed.id);
      var fileName = file.getName();

      // .jsonファイルかチェック
      if (!fileName.toLowerCase().endsWith(".json")) {
        throw new Error("JSONファイルではありません: " + fileName);
      }

      var content = file.getBlob().getDataAsString();
      var formData = JSON.parse(content);

      // formIdが既に存在するかチェック
      if (formData.id && existingFormIds.indexOf(formData.id) !== -1) {
        skipped += 1;
      } else {
        forms.push(formData);
      }
    } catch (err) {
      throw new Error("ファイルの読み込みに失敗しました: " + err.message);
    }
  } else if (parsed.type === "folder") {
    // フォルダの場合：フォルダ内の.jsonファイルを全て読み込む
    try {
      var folder = DriveApp.getFolderById(parsed.id);
      var files = folder.getFilesByType(MimeType.PLAIN_TEXT);

      while (files.hasNext()) {
        var file = files.next();
        var fileName = file.getName();

        // .jsonファイルのみ処理
        if (!fileName.toLowerCase().endsWith(".json")) {
          continue;
        }

        try {
          var content = file.getBlob().getDataAsString();
          var formData = JSON.parse(content);

          // 有効なフォームデータかチェック（最低限nameとschemaがあるか）
          if (!formData || typeof formData !== "object") {
            Logger.log("Invalid form data in file: " + fileName);
            continue;
          }

          // formIdが既に存在するかチェック
          if (formData.id && existingFormIds.indexOf(formData.id) !== -1) {
            skipped += 1;
          } else {
            forms.push(formData);
          }
        } catch (parseErr) {
          Logger.log("Failed to parse JSON file: " + fileName + " - " + parseErr.message);
          continue;
        }
      }
    } catch (err) {
      throw new Error("フォルダの読み込みに失敗しました: " + err.message);
    }
  }

  return {
    ok: true,
    forms: forms,
    skipped: skipped,
  };
}

/**
 * Google DriveからフォームをインポートするAPI
 * @param {string} url - Google DriveのURL（ファイルまたはフォルダ）
 * @return {Object} { ok: true, forms: Array, skipped: number }
 */
function nfbImportFormsFromDrive(url) {
  try {
    return Forms_importFromDrive_(url);
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
    };
  }
}

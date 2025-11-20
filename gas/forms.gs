// ========================================
// フォーム管理機能（Google Drive保存）
// ========================================

var FORMS_FOLDER_NAME = "Nested Form Builder - Forms";
var FORMS_PROPERTY_KEY = "nfb.forms.mapping"; // formId -> fileId mapping

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
 * @return {Object} { ok: true, fileId, fileUrl, form }
 */
function Forms_saveForm_(form) {
  if (!form || !form.id) {
    throw new Error("Form ID is required");
  }

  var mapping = Forms_getMapping_();
  var fileId = mapping[form.id];
  var file;
  var now = new Date().toISOString();

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

  // 既存ファイルがあれば更新
  if (fileId) {
    try {
      file = DriveApp.getFileById(fileId);
      file.setContent(content);
      file.setName(fileName);
    } catch (err) {
      // ファイルが存在しない場合は新規作成
      Logger.log("File not found, creating new: " + err);
      fileId = null;
    }
  }

  // 新規作成
  if (!fileId) {
    var folder = Forms_getOrCreateFolder_();
    file = folder.createFile(fileName, content, MimeType.PLAIN_TEXT);
    fileId = file.getId();
    mapping[form.id] = fileId;
    Forms_saveMapping_(mapping);
  }

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
 */
function nfbSaveForm(form) {
  try {
    var result = Forms_saveForm_(form);
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

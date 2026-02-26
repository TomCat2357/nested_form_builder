// Split from forms.gs



function Forms_buildSpreadsheetName_(form) {
  var base = "";
  if (form && form.settings && form.settings.formTitle) {
    base = String(form.settings.formTitle || "");
  }
  if (!base && form && form.id) {
    base = "form_" + form.id;
  }
  base = String(base || "Nested Form Builder");
  base = base.replace(/[\r\n]/g, " ").replace(/\//g, "-").trim();
  if (!base) {
    base = "Nested Form Builder";
  }
  var name = "NFB Responses - " + base;
  if (name.length > 120) {
    name = name.substring(0, 120);
  }
  return name;
}

/**
 * スプレッドシートを新規作成
 * @param {string} name
 * @param {string|null} folderId
 * @return {{ spreadsheetId: string, spreadsheetUrl: string }}
 */

function Forms_createSpreadsheet_(name, folderId) {
  var ss = SpreadsheetApp.create(name || "NFB Responses");
  var spreadsheetId = ss.getId();

  if (folderId) {
    var folder = DriveApp.getFolderById(folderId);
    var file = DriveApp.getFileById(spreadsheetId);
    folder.addFile(file);
    try {
      DriveApp.getRootFolder().removeFile(file);
    } catch (err) {
      Logger.log("[Forms_createSpreadsheet_] Root remove failed: " + err);
    }
  }

  return {
    spreadsheetId: spreadsheetId,
    spreadsheetUrl: ss.getUrl()
  };
}

/**
 * スプレッドシート設定を解決（空/フォルダ指定は新規作成）
 * @param {Object} settings
 * @param {Object} form
 * @return {{ settings: Object, created: boolean, spreadsheetId: string|null, spreadsheetUrl: string|null }}
 */

function Forms_resolveSpreadsheetSetting_(settings, form) {
  var nextSettings = (settings && typeof settings === "object") ? JSON.parse(JSON.stringify(settings)) : {};
  var rawInput = String(nextSettings.spreadsheetId || "").trim();

  if (!rawInput) {
    var createdRoot = Forms_createSpreadsheet_(Forms_buildSpreadsheetName_(form), null);
    nextSettings.spreadsheetId = createdRoot.spreadsheetUrl;
    return {
      settings: nextSettings,
      created: true,
      spreadsheetId: createdRoot.spreadsheetId,
      spreadsheetUrl: createdRoot.spreadsheetUrl
    };
  }

  var parsed = Forms_parseSpreadsheetTarget_(rawInput);
  if (!parsed.type) {
    throw new Error("無効なスプレッドシートURL/IDです");
  }

  if (parsed.type === "folder") {
    var createdFolder = Forms_createSpreadsheet_(Forms_buildSpreadsheetName_(form), parsed.id);
    nextSettings.spreadsheetId = createdFolder.spreadsheetUrl;
    return {
      settings: nextSettings,
      created: true,
      spreadsheetId: createdFolder.spreadsheetId,
      spreadsheetUrl: createdFolder.spreadsheetUrl
    };
  }

  // spreadsheet
  try {
    SpreadsheetApp.openById(parsed.id);
  } catch (err) {
    throw new Error("スプレッドシートにアクセスできません: " + (err && err.message ? err.message : String(err)));
  }

  nextSettings.spreadsheetId = rawInput;
  return {
    settings: nextSettings,
    created: false,
    spreadsheetId: parsed.id,
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/" + parsed.id + "/edit"
  };
}

/**
 * プロパティサービスから全フォームマッピングを取得
 * @return {Object} formId -> fileId のマッピング
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
 * @param {string} saveMode - 保存モード（auto|overwrite_existing|copy_to_root|copy_to_folder）
 * @return {Object} { ok: true, fileId, fileUrl, form }
 */

function Forms_saveForm_(form, targetUrl, saveMode) {
  if (!form || !form.id) {
    throw new Error("Form ID is required");
  }

  var requestedSaveMode = saveMode || "auto";
  Logger.log("[Forms_saveForm_] Starting save for formId: " + form.id + ", requestedSaveMode: " + requestedSaveMode);

  // DEBUG: 現在のプロパティ保存先を直接読んで確認
  var activeProps = Forms_getActiveProps_();
  var propertyStoreMode = Nfb_getPropertyStoreMode_();
  var rawJsonBeforeGetMapping = activeProps.getProperty(FORMS_PROPERTY_KEY);
  Logger.log("[Forms_saveForm_] DEBUG: Raw JSON from PropertiesService (" + propertyStoreMode + ") BEFORE Forms_getMapping_: " + rawJsonBeforeGetMapping);

  var mapping = Forms_getMapping_();
  Logger.log("[Forms_saveForm_] Current mapping before save: " + JSON.stringify(mapping));

  // DEBUG: もう一度PropertiesServiceを直接読んで確認
  var rawJsonAfterGetMapping = activeProps.getProperty(FORMS_PROPERTY_KEY);
  Logger.log("[Forms_saveForm_] DEBUG: Raw JSON from PropertiesService (" + propertyStoreMode + ") AFTER Forms_getMapping_: " + rawJsonAfterGetMapping);

  var mappingEntry = mapping[form.id] || {};
  var existingFileId = mappingEntry.fileId;
  Logger.log("[Forms_saveForm_] Existing fileId for this form: " + existingFileId);

  var file;
  var fileId = null;
  var nowDate = new Date();
  var currentTs = Sheets_dateToSerial_(nowDate);
  var createdAtSerial = Sheets_toUnixMs_(form.createdAt, true);
  if (createdAtSerial === null) {
    createdAtSerial = currentTs;
  }

  // スプレッドシート設定を解決（空/フォルダ指定は新規作成）
  var settingsResult = Forms_resolveSpreadsheetSetting_(form.settings || {}, form);
  if (settingsResult && settingsResult.created) {
    Logger.log("[Forms_saveForm_] Created spreadsheet: " + settingsResult.spreadsheetUrl);
  }
  var settingsForSave = (settingsResult && settingsResult.settings) ? settingsResult.settings : (form.settings || {});

  // スプレッドシートのヘッダーを初期化
  if (settingsResult && settingsResult.spreadsheetId && Array.isArray(form.schema) && form.schema.length > 0) {
    try {
      var sheetName = settingsForSave.sheetName || NFB_DEFAULT_SHEET_NAME;
      Sheets_initializeHeaders_(settingsResult.spreadsheetId, sheetName, form.schema);
    } catch (headerErr) {
      Logger.log("[Forms_saveForm_] Header init failed (non-critical): " + headerErr);
    }
  }

  // 仮のフォームオブジェクトを作成（driveFileUrlなし）
  var formWithTimestamp = {
    id: form.id,
    description: form.description || "",
    schema: form.schema || [],
    settings: settingsForSave,
    schemaHash: form.schemaHash || "",
    importantFields: form.importantFields || [],
    displayFieldSettings: form.displayFieldSettings || [],
    createdAt: createdAtSerial,
    modifiedAt: currentTs,
    createdAtUnixMs: createdAtSerial,
    modifiedAtUnixMs: currentTs,
    archived: !!form.archived,
    schemaVersion: form.schemaVersion || 1,
  };

  var content = JSON.stringify(formWithTimestamp, null, 2);
  var formTitle = (form.settings && form.settings.formTitle) || form.description || form.id;
  var safeTitle = String(formTitle).replace(/[\\/:*?"<>|]/g, "_").substring(0, 100);
  var fileName = safeTitle + ".json";

  var parsedTarget = null;
  if (targetUrl) {
    parsedTarget = Forms_parseGoogleDriveUrl_(targetUrl);
    if (!parsedTarget.type) {
      throw new Error("[save-stage=parse-target] 無効なGoogle Drive URLです. formId=" + form.id + ", saveMode=" + requestedSaveMode);
    }
  }

  var effectiveSaveMode = requestedSaveMode;
  if (effectiveSaveMode === "auto") {
    if (parsedTarget && parsedTarget.type === "folder") {
      effectiveSaveMode = "copy_to_folder";
    } else if (parsedTarget && parsedTarget.type === "file") {
      effectiveSaveMode = "overwrite_existing";
    } else if (existingFileId) {
      effectiveSaveMode = "overwrite_existing";
    } else {
      effectiveSaveMode = "copy_to_root";
    }
  }

  if (effectiveSaveMode === "overwrite_existing") {
    var overwriteFileId = null;
    if (parsedTarget && parsedTarget.type === "file") {
      overwriteFileId = parsedTarget.id;
    } else if (existingFileId) {
      overwriteFileId = existingFileId;
    }

    if (!overwriteFileId) {
      throw new Error("[save-stage=resolve-overwrite-target] 上書き保存先のファイルIDを解決できません. formId=" + form.id + ", saveMode=" + effectiveSaveMode);
    }

    try {
      file = DriveApp.getFileById(overwriteFileId);
    } catch (errOpenFile) {
      throw new Error("[save-stage=open-file] ファイルにアクセスできません. formId=" + form.id + ", fileId=" + overwriteFileId + ", saveMode=" + effectiveSaveMode + ", error=" + (errOpenFile && errOpenFile.message ? errOpenFile.message : String(errOpenFile)));
    }

    try {
      file.setContent(content);
      fileId = overwriteFileId;
    } catch (errWriteFile) {
      throw new Error("[save-stage=write-file] ファイル更新に失敗しました. formId=" + form.id + ", fileId=" + overwriteFileId + ", saveMode=" + effectiveSaveMode + ", error=" + (errWriteFile && errWriteFile.message ? errWriteFile.message : String(errWriteFile)));
    }
  } else if (effectiveSaveMode === "copy_to_folder") {
    if (!parsedTarget || parsedTarget.type !== "folder") {
      throw new Error("[save-stage=resolve-folder-target] copy_to_folder にはフォルダURLが必要です. formId=" + form.id + ", saveMode=" + effectiveSaveMode);
    }

    try {
      var folder = DriveApp.getFolderById(parsedTarget.id);
      file = folder.createFile(fileName, content, MimeType.PLAIN_TEXT);
      fileId = file.getId();
    } catch (errCreateInFolder) {
      throw new Error("[save-stage=create-in-folder] 指定フォルダへの保存に失敗しました. formId=" + form.id + ", folderId=" + parsedTarget.id + ", saveMode=" + effectiveSaveMode + ", error=" + (errCreateInFolder && errCreateInFolder.message ? errCreateInFolder.message : String(errCreateInFolder)));
    }
  } else if (effectiveSaveMode === "copy_to_root") {
    try {
      file = DriveApp.createFile(fileName, content, MimeType.PLAIN_TEXT);
      fileId = file.getId();
    } catch (errCreateInRoot) {
      throw new Error("[save-stage=create-in-root] マイドライブ直下への保存に失敗しました. formId=" + form.id + ", saveMode=" + effectiveSaveMode + ", error=" + (errCreateInRoot && errCreateInRoot.message ? errCreateInRoot.message : String(errCreateInRoot)));
    }
  } else {
    throw new Error("[save-stage=resolve-mode] 未知のsaveModeです: " + effectiveSaveMode + ", formId=" + form.id);
  }

  if (!file && fileId) {
    try {
      file = DriveApp.getFileById(fileId);
    } catch (errReload) {
      throw new Error("[save-stage=reload-file] 保存後ファイルの再取得に失敗しました. formId=" + form.id + ", fileId=" + fileId + ", saveMode=" + effectiveSaveMode + ", error=" + (errReload && errReload.message ? errReload.message : String(errReload)));
    }
  }

  var fileUrl = null;
  try {
    fileUrl = file.getUrl();
  } catch (errGetUrl) {
    throw new Error("[save-stage=get-url] ファイルURLの取得に失敗しました. formId=" + form.id + ", fileId=" + fileId + ", saveMode=" + effectiveSaveMode + ", error=" + (errGetUrl && errGetUrl.message ? errGetUrl.message : String(errGetUrl)));
  }
  formWithTimestamp.driveFileUrl = fileUrl;

  // ダウンロード用ファイル内容からIDを除外（外部配布用にID非表示）
  var formForFile = {};
  for (var key in formWithTimestamp) {
    if (!formWithTimestamp.hasOwnProperty(key)) continue;
    if (key === "id") continue;
    if (key === "schema") {
      formForFile.schema = Forms_stripSchemaIds_(formWithTimestamp.schema);
    } else {
      formForFile[key] = formWithTimestamp[key];
    }
  }
  formForFile.driveFileUrl = fileUrl;

  // driveFileUrlを含めて再度ファイルに書き込み（IDなし）
  try {
    file.setContent(JSON.stringify(formForFile, null, 2));
  } catch (errWriteFinal) {
    throw new Error("[save-stage=final-write] driveFileUrl反映書き込みに失敗しました. formId=" + form.id + ", fileId=" + fileId + ", saveMode=" + effectiveSaveMode + ", error=" + (errWriteFinal && errWriteFinal.message ? errWriteFinal.message : String(errWriteFinal)));
  }

  // マッピングを更新
  mapping[form.id] = { fileId: fileId, driveFileUrl: fileUrl };
  Logger.log("[Forms_saveForm_] Updated mapping, about to save: " + JSON.stringify(mapping));
  Forms_saveMapping_(mapping);
  Logger.log("[Forms_saveForm_] Mapping saved. FormId: " + form.id + ", FileId: " + fileId + ", saveMode: " + effectiveSaveMode);

  // 認証用URLマップにも登録（?form=xxx でアクセス可能にする）
  try {
    AddFormUrl_(form.id, fileUrl);
  } catch (err) {
    Logger.log("[Forms_saveForm_] AddFormUrl_ failed (non-critical): " + err);
  }

  return {
    ok: true,
    fileId: fileId,
    fileUrl: fileUrl,
    saveMode: effectiveSaveMode,
    form: formWithTimestamp,
    debugRawJsonBefore: rawJsonBeforeGetMapping,
    debugRawJsonAfter: rawJsonAfterGetMapping,
    debugMappingStr: JSON.stringify(mapping),
  };
}

/**
 * 全フォームを取得（Drive API v3 バッチリクエスト最適化版）
 * @param {Object} options - { includeArchived: boolean }
 * @return {Array} フォーム配列
 */

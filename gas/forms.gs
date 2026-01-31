// ========================================
// フォーム管理機能（Google Drive保存）
// ========================================

var FORMS_FOLDER_NAME = "Nested Form Builder - Forms";
var FORMS_PROPERTY_KEY = "nfb.forms.mapping"; // formId -> mapping (v1: fileId string, v2: { fileId, driveFileUrl })
var FORMS_PROPERTY_VERSION = 2; // v2からdriveFileUrlも保持

function Forms_getScriptProps_() {
  return PropertiesService.getScriptProperties();
}

function Forms_getUserProps_() {
  return PropertiesService.getUserProperties();
}

function Forms_parseMappingJson_(json, label) {
  if (!json) return {};
  try {
    var parsed = JSON.parse(json) || {};
    if (parsed && typeof parsed === "object" && parsed.mapping) {
      return parsed.mapping;
    }
    return parsed;
  } catch (err) {
    Logger.log("[Forms_parseMappingJson_] Failed to parse " + label + ": " + err);
    return {};
  }
}

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
  var scriptProps = Forms_getScriptProps_();
  var userProps = Forms_getUserProps_();

  var scriptJson = scriptProps.getProperty(FORMS_PROPERTY_KEY);
  var userJson = userProps.getProperty(FORMS_PROPERTY_KEY);
  Logger.log("[Forms_getMapping_] Raw JSON (script): " + scriptJson);
  Logger.log("[Forms_getMapping_] Raw JSON (user): " + userJson);

  var mapping = Forms_parseMappingJson_(scriptJson, "script");
  var merged = false;

  if (userJson) {
    var userMapping = Forms_parseMappingJson_(userJson, "user");
    for (var formId in userMapping) {
      if (!userMapping.hasOwnProperty(formId)) continue;
      if (mapping[formId]) continue;
      mapping[formId] = userMapping[formId];
      merged = true;
    }
  }

  // 旧FORM_URLS_MAPに保存されているフォーム（URL形式）をマージ
  if (typeof GetFormUrls_ === "function") {
    var legacy = GetFormUrls_() || {};
    Logger.log("[Forms_getMapping_] Legacy forms count: " + Object.keys(legacy).length);

    for (var legacyFormId in legacy) {
      if (!legacy.hasOwnProperty(legacyFormId)) continue;
      if (mapping[legacyFormId]) continue;

      var fileUrl = legacy[legacyFormId];
      var legacyFileId = null;
      if (typeof ExtractFileIdFromUrl_ === "function") {
        legacyFileId = ExtractFileIdFromUrl_(fileUrl);
      }

      if (legacyFileId) {
        mapping[legacyFormId] = legacyFileId;
        merged = true;
      }
    }
  }

  var normalized = Forms_normalizeMapping_(mapping);

  if (merged) {
    Logger.log("[Forms_getMapping_] Mapping merged from user/legacy sources. Saving to script properties");
    Forms_saveMapping_(normalized);
  }

  Logger.log("[Forms_getMapping_] Returning mapping: " + JSON.stringify(normalized));
  return normalized;
}

function Forms_buildDriveFileUrlFromId_(fileId) {
  if (!fileId) return null;
  return "https://drive.google.com/file/d/" + fileId + "/view";
}

/**
 * マッピング値を正規化（v1: fileId文字列, v2: { fileId, driveFileUrl }）
 * @param {*} value
 * @returns {{fileId: string|null, driveFileUrl: string|null}}
 */
function Forms_normalizeMappingValue_(value) {
  var fileId = null;
  var driveFileUrl = null;

  if (value && typeof value === "object") {
    fileId = value.fileId || null;
    driveFileUrl = value.driveFileUrl || null;
  } else if (typeof value === "string") {
    if (value.indexOf("/file/") !== -1 || value.indexOf("drive.google.com") !== -1) {
      driveFileUrl = value;
      var parsed = Forms_parseGoogleDriveUrl_(value);
      if (parsed.type === "file") {
        fileId = parsed.id;
      }
    } else {
      fileId = value;
    }
  }

  if (!driveFileUrl && fileId) {
    driveFileUrl = Forms_buildDriveFileUrlFromId_(fileId);
  }

  return { fileId: fileId, driveFileUrl: driveFileUrl };
}

/**
 * マッピング全体を正規化
 * @param {Object} mapping
 * @returns {Object} 正規化済みマッピング
 */
function Forms_normalizeMapping_(mapping) {
  var normalized = {};
  for (var formId in mapping) {
    if (!mapping.hasOwnProperty(formId)) continue;
    normalized[formId] = Forms_normalizeMappingValue_(mapping[formId]);
  }
  return normalized;
}

/**
 * スキーマからIDを除去（options/children/_savedChoiceState含む）
 * @param {Array} schema
 * @return {Array}
 */
function Forms_stripSchemaIds_(schema) {
  if (!schema || !schema.map) return [];

  var stripArray = function(arr) {
    return (arr || []).map(function(field) {
      var base = {};
      for (var key in field) {
        if (!field.hasOwnProperty(key)) continue;
        if (key === "id") continue; // フィールドIDは外部配布不要
        base[key] = field[key];
      }

      // optionsのIDを除去
      if (base.options && Array.isArray(base.options)) {
        base.options = base.options.map(function(opt) {
          var optBase = {};
          for (var optKey in opt) {
            if (!opt.hasOwnProperty(optKey)) continue;
            if (optKey === "id") continue;
            optBase[optKey] = opt[optKey];
          }
          return optBase;
        });
      }

      // childrenByValue のIDを除去
      if (base.childrenByValue && typeof base.childrenByValue === "object") {
        var fixed = {};
        for (var val in base.childrenByValue) {
          if (!base.childrenByValue.hasOwnProperty(val)) continue;
          fixed[val] = stripArray(base.childrenByValue[val]);
        }
        base.childrenByValue = fixed;
      }

      // _savedChoiceState 内もID除去
      if (base._savedChoiceState && typeof base._savedChoiceState === "object") {
        var saved = base._savedChoiceState;
        var savedFixed = {};
        if (Array.isArray(saved.options)) {
          savedFixed.options = saved.options.map(function(opt) {
            var optBase = {};
            for (var optKey2 in opt) {
              if (!opt.hasOwnProperty(optKey2)) continue;
              if (optKey2 === "id") continue;
              optBase[optKey2] = opt[optKey2];
            }
            return optBase;
          });
        }
        if (saved.childrenByValue && typeof saved.childrenByValue === "object") {
          var childrenFixed = {};
          for (var keyChild in saved.childrenByValue) {
            if (!saved.childrenByValue.hasOwnProperty(keyChild)) continue;
            childrenFixed[keyChild] = stripArray(saved.childrenByValue[keyChild]);
          }
          savedFixed.childrenByValue = childrenFixed;
        }
        base._savedChoiceState = savedFixed;
      }

      return base;
    });
  };

  return stripArray(schema);
}

/**
 * プロパティサービスにフォームマッピングを保存
 * @param {Object} mapping - formId -> fileId のマッピング
 */
function Forms_saveMapping_(mapping) {
  var normalized = Forms_normalizeMapping_(mapping || {});
  var mappingStr = JSON.stringify({ version: FORMS_PROPERTY_VERSION, mapping: normalized });
  Logger.log("[Forms_saveMapping_] Saving mapping: " + mappingStr);

  var scriptProps = Forms_getScriptProps_();
  scriptProps.setProperty(FORMS_PROPERTY_KEY, mappingStr);

  // 互換性のためユーザープロパティにも書き込む
  var userProps = Forms_getUserProps_();
  try {
    userProps.setProperty(FORMS_PROPERTY_KEY, mappingStr);
  } catch (err) {
    Logger.log("[Forms_saveMapping_] Failed to write user properties: " + err);
  }

  Logger.log("[Forms_saveMapping_] Saved successfully. Total forms: " + Object.keys(normalized || {}).length);
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

  Logger.log("[Forms_saveForm_] Starting save for formId: " + form.id);

  // DEBUG: PropertiesServiceを直接読んで確認（script propertiesを参照）
  var scriptProps = Forms_getScriptProps_();
  var rawJsonBeforeGetMapping = scriptProps.getProperty(FORMS_PROPERTY_KEY);
  Logger.log("[Forms_saveForm_] DEBUG: Raw JSON from PropertiesService BEFORE Forms_getMapping_: " + rawJsonBeforeGetMapping);

  var mapping = Forms_getMapping_();
  Logger.log("[Forms_saveForm_] Current mapping before save: " + JSON.stringify(mapping));

  // DEBUG: もう一度PropertiesServiceを直接読んで確認
  var rawJsonAfterGetMapping = scriptProps.getProperty(FORMS_PROPERTY_KEY);
  Logger.log("[Forms_saveForm_] DEBUG: Raw JSON from PropertiesService AFTER Forms_getMapping_: " + rawJsonAfterGetMapping);

  var mappingEntry = mapping[form.id] || {};
  var existingFileId = mappingEntry.fileId;
  Logger.log("[Forms_saveForm_] Existing fileId for this form: " + existingFileId);
  var file;
  var nowDate = new Date();
  var nowSerial = Sheets_dateToSerial_(nowDate);
  var fileId = null;
  var createdAtSerial = Sheets_toUnixMs_(form.createdAt, true);
  if (createdAtSerial === null) {
    createdAtSerial = nowSerial;
  }

  // 仮のフォームオブジェクトを作成（driveFileUrlなし）
  var formWithTimestamp = {
    id: form.id,
    description: form.description || "",
    schema: form.schema || [],
    settings: form.settings || {},
    schemaHash: form.schemaHash || "",
    importantFields: form.importantFields || [],
    displayFieldSettings: form.displayFieldSettings || [],
    createdAt: createdAtSerial,
    modifiedAt: nowSerial,
    createdAtUnixMs: createdAtSerial,
    modifiedAtUnixMs: nowSerial,
    archived: !!form.archived,
    schemaVersion: form.schemaVersion || 1,
  };

  var content = JSON.stringify(formWithTimestamp, null, 2);
  // ファイル名はフォーム内容のハッシュ値（同じ内容なら同じファイル名）
  var contentHash = Forms_computeContentHash_(formWithTimestamp);
  var fileName = contentHash + ".json";

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

  // ファイルURLを取得してフォームオブジェクトに追加
  var fileUrl = file.getUrl();
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
  file.setContent(JSON.stringify(formForFile, null, 2));

  // マッピングを更新
  mapping[form.id] = { fileId: fileId, driveFileUrl: fileUrl };
  Logger.log("[Forms_saveForm_] Updated mapping, about to save: " + JSON.stringify(mapping));
  Forms_saveMapping_(mapping);
  Logger.log("[Forms_saveForm_] Mapping saved. FormId: " + form.id + ", FileId: " + fileId);

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
function Forms_listForms_(options) {
  var startTime = new Date().getTime();
  var includeArchived = !!(options && options.includeArchived);

  var mappingStartTime = new Date().getTime();
  var mapping = Forms_getMapping_();
  var mappingEndTime = new Date().getTime();
  var mappingDuration = mappingEndTime - mappingStartTime;

  Logger.log("[Forms_listForms_] Retrieved mapping: " + JSON.stringify(mapping));
  Logger.log("[Forms_listForms_] Total forms in mapping: " + Object.keys(mapping).length);
  Logger.log("[Forms_listForms_] Mapping retrieval took: " + mappingDuration + "ms");

  var forms = [];
  var loadFailures = [];

  // マッピングからfileIdリストを構築
  var fileIdMap = {}; // { fileId: formId }
  var formIdToMappingEntry = {}; // { formId: mappingEntry }

  for (var formId in mapping) {
    if (!mapping.hasOwnProperty(formId)) continue;
    var mappingEntry = mapping[formId] || {};
    var fileId = mappingEntry.fileId;
    var driveFileUrlFromMap = mappingEntry.driveFileUrl;

    if (!fileId && driveFileUrlFromMap) {
      var parsedFromUrl = Forms_parseGoogleDriveUrl_(driveFileUrlFromMap);
      if (parsedFromUrl.type === "file") {
        fileId = parsedFromUrl.id;
      }
    }

    if (fileId) {
      fileIdMap[fileId] = formId;
      formIdToMappingEntry[formId] = mappingEntry;
    } else {
      // fileIdがない場合はエラーとして記録
      loadFailures.push({
        id: formId,
        fileId: null,
        fileName: null,
        driveFileUrl: driveFileUrlFromMap || null,
        errorStage: "fileId",
        errorMessage: "プロパティサービスにファイルIDが登録されていません",
        lastTriedAt: new Date().toISOString(),
      });
    }
  }

  var fileIds = Object.keys(fileIdMap);
  Logger.log("[Forms_listForms_] Processing " + fileIds.length + " files with batch requests");

  // Drive API v3 バッチリクエスト（最大100件ずつ）
  var BATCH_SIZE = 100;
  var batchStartTime = new Date().getTime();
  var totalBatchTime = 0;

  for (var i = 0; i < fileIds.length; i += BATCH_SIZE) {
    var batchFileIds = fileIds.slice(i, i + BATCH_SIZE);
    var batchStart = new Date().getTime();

    // バッチリクエストで複数ファイルのメタデータとコンテンツを取得
    try {
      var batchResults = Forms_batchGetFiles_(batchFileIds);
      var batchEnd = new Date().getTime();
      totalBatchTime += (batchEnd - batchStart);

      Logger.log("[Forms_listForms_] Batch " + (Math.floor(i / BATCH_SIZE) + 1) + " completed in " + (batchEnd - batchStart) + "ms (" + batchFileIds.length + " files)");

      // バッチ結果を処理
      for (var j = 0; j < batchResults.length; j++) {
        var result = batchResults[j];
        var fileId = result.fileId;
        var formId = fileIdMap[fileId];
        var mappingEntry = formIdToMappingEntry[formId];

        if (result.error) {
          // エラーケース
          loadFailures.push({
            id: formId,
            fileId: fileId,
            fileName: result.fileName || null,
            driveFileUrl: mappingEntry.driveFileUrl || Forms_buildDriveFileUrlFromId_(fileId),
            errorStage: result.errorStage || "unknown",
            errorMessage: result.error,
            lastTriedAt: new Date().toISOString(),
          });
        } else {
          // 成功ケース
          try {
            var form = JSON.parse(result.content);
            form.id = formId;

            // driveFileUrlがない場合はマッピング/ファイルから補完
            if (!form.driveFileUrl) {
              form.driveFileUrl = mappingEntry.driveFileUrl || result.fileUrl;
            }

            // createdAt/modifiedAt の Unix ms を付与
            var createdAtSerial = Sheets_toUnixMs_(form.createdAt, true);
            var modifiedAtSerial = Sheets_toUnixMs_(form.modifiedAt, true);
            if (createdAtSerial !== null) form.createdAt = createdAtSerial;
            if (modifiedAtSerial !== null) form.modifiedAt = modifiedAtSerial;
            form.createdAtUnixMs = createdAtSerial;
            form.modifiedAtUnixMs = modifiedAtSerial;

            // アーカイブフィルタリング
            if (!includeArchived && form.archived) {
              Logger.log("[Forms_listForms_] Skipping archived form: " + formId);
              continue;
            }

            forms.push(form);
          } catch (parseErr) {
            loadFailures.push({
              id: formId,
              fileId: fileId,
              fileName: result.fileName,
              driveFileUrl: mappingEntry.driveFileUrl || result.fileUrl,
              errorStage: "parse",
              errorMessage: parseErr && parseErr.message ? parseErr.message : String(parseErr),
              lastTriedAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (batchErr) {
      Logger.log("[Forms_listForms_] Batch request failed: " + batchErr);
      // バッチ全体が失敗した場合は個別にフォールバック
      for (var k = 0; k < batchFileIds.length; k++) {
        var fbFileId = batchFileIds[k];
        var fbFormId = fileIdMap[fbFileId];
        loadFailures.push({
          id: fbFormId,
          fileId: fbFileId,
          fileName: null,
          driveFileUrl: formIdToMappingEntry[fbFormId].driveFileUrl || Forms_buildDriveFileUrlFromId_(fbFileId),
          errorStage: "batch",
          errorMessage: batchErr && batchErr.message ? batchErr.message : String(batchErr),
          lastTriedAt: new Date().toISOString(),
        });
      }
    }
  }

  var endTime = new Date().getTime();
  var totalDuration = endTime - startTime;

  Logger.log("[Forms_listForms_] === Performance Summary ===");
  Logger.log("[Forms_listForms_] Total duration: " + totalDuration + "ms");
  Logger.log("[Forms_listForms_] Mapping retrieval: " + mappingDuration + "ms (" + Math.round(mappingDuration / totalDuration * 100) + "%)");
  Logger.log("[Forms_listForms_] Batch requests: " + totalBatchTime + "ms (" + Math.round(totalBatchTime / totalDuration * 100) + "%)");
  Logger.log("[Forms_listForms_] Average per form: " + Math.round(totalDuration / fileIds.length) + "ms");
  Logger.log("[Forms_listForms_] Returning " + forms.length + " forms (loadFailures=" + loadFailures.length + ")");

  return {
    forms: forms,
    loadFailures: loadFailures,
  };
}

/**
 * Drive API v3を使用して複数ファイルを一括取得
 * @param {Array<string>} fileIds - ファイルIDの配列
 * @return {Array<Object>} 結果の配列 [{ fileId, fileName, fileUrl, content, error, errorStage }]
 */
function Forms_batchGetFiles_(fileIds) {
  var results = [];

  // Drive API v3のbatch requestを使用
  var boundary = "batch_boundary_" + new Date().getTime();
  var batchBody = [];

  for (var i = 0; i < fileIds.length; i++) {
    var fileId = fileIds[i];
    batchBody.push("--" + boundary);
    batchBody.push("Content-Type: application/http");
    batchBody.push("");
    batchBody.push("GET /drive/v3/files/" + fileId + "?fields=id,name,webViewLink&alt=json");
    batchBody.push("");
  }
  batchBody.push("--" + boundary + "--");

  var batchPayload = batchBody.join("\r\n");

  try {
    var response = UrlFetchApp.fetch("https://www.googleapis.com/batch/drive/v3", {
      method: "post",
      contentType: "multipart/mixed; boundary=" + boundary,
      headers: {
        Authorization: "Bearer " + ScriptApp.getOAuthToken(),
      },
      payload: batchPayload,
      muteHttpExceptions: true,
    });

    var responseText = response.getContentText();
    var responseParts = responseText.split("--batch");

    // バッチレスポンスをパース
    var fileMetadataMap = {}; // { fileId: { name, webViewLink } }
    for (var j = 0; j < responseParts.length; j++) {
      var part = responseParts[j];
      if (!part || part.trim() === "" || part.trim() === "--") continue;

      // JSONペイロードを抽出
      var jsonMatch = part.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          var metadata = JSON.parse(jsonMatch[0]);
          if (metadata.id) {
            fileMetadataMap[metadata.id] = {
              name: metadata.name,
              webViewLink: metadata.webViewLink,
            };
          }
        } catch (parseErr) {
          Logger.log("[Forms_batchGetFiles_] Failed to parse batch response part: " + parseErr);
        }
      }
    }

    // メタデータ取得後、各ファイルのコンテンツを取得（DriveApp使用）
    for (var k = 0; k < fileIds.length; k++) {
      var fid = fileIds[k];
      var meta = fileMetadataMap[fid];

      if (!meta) {
        results.push({
          fileId: fid,
          error: "File not found in batch response",
          errorStage: "batch",
        });
        continue;
      }

      try {
        var file = DriveApp.getFileById(fid);
        var content = file.getBlob().getDataAsString();
        results.push({
          fileId: fid,
          fileName: meta.name,
          fileUrl: meta.webViewLink,
          content: content,
        });
      } catch (readErr) {
        results.push({
          fileId: fid,
          fileName: meta.name,
          fileUrl: meta.webViewLink,
          error: readErr && readErr.message ? readErr.message : String(readErr),
          errorStage: "read",
        });
      }
    }
  } catch (batchErr) {
    Logger.log("[Forms_batchGetFiles_] Batch API call failed: " + batchErr);
    // バッチ全体が失敗した場合は個別フォールバック
    for (var m = 0; m < fileIds.length; m++) {
      var fbId = fileIds[m];
      try {
        var fbFile = DriveApp.getFileById(fbId);
        var fbContent = fbFile.getBlob().getDataAsString();
        results.push({
          fileId: fbId,
          fileName: fbFile.getName(),
          fileUrl: fbFile.getUrl(),
          content: fbContent,
        });
      } catch (fbErr) {
        results.push({
          fileId: fbId,
          error: fbErr && fbErr.message ? fbErr.message : String(fbErr),
          errorStage: "fallback",
        });
      }
    }
  }

  return results;
}

/**
 * 特定フォームを取得
 * @param {string} formId
 * @return {Object|null} フォームオブジェクトまたはnull
 */
function Forms_getForm_(formId) {
  if (!formId) return null;

  var mapping = Forms_getMapping_();
  var mappingEntry = mapping[formId] || {};
  var fileId = mappingEntry.fileId;
  var driveFileUrlFromMap = mappingEntry.driveFileUrl;

  // URLのみ保持されている場合はそこからIDを抽出
  if (!fileId && driveFileUrlFromMap) {
    var parsedFromUrl = Forms_parseGoogleDriveUrl_(driveFileUrlFromMap);
    if (parsedFromUrl.type === "file") {
      fileId = parsedFromUrl.id;
    }
  }

  if (!fileId) return null;

  try {
    var file = DriveApp.getFileById(fileId);
    var content = file.getBlob().getDataAsString();
    var form = JSON.parse(content);

    // idはファイルに含めていないためマッピングから復元
    form.id = formId;

    // driveFileUrlがない場合はマッピング/ファイルから補完
    if (!form.driveFileUrl) {
      form.driveFileUrl = driveFileUrlFromMap || file.getUrl();
    }

    return form;
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
  var mappingEntry = mapping[formId] || {};
  var fileId = mappingEntry.fileId;

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
 * 複数フォームを削除（マッピング更新を1回で実施）
 * @param {Array<string>} formIds
 * @return {Object} { ok: boolean, deleted: number, errors: Array }
 */
function Forms_deleteForms_(formIds) {
  if (!formIds || !formIds.length) {
    throw new Error("Form IDs are required");
  }

  var ids = Array.isArray(formIds) ? formIds.slice() : [formIds];
  var mapping = Forms_getMapping_();
  var errors = [];
  var deleted = 0;

  ids.forEach(function(formId) {
    if (!formId) return;
    var entry = mapping[formId] || {};
    var fileId = entry.fileId;

    if (fileId) {
      try {
        var file = DriveApp.getFileById(fileId);
        file.setTrashed(true);
      } catch (err) {
        Logger.log("Error deleting file for form " + formId + ": " + err);
        errors.push({ formId: formId, error: err.message || String(err) });
      }
    }

    if (mapping.hasOwnProperty(formId)) {
      delete mapping[formId];
      deleted += 1;
    }
  });

  Forms_saveMapping_(mapping);

  return {
    ok: errors.length === 0,
    deleted: deleted,
    errors: errors
  };
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
  var nowSerial = Sheets_dateToSerial_(new Date());
  form.modifiedAt = nowSerial;
  form.modifiedAtUnixMs = nowSerial;

  return Forms_saveForm_(form);
}

/**
 * 複数フォームのアーカイブ状態を一括変更
 * @param {Array<string>} formIds
 * @param {boolean} archived
 * @return {Object} { ok: boolean, updated: number, errors: Array, forms: Array }
 */
function Forms_setFormsArchivedState_(formIds, archived) {
  if (!formIds || !formIds.length) {
    throw new Error("Form IDs are required");
  }

  var ids = Array.isArray(formIds) ? formIds.slice() : [formIds];
  var errors = [];
  var updated = 0;
  var updatedForms = [];
  var nowSerial = Sheets_dateToSerial_(new Date());

  ids.forEach(function(formId) {
    if (!formId) return;

    try {
      var form = Forms_getForm_(formId);
      if (!form) {
        errors.push({ formId: formId, error: "Form not found" });
        return;
      }

      form.archived = !!archived;
      form.modifiedAt = nowSerial;
      form.modifiedAtUnixMs = nowSerial;

      var result = Forms_saveForm_(form);
      if (result && result.ok) {
        updated += 1;
        updatedForms.push(result.form);
      } else {
        errors.push({ formId: formId, error: "Save failed" });
      }
    } catch (err) {
      Logger.log("Error updating archive state for form " + formId + ": " + err);
      errors.push({ formId: formId, error: err.message || String(err) });
    }
  });

  return {
    ok: errors.length === 0,
    updated: updated,
    errors: errors,
    forms: updatedForms
  };
}

// ========================================
// Public API Functions (google.script.run経由で呼び出し可能)
// ========================================

function nfbErrorToString_(err) {
  return (err && err.message) ? err.message : String(err);
}

function nfbFail_(err) {
  return { ok: false, error: nfbErrorToString_(err) };
}

function nfbSafeCall_(fn) {
  try {
    return fn();
  } catch (err) {
    return nfbFail_(err);
  }
}

/**
 * フォーム一覧を取得
 */
function nfbListForms(options) {
  return nfbSafeCall_(function() {
    var result = Forms_listForms_(options || {});
    return {
      ok: true,
      forms: result.forms || [],
      loadFailures: result.loadFailures || [],
    };
  });
}

/**
 * 特定フォームを取得
 */
function nfbGetForm(formId) {
  return nfbSafeCall_(function() {
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
  });
}

/**
 * フォームを保存（新規作成または更新）
 * @param {Object} payload - { form: Object, targetUrl: string }
 */
function nfbSaveForm(payload) {
  return nfbSafeCall_(function() {
    var form = payload.form || payload;
    var targetUrl = payload.targetUrl || null;
    var result = Forms_saveForm_(form, targetUrl);
    Logger.log("[nfbSaveForm] Result before return: " + JSON.stringify(result));
    Logger.log("[nfbSaveForm] Result.debugRawJsonBefore: " + result.debugRawJsonBefore);
    Logger.log("[nfbSaveForm] Result.debugRawJsonAfter: " + result.debugRawJsonAfter);
    Logger.log("[nfbSaveForm] Result.debugMappingStr: " + result.debugMappingStr);
    return result;
  });
}

/**
 * フォームを削除
 */
function nfbDeleteForm(formId) {
  return nfbSafeCall_(function() {
    return Forms_deleteForm_(formId);
  });
}

/**
 * 複数フォームを削除（まとめてプロパティ更新）
 */
function nfbDeleteForms(formIds) {
  return nfbSafeCall_(function() {
    return Forms_deleteForms_(formIds);
  });
}

/**
 * フォームをアーカイブ
 */
function nfbArchiveForm(formId) {
  return nfbSafeCall_(function() {
    return Forms_setFormArchivedState_(formId, true);
  });
}

/**
 * フォームのアーカイブを解除
 */
function nfbUnarchiveForm(formId) {
  return nfbSafeCall_(function() {
    return Forms_setFormArchivedState_(formId, false);
  });
}

/**
 * 複数フォームをまとめてアーカイブ
 * @param {Array<string>} formIds
 * @return {Object} { ok: boolean, updated: number, errors: Array, forms: Array }
 */
function nfbArchiveForms(formIds) {
  return nfbSafeCall_(function() {
    return Forms_setFormsArchivedState_(formIds, true);
  });
}

/**
 * 複数フォームのアーカイブをまとめて解除
 * @param {Array<string>} formIds
 * @return {Object} { ok: boolean, updated: number, errors: Array, forms: Array }
 */
function nfbUnarchiveForms(formIds) {
  return nfbSafeCall_(function() {
    return Forms_setFormsArchivedState_(formIds, false);
  });
}

/**
 * スプレッドシートの存在・権限を検証する
 * @param {string} spreadsheetIdOrUrl
 * @return {Object} { ok, spreadsheetId, title, canEdit, canView, sheetNames }
 */
function nfbValidateSpreadsheet(spreadsheetIdOrUrl) {
  try {
    if (!spreadsheetIdOrUrl) {
      return { ok: false, error: "Spreadsheet URL/ID is required" };
    }

    var idMatch = String(spreadsheetIdOrUrl).match(/\/d\/([a-zA-Z0-9-_]+)/);
    var spreadsheetId = idMatch && idMatch[1] ? idMatch[1] : String(spreadsheetIdOrUrl).trim();

    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheets = ss.getSheets();
    var file = DriveApp.getFileById(spreadsheetId);
    var userEmail = Session.getEffectiveUser().getEmail();

    var canEdit = false;
    var canView = true; // openByIdが成功した時点で閲覧は可
    try {
      var editors = file.getEditors();
      for (var i = 0; i < editors.length; i++) {
        if (editors[i].getEmail() === userEmail) {
          canEdit = true;
          break;
        }
      }
      if (!canEdit) {
        canEdit = file.getOwner().getEmail() === userEmail || file.getSharingPermission() === DriveApp.Permission.EDIT;
      }
    } catch (permErr) {
      Logger.log("[nfbValidateSpreadsheet] permission check failed: " + permErr);
    }

    return {
      ok: true,
      spreadsheetId: spreadsheetId,
      title: ss.getName(),
      sheetNames: sheets.map(function(sheet) { return sheet.getName(); }),
      canEdit: canEdit,
      canView: canView,
    };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
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

  // 重複検出用
  var existingDriveFileUrls = [];
  var existingFileIds = [];
  for (var fid in mapping) {
    if (!mapping.hasOwnProperty(fid)) continue;
    var entry = mapping[fid];
    if (entry && entry.driveFileUrl) {
      existingDriveFileUrls.push(entry.driveFileUrl);
    }
    if (entry && entry.fileId) {
      existingFileIds.push(entry.fileId);
    }
  }

  if (parsed.type === "file") {
    // ファイルの場合：URL重複チェック
    try {
      var file = DriveApp.getFileById(parsed.id);
      var fileName = file.getName();
      var fileUrl = file.getUrl();

      if (existingFileIds.indexOf(parsed.id) !== -1) {
        throw new Error("このファイルは既にプロパティサービスに登録されています");
      }
      if (existingDriveFileUrls.indexOf(fileUrl) !== -1) {
        throw new Error("このファイルは既にプロパティサービスに登録されています");
      }

      // .jsonファイルかチェック
      if (!fileName.toLowerCase().endsWith(".json")) {
        throw new Error("JSONファイルではありません: " + fileName);
      }

      var content = file.getBlob().getDataAsString();
      var formData = JSON.parse(content);

      // 重複判定はdriveFileUrlのみ
      forms.push(formData);
    } catch (err) {
      throw new Error("ファイルの読み込みに失敗しました: " + err.message);
    }
  } else if (parsed.type === "folder") {
    // フォルダの場合：フォルダ内の.jsonファイルを全て読み込む
    var parseFailed = 0;
    var totalFiles = 0;

    try {
      var folder = DriveApp.getFolderById(parsed.id);
      var files = folder.getFilesByType(MimeType.PLAIN_TEXT);

      while (files.hasNext()) {
        var file = files.next();
        var fileName = file.getName();
        var fileId = file.getId();
        var fileUrlInFolder = file.getUrl();

        // .jsonファイルのみ処理
        if (!fileName.toLowerCase().endsWith(".json")) {
          continue;
        }

        totalFiles += 1;

        // driveFileUrl / fileId が既に登録済みかチェック
        if (existingDriveFileUrls.indexOf(fileUrlInFolder) !== -1 || existingFileIds.indexOf(fileId) !== -1) {
          skipped += 1;
          Logger.log("Skipped (already registered driveFileUrl/fileId): " + fileName);
          continue;
        }

        try {
          var content = file.getBlob().getDataAsString();
          var formData = JSON.parse(content);

          // 有効なフォームデータかチェック（最低限nameとschemaがあるか）
          if (!formData || typeof formData !== "object") {
            Logger.log("Invalid form data in file: " + fileName);
            parseFailed += 1;
            continue;
          }

          // 重複判定はdriveFileUrlのみ
          forms.push(formData);
        } catch (parseErr) {
          Logger.log("Failed to parse JSON file: " + fileName + " - " + parseErr.message);
          parseFailed += 1;
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
    parseFailed: parseFailed || 0,
    totalFiles: totalFiles || 0,
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

/**
 * デバッグ用：Forms_getMapping_()を直接呼び出してその結果を返す
 * @return {Object} { ok: true, mapping: Object }
 */
function nfbDebugCallGetMapping() {
  try {
    var mapping = Forms_getMapping_();
    return {
      ok: true,
      mapping: mapping,
      totalForms: Object.keys(mapping).length,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
    };
  }
}

/**
 * デバッグ用：PropertiesServiceのマッピングを取得
 * @return {Object} { ok: true, mapping: Object, rawJson: string }
 */
function nfbDebugGetMapping() {
  try {
    var scriptProps = Forms_getScriptProps_();
    var userProps = Forms_getUserProps_();
    var rawJson = scriptProps.getProperty(FORMS_PROPERTY_KEY);
    var mapping = Forms_parseMappingJson_(rawJson, "script");
    var userRawJson = userProps.getProperty(FORMS_PROPERTY_KEY);
    var legacyInfo = { hasLegacy: false, legacyCount: 0, migratedCount: 0 };

    // 旧システムからのマイグレーション情報をチェック
    if (typeof GetFormUrls_ === "function") {
      try {
        var legacy = GetFormUrls_() || {};
        legacyInfo.hasLegacy = true;
        legacyInfo.legacyCount = Object.keys(legacy).length;
        legacyInfo.legacyForms = legacy; // レガシーフォームの内容も含める

        var migratedCount = 0;
        for (var formId in legacy) {
          if (legacy.hasOwnProperty(formId) && !mapping[formId]) {
            migratedCount++;
          }
        }
        legacyInfo.migratedCount = migratedCount;
      } catch (legacyErr) {
        legacyInfo.error = legacyErr.message;
      }
    }

    return {
      ok: true,
      mapping: mapping,
      rawJson: rawJson,
      userRawJson: userRawJson,
      totalForms: Object.keys(mapping).length,
      legacyInfo: legacyInfo,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
    };
  }
}

/**
 * フォーム内容からハッシュ値を計算（同じ内容なら同じハッシュ）
 * タイムスタンプとdriveFileUrlを除いた内容でハッシュを計算
 * @param {Object} form - フォームオブジェクト
 * @return {string} ハッシュ値（16進数、先頭16文字）
 */
function Forms_computeContentHash_(form) {
  // ハッシュ計算用にタイムスタンプとURL以外の内容を抽出
  var hashContent = {
    id: form.id || "",
    description: form.description || "",
    schema: form.schema || [],
    settings: form.settings || {},
    importantFields: form.importantFields || [],
    displayFieldSettings: form.displayFieldSettings || [],
    archived: !!form.archived,
    schemaVersion: form.schemaVersion || 1,
  };

  var contentStr = JSON.stringify(hashContent);
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, contentStr);

  // バイト配列を16進数文字列に変換
  var hexHash = rawHash.map(function(byte) {
    var hex = (byte < 0 ? byte + 256 : byte).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("");

  // 先頭16文字を返す（ファイル名として扱いやすい長さに）
  return hexHash.substring(0, 16);
}

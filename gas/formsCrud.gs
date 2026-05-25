/**
 * mapping エントリ ({ fileId, driveFileUrl, ... }) から fileId を解決する共通ヘルパ。
 * Forms / Analytics 両方の mapping store で使う。
 * entry.fileId → entry.driveFileUrl パース → どちらも取れなければ null。
 */
function Nfb_resolveFileIdFromEntry_(entry) {
  if (!entry) return null;
  if (entry.fileId) return entry.fileId;
  if (entry.driveFileUrl) {
    var parsed = Forms_parseGoogleDriveUrl_(entry.driveFileUrl);
    if (parsed && parsed.type === "file") return parsed.id;
  }
  return null;
}

// リクエスト単位のフォームキャッシュ。executeAction_ の冒頭で {} にリセットされる。
// 同一リクエスト内で Forms_getForm_ が複数回呼ばれる経路（保存=temporalMap+retention+
// spreadsheetId 解決 等）の Drive 読み取りを 1 回に集約する。
var __NFB_FORM_REQ_CACHE__ = {};

function Nfb_resetFormRequestCache_() {
  __NFB_FORM_REQ_CACHE__ = {};
}

// Forms_getForm_ の薄いラッパ。formId をキーにリクエストスコープでメモ化する。
function Nfb_getFormCached_(formId) {
  if (!formId) return null;
  if (Object.prototype.hasOwnProperty.call(__NFB_FORM_REQ_CACHE__, formId)) {
    return __NFB_FORM_REQ_CACHE__[formId];
  }
  var form = Forms_getForm_(formId);
  __NFB_FORM_REQ_CACHE__[formId] = form;
  return form;
}

// formId からレコード操作対象の { spreadsheetId, sheetName } を権威的に解決する。
// spreadsheetId が未設定/フォーム未解決なら null（呼び出し側でエラー化）。
function Nfb_resolveFormSheetTarget_(formId) {
  if (!formId) return null;
  var form = Nfb_getFormCached_(formId);
  if (!form || !form.settings) return null;
  var spreadsheetId = Model_normalizeSpreadsheetId_(form.settings.spreadsheetId);
  if (!spreadsheetId) return null;
  var sheetName = form.settings.sheetName || NFB_DEFAULT_SHEET_NAME;
  return { spreadsheetId: spreadsheetId, sheetName: sheetName };
}

function Forms_getForm_(formId) {
  if (!formId) return null;

  var mapping = Forms_getMapping_();
  var mappingEntry = mapping[formId] || {};
  var fileId = Nfb_resolveFileIdFromEntry_(mappingEntry);
  var driveFileUrlFromMap = mappingEntry.driveFileUrl;

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
    Logger.log("[Forms_getForm_] Error loading form " + formId + ": " + err);
    return null;
  }
}

function Forms_listForms_(options) {
  var includeArchived = !!(options && options.includeArchived);

  var mapping = Forms_getMapping_();

  var forms = [];
  var loadFailures = [];

  var pushFailure = function(id, fId, fName, fUrl, stage, errMsg) {
    loadFailures.push({
      id: id,
      fileId: fId,
      fileName: fName || null,
      driveFileUrl: fUrl || (fId ? Forms_buildDriveFileUrlFromId_(fId) : null),
      errorStage: stage,
      errorMessage: errMsg,
      lastTriedAt: new Date().toISOString(),
    });
  };

  // マッピングからfileIdリストを構築
  var fileIdMap = {}; // { fileId: formId }
  var formIdToMappingEntry = {}; // { formId: mappingEntry }

  for (var formId in mapping) {
    if (!mapping.hasOwnProperty(formId)) continue;
    var mappingEntry = mapping[formId] || {};
    var fileId = Nfb_resolveFileIdFromEntry_(mappingEntry);
    var driveFileUrlFromMap = mappingEntry.driveFileUrl;

    if (fileId) {
      fileIdMap[fileId] = formId;
      formIdToMappingEntry[formId] = mappingEntry;
    } else {
      // fileIdがない場合はエラーとして記録
      pushFailure(formId, null, null, driveFileUrlFromMap, "fileId", "プロパティサービスにファイルIDが登録されていません");
    }
  }

  var fileIds = Object.keys(fileIdMap);
  var titleCacheDirty = false;

  // Drive API v3 バッチリクエスト（最大100件ずつ）
  var BATCH_SIZE = NFB_DRIVE_API_BATCH_SIZE;

  for (var i = 0; i < fileIds.length; i += BATCH_SIZE) {
    var batchFileIds = fileIds.slice(i, i + BATCH_SIZE);

    // バッチリクエストで複数ファイルのメタデータとコンテンツを取得
    try {
      var batchResults = Forms_batchGetFiles_(batchFileIds);

      // バッチ結果を処理
      for (var j = 0; j < batchResults.length; j++) {
        var result = batchResults[j];
        var fileId = result.fileId;
        var formId = fileIdMap[fileId];
        var mappingEntry = formIdToMappingEntry[formId];

        if (result.error) {
          // エラーケース
          pushFailure(formId, fileId, result.fileName, mappingEntry.driveFileUrl, result.errorStage || "unknown", result.error);
        } else {
          // 成功ケース
          try {
            var form = JSON.parse(result.content);
            form.id = formId;

            // driveFileUrlがない場合はマッピング/ファイルから補完
            if (!form.driveFileUrl) {
              form.driveFileUrl = mappingEntry.driveFileUrl || result.fileUrl;
            }

            // Plan P4 γ: form.createdAt / modifiedAt は JST 文字列を canonical に。
            // 旧データ救済として Unix ms / シリアル値も受け付け、文字列化する。
            var createdAtSerial = Sheets_toUnixMs_(form.createdAt, true);
            var modifiedAtSerial = Sheets_toUnixMs_(form.modifiedAt, true);
            if (createdAtSerial !== null) form.createdAt = Sheets_formatJstString_(createdAtSerial);
            if (modifiedAtSerial !== null) form.modifiedAt = Sheets_formatJstString_(modifiedAtSerial);
            form.createdAtUnixMs = createdAtSerial;
            form.modifiedAtUnixMs = modifiedAtSerial;

            // タイトルキャッシュの遅延バックフィル
            var cachedTitle = mappingEntry && mappingEntry.title;
            var actualTitle = (form.settings && form.settings.formTitle) || "";
            if (actualTitle && cachedTitle !== actualTitle) {
              mapping[formId] = {
                fileId: mappingEntry.fileId || null,
                driveFileUrl: mappingEntry.driveFileUrl || null,
                title: actualTitle,
              };
              titleCacheDirty = true;
            }

            // アーカイブフィルタリング
            if (!includeArchived && form.archived) {
              Logger.log("[Forms_listForms_] Skipping archived form: " + formId);
              continue;
            }

            forms.push(form);
          } catch (parseErr) {
            pushFailure(formId, fileId, result.fileName, mappingEntry.driveFileUrl || result.fileUrl, "parse", nfbErrorToString_(parseErr));
          }
        }
      }
    } catch (batchErr) {
      Logger.log("[Forms_listForms_] Batch request failed: " + batchErr);
      // バッチ全体が失敗した場合は個別にフォールバック
      for (var k = 0; k < batchFileIds.length; k++) {
        var fbFileId = batchFileIds[k];
        var fbFormId = fileIdMap[fbFileId];
        pushFailure(fbFormId, fbFileId, null, formIdToMappingEntry[fbFormId].driveFileUrl, "batch", nfbErrorToString_(batchErr));
      }
    }
  }

  if (titleCacheDirty) {
    try {
      Forms_saveMapping_(mapping);
    } catch (errSaveMap) {
      Logger.log("[Forms_listForms_] Title cache backfill save failed: " + errSaveMap);
    }
  }

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
          error: nfbErrorToString_(readErr),
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
          error: nfbErrorToString_(fbErr),
          errorStage: "fallback",
        });
      }
    }
  }

  return results;
}


/**
 * 複数フォームを削除（Driveファイルは削除せず、紐付けのみ解除）
 * @param {Array<string>} formIds
 * @return {Object} { ok: boolean, deleted: number, errors: Array }
 */

function Forms_deleteForms_(formIds) {
  if (!formIds || !formIds.length) {
    throw new Error("Form IDs are required");
  }

  var ids = Nfb_normalizeIdList_(formIds);
  var mapping = Forms_getMapping_();
  var deleted = 0;

  ids.forEach(function(formId) {
    if (!formId) return;

    if (mapping.hasOwnProperty(formId)) {
      delete mapping[formId];
      deleted += 1;
    }
  });

  Forms_saveMapping_(mapping);

  return {
    ok: true,
    deleted: deleted,
    errors: []
  };
}


/**
 * 複数フォームの真偽状態フラグを一括変更する内部ヘルパ。
 *   field       : 設定するフィールド名（"archived" or "readOnly"）
 *   value       : 設定値
 *   clearField  : value が truthy のとき false に強制する相互排他フィールド名。
 *                 null / "" の場合は相互排他処理を行わない。
 * 返り値の形は元の Forms_setFormsArchivedState_ / Forms_setFormsReadOnlyState_ と同等。
 */
function Forms_setFormsStateField_(formIds, field, value, clearField) {
  if (!formIds || !formIds.length) {
    throw new Error("Form IDs are required");
  }

  var ids = Nfb_normalizeIdList_(formIds);
  var errors = [];
  var updated = 0;
  var updatedForms = [];
  var currentTsUnixMs = Sheets_dateToSerial_(new Date());
  var currentTsJst = Sheets_formatJstString_(currentTsUnixMs);
  var nextValue = !!value;
  var logTag = "[Forms_setFormsStateField_:" + field + "]";

  ids.forEach(function(formId) {
    if (!formId) return;

    try {
      var form = Forms_getForm_(formId);
      if (!form) {
        errors.push({ formId: formId, error: "Form not found" });
        return;
      }

      form[field] = nextValue;
      if (nextValue && clearField) {
        form[clearField] = false;
      }
      form.modifiedAt = currentTsJst;
      form.modifiedAtUnixMs = currentTsUnixMs;

      var result = Forms_saveForm_(form);
      if (result && result.ok) {
        updated += 1;
        updatedForms.push(result.form);
      } else {
        errors.push({ formId: formId, error: "Save failed" });
      }
    } catch (err) {
      Logger.log(logTag + " Error updating " + field + " state for form " + formId + ": " + err);
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

/**
 * 複数フォームのアーカイブ状態を一括変更
 * @param {Array<string>} formIds
 * @param {boolean} archived
 * @return {Object} { ok: boolean, updated: number, errors: Array, forms: Array }
 */
function Forms_setFormsArchivedState_(formIds, archived) {
  return Forms_setFormsStateField_(formIds, "archived", archived, "readOnly");
}

/**
 * 複数フォームの参照のみ状態を一括変更
 * @param {Array<string>} formIds
 * @param {boolean} readOnly
 * @return {Object} { ok: boolean, updated: number, errors: Array, forms: Array }
 */
function Forms_setFormsReadOnlyState_(formIds, readOnly) {
  return Forms_setFormsStateField_(formIds, "readOnly", readOnly, "archived");
}

/**
 * フォームをコピー（同じDriveフォルダに新IDで作成）
 * @param {string} formId - コピー元フォームID
 * @return {Object} Forms_saveForm_の戻り値（{ ok, fileId, fileUrl, form }）
 */
function Forms_copyForm_(formId) {
  if (!formId) throw new Error("formId is required");

  // 1. 元フォームを取得
  var sourceForm = Forms_getForm_(formId);
  if (!sourceForm) throw new Error("コピー元フォームが見つかりません: " + formId);

  // 2. 元ファイルの親フォルダURLを取得
  var mapping = Forms_getMapping_();
  var mappingEntry = mapping[formId] || {};
  var sourceFileId = mappingEntry.fileId;
  var parentFolderUrl = null;

  if (sourceFileId) {
    try {
      var sourceFile = DriveApp.getFileById(sourceFileId);
      var parents = sourceFile.getParents();
      if (parents.hasNext()) {
        var parentFolder = parents.next();
        parentFolderUrl = "https://drive.google.com/drive/folders/" + parentFolder.getId();
      }
    } catch (e) {
      Logger.log("[Forms_copyForm_] Failed to get parent folder: " + e);
    }
  }

  // 3. 新しいフォームデータを作成（新ID、タイトルに「（コピー）」付与）
  var newForm = JSON.parse(JSON.stringify(sourceForm));
  var newId = Nfb_generateFormId_();
  newForm.id = newId;

  var originalTitle = (sourceForm.settings && sourceForm.settings.formTitle) || "";
  newForm.settings = newForm.settings || {};
  // 同名フォームが既に存在するため、Forms_saveForm_ 内の auto-numbering で (1)(2)... が付く
  newForm.settings.formTitle = originalTitle;
  newForm.archived = false;
  newForm.readOnly = false;
  delete newForm.driveFileUrl;

  // 4. 同じフォルダに保存（フォルダが不明ならルートに保存）
  var saveMode = parentFolderUrl ? "copy_to_folder" : "copy_to_root";
  var result = Forms_saveForm_(newForm, parentFolderUrl, saveMode);

  return result;
}


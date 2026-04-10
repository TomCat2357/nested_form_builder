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
      pushFailure(formId, null, null, driveFileUrlFromMap, "fileId", "プロパティサービスにファイルIDが登録されていません");
    }
  }

  var fileIds = Object.keys(fileIdMap);

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

  var ids = Array.isArray(formIds) ? formIds.slice() : [formIds];
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
  var currentTs = Sheets_dateToSerial_(new Date());

  ids.forEach(function(formId) {
    if (!formId) return;

    try {
      var form = Forms_getForm_(formId);
      if (!form) {
        errors.push({ formId: formId, error: "Form not found" });
        return;
      }

      form.archived = !!archived;
      form.modifiedAt = currentTs;
      form.modifiedAtUnixMs = currentTs;

      var result = Forms_saveForm_(form);
      if (result && result.ok) {
        updated += 1;
        updatedForms.push(result.form);
      } else {
        errors.push({ formId: formId, error: "Save failed" });
      }
    } catch (err) {
      Logger.log("[Forms_setFormsArchivedState_] Error updating archive state for form " + formId + ": " + err);
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
  var newId = "f_" + Utilities.getUuid().replace(/-/g, "");
  newForm.id = newId;

  var originalTitle = (sourceForm.settings && sourceForm.settings.formTitle) || "";
  newForm.settings = newForm.settings || {};
  newForm.settings.formTitle = originalTitle + "（コピー）";
  newForm.archived = false;
  delete newForm.driveFileUrl;

  // 4. 同じフォルダに保存（フォルダが不明ならルートに保存）
  var saveMode = parentFolderUrl ? "copy_to_folder" : "copy_to_root";
  var result = Forms_saveForm_(newForm, parentFolderUrl, saveMode);

  return result;
}


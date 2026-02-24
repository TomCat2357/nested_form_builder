// Split from forms.gs



function Forms_importFromDrive_(url) {
  if (!url || typeof url !== "string") {
    throw new Error("URLが必要です");
  }

  var parsed = Forms_parseGoogleDriveUrl_(url);
  if (!parsed.type) {
    throw new Error("無効なGoogle Drive URLです");
  }

  var mapping = Forms_getMapping_();
  var forms = [];
  var skipped = 0;
  var parseFailed = 0;
  var totalFiles = 0;

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

      var content = file.getBlob().getDataAsString();
      var formData = JSON.parse(content);
      var normalizedFormData = Forms_normalizeImportedFormData_(formData);
      if (!normalizedFormData) {
        throw new Error("フォーム形式として無効なJSONです: " + fileName);
      }

      // fileId / fileUrl を付与して返す（コピーなしで元ファイルを管理するため）
      forms.push({ form: normalizedFormData, fileId: parsed.id, fileUrl: fileUrl });
    } catch (err) {
      throw new Error("ファイルの読み込みに失敗しました: " + err.message);
    }
  } else if (parsed.type === "folder") {
    // フォルダの場合：フォルダ内の.jsonファイルを全て読み込む
    try {
      var folder = DriveApp.getFolderById(parsed.id);
      // MIME type に依存せず、拡張子が .json のファイルを全件対象にする
      var files = folder.getFiles();

      while (files.hasNext()) {
        var file = files.next();
        var fileName = file.getName();
        var fileId = file.getId();
        var fileUrlInFolder = file.getUrl();

        // 拡張子またはMIMEタイプでJSONと判断できるファイルのみ処理
        var fileMimeType = file.getMimeType();
        var isJsonByExt = fileName.toLowerCase().endsWith(".json");
        var isJsonByMime = fileMimeType === "application/json" || fileMimeType === "text/plain";
        if (!isJsonByExt && !isJsonByMime) {
          continue;
        }

        totalFiles += 1;

        // driveFileUrl / fileId が既に登録済みかチェック
        if (existingDriveFileUrls.indexOf(fileUrlInFolder) !== -1 || existingFileIds.indexOf(fileId) !== -1) {
          skipped += 1;
          Logger.log("[Forms_importFromDrive_] Skipped (already registered driveFileUrl/fileId): " + fileName);
          continue;
        }

        try {
          var content = file.getBlob().getDataAsString();
          var formData = JSON.parse(content);
          var normalizedFormData = Forms_normalizeImportedFormData_(formData);
          if (!normalizedFormData) {
            Logger.log("[Forms_importFromDrive_] Invalid form data in file: " + fileName);
            parseFailed += 1;
            continue;
          }

          // fileId / fileUrl を付与して返す（コピーなしで元ファイルを管理するため）
          forms.push({ form: normalizedFormData, fileId: fileId, fileUrl: fileUrlInFolder });
        } catch (parseErr) {
          Logger.log("[Forms_importFromDrive_] Failed to parse JSON file: " + fileName + " - " + parseErr.message);
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

function Forms_registerImportedForm_(payload) {
  if (!payload || !payload.form || !payload.fileId) {
    throw new Error("form と fileId が必要です");
  }

  var form = Forms_normalizeImportedFormData_(payload.form);
  if (!form) {
    throw new Error("フォームJSONが有効な形式ではありません");
  }
  var fileId = payload.fileId;
  var fileUrl = payload.fileUrl || ("https://drive.google.com/file/d/" + fileId + "/view");

  // マッピングに登録（ファイルのコピーは作らない）
  var mapping = Forms_getMapping_();
  var formId = form.id ? String(form.id) : "";
  if (formId && mapping[formId] && mapping[formId].fileId && mapping[formId].fileId !== fileId) {
    Logger.log("[Forms_registerImportedForm_] Existing form id conflict. Assigning new id: " + formId);
    formId = "";
  }
  if (!formId) {
    formId = Forms_generateFormId_(mapping);
  }
  form.id = formId;
  form.driveFileUrl = fileUrl;

  mapping[formId] = { fileId: fileId, driveFileUrl: fileUrl };
  Forms_saveMapping_(mapping);

  // AddFormUrl_ にも登録（?form=xxx でアクセス可能にする）
  try {
    AddFormUrl_(formId, fileUrl);
  } catch (err) {
    Logger.log("[Forms_registerImportedForm_] AddFormUrl_ failed (non-critical): " + err);
  }

  return { ok: true, form: form, fileId: fileId, fileUrl: fileUrl };
}

/**
 * インポートフォーム登録API（コピーなし）
 * @param {Object} payload - { form: Object, fileId: string, fileUrl: string }
 * @return {Object} { ok: true, form, fileId, fileUrl }
 */


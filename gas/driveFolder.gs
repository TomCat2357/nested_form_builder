/**
 * driveFolder.gs
 * Driveフォルダ解決・作成・ファイル移動・削除
 */

function nfbResolveFolderFromInput_(input) {
  var normalizedInput = input === undefined || input === null ? "" : String(input).trim();
  if (!normalizedInput) {
    throw new Error("フォルダURLが指定されていません");
  }

  var parsed = Forms_parseGoogleDriveUrl_(normalizedInput);
  if (parsed.type !== "folder" || !parsed.id) {
    throw new Error("無効なフォルダURLです: " + normalizedInput);
  }

  try {
    return DriveApp.getFolderById(parsed.id);
  } catch (error) {
    throw new Error("フォルダへのアクセスに失敗しました: " + nfbErrorToString_(error));
  }
}

function nfbResolveFolderFromInputIfExists_(input) {
  var normalizedInput = input === undefined || input === null ? "" : String(input).trim();
  if (!normalizedInput) {
    return null;
  }

  var parsed = Forms_parseGoogleDriveUrl_(normalizedInput);
  if (parsed.type !== "folder" || !parsed.id) {
    return null;
  }

  try {
    var folder = DriveApp.getFolderById(parsed.id);
    if (folder && typeof folder.isTrashed === "function" && folder.isTrashed()) {
      return null;
    }
    return folder;
  } catch (error) {
    return null;
  }
}

function nfbResolveRootFolder_(driveSettings) {
  var rootUrl = driveSettings && driveSettings.rootFolderUrl ? String(driveSettings.rootFolderUrl).trim() : "";
  if (!rootUrl) {
    return DriveApp.getRootFolder();
  }
  return nfbResolveFolderFromInput_(rootUrl);
}

function nfbBuildDriveTemplateContext_(driveSettings, context) {
  return context || {
    responses: (driveSettings && driveSettings.responses) || {},
    fieldLabels: (driveSettings && driveSettings.fieldLabels) || {},
    fieldValues: (driveSettings && driveSettings.fieldValues) || {},
    formId: driveSettings && driveSettings.formId ? String(driveSettings.formId).trim() : "",
    recordId: driveSettings && driveSettings.recordId ? String(driveSettings.recordId).trim() : "",
    folderUrl: driveSettings && driveSettings.folderUrl ? String(driveSettings.folderUrl).trim() : "",
    now: new Date()
  };
}

function nfbResolveOrCreateFolder_(driveSettings, context) {
  var directFolderUrl = driveSettings && driveSettings.folderUrl ? String(driveSettings.folderUrl).trim() : "";
  if (directFolderUrl) {
    return nfbResolveFolderFromInput_(directFolderUrl);
  }

  var rootFolder = nfbResolveRootFolder_(driveSettings);

  var folderTemplate = driveSettings && driveSettings.folderNameTemplate ? String(driveSettings.folderNameTemplate).trim() : "";
  if (!folderTemplate) {
    return rootFolder;
  }

  var ctx = nfbBuildDriveTemplateContext_(driveSettings, context);

  var folderName = nfbResolveTemplate_(folderTemplate, ctx);
  if (!folderName) {
    return rootFolder;
  }

  // 同名フォルダが既にあればそれを返す
  var existingFolders = rootFolder.getFoldersByName(folderName);
  if (existingFolders.hasNext()) {
    return existingFolders.next();
  }

  return rootFolder.createFolder(folderName);
}

function nfbBuildRecordTempFolderName_(driveSettings) {
  var rawRecordId = driveSettings && driveSettings.recordId ? String(driveSettings.recordId).trim() : "";
  var safeRecordId = rawRecordId ? rawRecordId.replace(/[^A-Za-z0-9_-]/g, "_") : "record";
  return NFB_RECORD_TEMP_FOLDER_PREFIX + safeRecordId + "_" + Utilities.getUuid().slice(0, 8);
}

function nfbApplyFolderNameTemplateIfNeeded_(folder, driveSettings, context) {
  if (!folder || !nfbIsRecordTempFolder_(folder)) {
    return folder;
  }

  var folderTemplate = driveSettings && driveSettings.folderNameTemplate ? String(driveSettings.folderNameTemplate).trim() : "";
  if (!folderTemplate) {
    return folder;
  }

  var resolvedName = nfbResolveTemplate_(folderTemplate, nfbBuildDriveTemplateContext_(driveSettings, context));
  if (!resolvedName) {
    return folder;
  }

  var currentName = typeof folder.getName === "function" ? String(folder.getName() || "") : "";
  if (currentName !== resolvedName && typeof folder.setName === "function") {
    folder.setName(resolvedName);
  }
  return folder;
}

function nfbResolveUploadFolder_(driveSettings) {
  var context = nfbBuildDriveTemplateContext_(driveSettings);
  var directFolderUrl = driveSettings && driveSettings.folderUrl ? String(driveSettings.folderUrl).trim() : "";
  if (directFolderUrl) {
    var directFolder = nfbResolveFolderFromInput_(directFolderUrl);
    nfbApplyFolderNameTemplateIfNeeded_(directFolder, driveSettings, context);
    return {
      folder: directFolder,
      autoCreated: false
    };
  }

  var rootFolder = nfbResolveRootFolder_(driveSettings);
  var createdFolder = rootFolder.createFolder(nfbBuildRecordTempFolderName_(driveSettings));
  nfbApplyFolderNameTemplateIfNeeded_(createdFolder, driveSettings, context);
  return {
    folder: createdFolder,
    autoCreated: true
  };
}

function nfbIsRecordTempFolder_(folder) {
  if (!folder || typeof folder.getName !== "function") return false;
  var folderName = String(folder.getName() || "");
  return folderName.indexOf(NFB_RECORD_TEMP_FOLDER_PREFIX) === 0;
}

function nfbNormalizeDriveFileIds_(fileIds) {
  var seen = {};
  var normalized = [];
  var source = Array.isArray(fileIds) ? fileIds : [];
  for (var i = 0; i < source.length; i++) {
    var fileId = typeof source[i] === "string" ? source[i].trim() : "";
    if (!fileId || seen[fileId]) continue;
    seen[fileId] = true;
    normalized.push(fileId);
  }
  return normalized;
}

function nfbMoveFilesToFolder_(fileIds, folder) {
  var normalizedFileIds = nfbNormalizeDriveFileIds_(fileIds);
  for (var i = 0; i < normalizedFileIds.length; i++) {
    var file;
    try {
      file = DriveApp.getFileById(normalizedFileIds[i]);
    } catch (error) {
      throw new Error("ファイルへのアクセスに失敗しました: " + nfbErrorToString_(error));
    }
    if (file && typeof file.isTrashed === "function" && file.isTrashed()) {
      continue;
    }
    file.moveTo(folder);
  }
}

function nfbTrashFilesByIds_(fileIds) {
  var normalizedFileIds = nfbNormalizeDriveFileIds_(fileIds);
  for (var i = 0; i < normalizedFileIds.length; i++) {
    var file;
    try {
      file = DriveApp.getFileById(normalizedFileIds[i]);
    } catch (error) {
      throw new Error("ファイルへのアクセスに失敗しました: " + nfbErrorToString_(error));
    }
    file.setTrashed(true);
  }
}

function nfbTrashDriveFilesByIds(payload) {
  return nfbSafeCall_(function() {
    var fileIds = Array.isArray(payload) ? payload : (payload && payload.fileIds);
    var normalizedFileIds = nfbNormalizeDriveFileIds_(fileIds);
    nfbTrashFilesByIds_(normalizedFileIds);
    return {
      ok: true,
      trashedIds: normalizedFileIds
    };
  });
}

function nfbFinalizeRecordDriveFolder(payload) {
  return nfbSafeCall_(function() {
    var currentDriveFolderUrl = payload && payload.currentDriveFolderUrl ? String(payload.currentDriveFolderUrl).trim() : "";
    var inputDriveFolderUrl = payload && payload.inputDriveFolderUrl ? String(payload.inputDriveFolderUrl).trim() : "";
    var folderUrlToTrash = payload && payload.folderUrlToTrash ? String(payload.folderUrlToTrash).trim() : "";
    var currentFolder = currentDriveFolderUrl ? nfbResolveFolderFromInputIfExists_(currentDriveFolderUrl) : null;
    var inputFolder = inputDriveFolderUrl ? nfbResolveFolderFromInput_(inputDriveFolderUrl) : null;
    var targetFolder = inputFolder || currentFolder;

    nfbTrashFilesByIds_(payload && payload.trashFileIds);
    if (folderUrlToTrash) {
      var folderToTrash = nfbResolveFolderFromInputIfExists_(folderUrlToTrash);
      if (folderToTrash && typeof folderToTrash.setTrashed === "function") {
        folderToTrash.setTrashed(true);
      }
    }

    if (!targetFolder) {
      return {
        ok: true,
        folderUrl: ""
      };
    }

    if (inputFolder && currentFolder && inputFolder.getId() !== currentFolder.getId()) {
      nfbMoveFilesToFolder_(payload && payload.fileIds, inputFolder);
    }

    var isCurrentTarget = currentFolder && (!inputFolder || inputFolder.getId() === currentFolder.getId());
    if (isCurrentTarget && nfbIsRecordTempFolder_(currentFolder)) {
      var folderNameTemplate = payload && payload.folderNameTemplate ? String(payload.folderNameTemplate).trim() : "";
      if (folderNameTemplate) {
        var resolvedFolderName = nfbResolveTemplate_(folderNameTemplate, {
          responses: payload && payload.responses ? payload.responses : {},
          fieldLabels: payload && payload.fieldLabels ? payload.fieldLabels : {},
          fieldValues: payload && payload.fieldValues ? payload.fieldValues : {},
          recordId: payload && payload.recordId ? payload.recordId : "",
          now: new Date()
        });
        if (resolvedFolderName) {
          currentFolder.setName(resolvedFolderName);
        }
      }
    }

    return {
      ok: true,
      folderUrl: targetFolder.getUrl(),
      autoCreated: nfbIsRecordTempFolder_(targetFolder)
    };
  });
}

/**
 * フォルダ内の同名ファイルをゴミ箱に移動する（上書き前処理）
 * @param {Folder} folder
 * @param {string} fileName
 */
function nfbTrashExistingFile_(folder, fileName) {
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }
}

function nfbEscapeRegExp_(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nfbEscapeReplaceTextReplacement_(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "\\$");
}

function nfbEscapeJavaRegex_(str) {
  return String(str).replace(/([\\^$.|?*+()\[\]{}])/g, "\\$1");
}

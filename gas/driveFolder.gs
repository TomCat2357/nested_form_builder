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

  return nfbGetDriveFolderById_(parsed.id, "フォルダへのアクセスに失敗しました: ");
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
  var rootUrl = driveSettings ? Nfb_trimStr_(driveSettings.rootFolderUrl) : "";
  if (!rootUrl) {
    return DriveApp.getRootFolder();
  }
  return nfbResolveFolderFromInput_(rootUrl);
}

function nfbBuildDriveTemplateContext_(driveSettings, context) {
  if (context) return context;
  return nfbNormalizeRecordTemplateContext_({ driveSettings: driveSettings });
}

/**
 * driveSettings.folderUrl からフォルダを解決する（テンプレート展開込み）
 * @param {Object} driveSettings
 * @param {Object} context - nfbBuildDriveTemplateContext_ の戻り値
 * @return {Folder|null} 指定がなければ null
 */
function nfbResolveDirectFolder_(driveSettings, context) {
  var directFolderUrl = driveSettings ? Nfb_trimStr_(driveSettings.folderUrl) : "";
  if (!directFolderUrl) {
    return null;
  }
  if (directFolderUrl.indexOf("{") >= 0) {
    directFolderUrl = Nfb_trimStr_(nfbResolveTemplateTokens_(directFolderUrl, context));
  }
  if (!directFolderUrl) {
    return null;
  }
  return nfbResolveFolderFromInput_(directFolderUrl);
}

function nfbResolveOrCreateFolder_(driveSettings, context) {
  var ctx = nfbBuildDriveTemplateContext_(driveSettings, context);
  var directFolder = nfbResolveDirectFolder_(driveSettings, ctx);
  if (directFolder) {
    return directFolder;
  }
  // folderNameTemplate によるテンプレ命名は廃止済み（保存先は ID 由来固定）。直接指定が無ければ root を返す。
  return nfbResolveRootFolder_(driveSettings);
}

function nfbBuildRecordTempFolderName_(driveSettings) {
  var rawRecordId = driveSettings ? Nfb_trimStr_(driveSettings.recordId) : "";
  var safeRecordId = rawRecordId ? rawRecordId.replace(/[^A-Za-z0-9_-]/g, "_") : "record";
  // 永続モードは KEEP 接頭辞（システムから消さない印）で命名する。
  var prefix = (driveSettings && driveSettings.persistentFolder) ? NFB_RECORD_KEEP_FOLDER_PREFIX : NFB_RECORD_TEMP_FOLDER_PREFIX;
  return prefix + safeRecordId + "_" + Utilities.getUuid().slice(0, 8);
}

function nfbResolveUploadFolder_(driveSettings) {
  var context = nfbBuildDriveTemplateContext_(driveSettings);
  var directFolder = nfbResolveDirectFolder_(driveSettings, context);
  if (directFolder) {
    return {
      folder: directFolder,
      autoCreated: false
    };
  }

  var rootFolder = nfbResolveRootFolder_(driveSettings);
  // 明示指定（rootFolderUrl）が無く自動整理が ON のときは 06_upload_files をルートにする。
  if (!(driveSettings && driveSettings.rootFolderUrl)) {
    var stdUploadFolder = StdFolders_autoFileFolderOrNull_("upload");
    if (stdUploadFolder) rootFolder = stdUploadFolder;
  }
  var createdFolder = rootFolder.createFolder(nfbBuildRecordTempFolderName_(driveSettings));
  return {
    folder: createdFolder,
    autoCreated: true
  };
}

/**
 * 出力系（印刷様式/Gmail/PDF）のフォルダ解決を一元化する。
 * useTemporaryFolder が true のときは一時フォルダ経路、それ以外は通常経路。
 * 戻り値の形は両経路で同じ { folder, autoCreated }。
 * @param {Object} driveSettings
 * @param {Object=} context - 通常経路で nfbResolveOrCreateFolder_ に渡すテンプレートコンテキスト
 * @return {{folder: Folder, autoCreated: boolean}}
 */
function nfbResolveOutputFolder_(driveSettings, context) {
  if (driveSettings && driveSettings.useTemporaryFolder) {
    return nfbResolveUploadFolder_(driveSettings);
  }
  return {
    folder: nfbResolveOrCreateFolder_(driveSettings, context),
    autoCreated: false
  };
}

function nfbIsRecordTempFolder_(folder) {
  if (!folder || typeof folder.getName !== "function") return false;
  var folderName = String(folder.getName() || "");
  return folderName.indexOf(NFB_RECORD_TEMP_FOLDER_PREFIX) === 0;
}

// 永続（KEEP）フォルダ判定。システムからの trash（クリア/キャンセル/finalize 置換）から保護する印。
function nfbIsRecordKeepFolder_(folder) {
  if (!folder || typeof folder.getName !== "function") return false;
  return String(folder.getName() || "").indexOf(NFB_RECORD_KEEP_FOLDER_PREFIX) === 0;
}

// レコード自動作成フォルダ（TEMP / KEEP どちらも）か。autoCreated 判定に使う。
function nfbIsRecordManagedFolder_(folder) {
  return nfbIsRecordTempFolder_(folder) || nfbIsRecordKeepFolder_(folder);
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

// 未保存キャンセル時の巻き戻し用: URL/ID で指したアップロードフォルダをゴミ箱へ移す。
// セッションで新規生成されたフォルダ（中の追加ファイルごと）を捨てるために使う。無効 URL は no-op。
function nfbTrashDriveFolderByUrl(payload) {
  return nfbSafeCall_(function() {
    var url = payload && typeof payload.folderUrl === "string" ? payload.folderUrl.trim() : "";
    if (!url) return { ok: true, trashed: false };
    var folder = nfbResolveFolderFromInputIfExists_(url);
    // 永続（KEEP）フォルダはキャンセル/破棄でも消さない（レコード削除のパージ時のみ）。
    if (folder && nfbIsRecordKeepFolder_(folder)) return { ok: true, trashed: false };
    if (folder && typeof folder.setTrashed === "function") {
      folder.setTrashed(true);
      return { ok: true, trashed: true };
    }
    return { ok: true, trashed: false };
  });
}

function nfbFinalizeRecordDriveFolder(payload) {
  return nfbSafeCall_(function() {
    var currentDriveFolderUrl = payload ? Nfb_trimStr_(payload.currentDriveFolderUrl) : "";
    var inputDriveFolderUrl = payload ? Nfb_trimStr_(payload.inputDriveFolderUrl) : "";
    var folderUrlToTrash = payload ? Nfb_trimStr_(payload.folderUrlToTrash) : "";
    var persistentFolder = !!(payload && payload.persistentFolder);
    var recordId = payload ? Nfb_trimStr_(payload.recordId) : "";
    var currentFolder = currentDriveFolderUrl ? nfbResolveFolderFromInputIfExists_(currentDriveFolderUrl) : null;
    var inputFolder = inputDriveFolderUrl ? nfbResolveFolderFromInput_(inputDriveFolderUrl) : null;
    var targetFolder = inputFolder || currentFolder;

    nfbTrashFilesByIds_(payload && payload.trashFileIds);
    if (folderUrlToTrash) {
      var folderToTrash = nfbResolveFolderFromInputIfExists_(folderUrlToTrash);
      // 永続(KEEP)フォルダはシステムから消さない（パージのみ）。
      if (folderToTrash && !nfbIsRecordKeepFolder_(folderToTrash) && typeof folderToTrash.setTrashed === "function") {
        folderToTrash.setTrashed(true);
      }
    }

    // 永続モードでフォルダ未存在なら作成する（レコード作成/保存時の自動作成・KEEP 接頭辞）。
    if (!targetFolder && persistentFolder) {
      var created = nfbResolveUploadFolder_({ recordId: recordId, persistentFolder: true });
      targetFolder = created.folder;
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

    // アップロードフォルダ名はユーザー指定不可・ID 由来固定（record_<id>_<uuid>）。
    // 旧仕様の folderNameTemplate によるリネームは廃止し、論理パス解決の一意性を担保する。

    return {
      ok: true,
      folderUrl: targetFolder.getUrl(),
      // 論理パス再リンク用にフォルダ名（＝論理パスのフォルダ部）を返す。
      folderName: typeof targetFolder.getName === "function" ? targetFolder.getName() : "",
      autoCreated: nfbIsRecordManagedFolder_(targetFolder)
    };
  });
}

// 永続(persistentFolder)な fileUpload 列について、レコードのアップロードフォルダを確保する。
// folderUrl が空 or 失効（手動削除/ゴミ箱）していれば KEEP フォルダを作成し、セル(JSON)へ書き戻す。
// オープン時に呼ぶ「無ければ作る」用途。戻り: { ok, folders: { <列キー>: { folderUrl, folderName } } }。
function nfbEnsureRecordPersistentFolders(payload) {
  return nfbSafeCall_(function() {
    var formId = payload ? Nfb_trimStr_(payload.formId) : "";
    var recordId = payload ? Nfb_trimStr_(payload.recordId) : "";
    if (!formId || !recordId) return { ok: true, folders: {} };

    var form = Nfb_getFormCached_(formId);
    if (!form || !form.schema) return { ok: true, folders: {} };

    // 永続 fileUpload 列キー集合（列ビルダと同じ segment 関数＋Sheets_pathKey_ で columnPaths.key と一致）。
    var persistentKeys = {};
    var hasPersistent = false;
    nfbTraverseSchema_(form.schema, function(field, ctx) {
      if (field && field.type === "fileUpload" && field.persistentFolder === true) {
        persistentKeys[Sheets_pathKey_(ctx.pathSegments)] = true;
        hasPersistent = true;
      }
    }, {
      fieldSegment: Sheets_headerFieldSegmentWithFallback_,
      branchSegment: Sheets_headerBranchSegment_
    });
    if (!hasPersistent) return { ok: true, folders: {} };

    var sheet = Nfb_openFormSheet_(form);
    if (!sheet) return { ok: true, folders: {} };

    return WithScriptLock_("永続フォルダ確保", function() {
      var got = Sheets_getRecordById_(sheet, recordId);
      if (!got || !got.ok) return { ok: true, folders: {} };
      var sheetRow = NFB_DATA_START_ROW + got.rowIndex; // rowIndex は 0 始まりデータ行
      var lastColumn = sheet.getLastColumn();
      var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);
      var folders = {};
      var changed = false;

      for (var i = 0; i < columnPaths.length; i++) {
        var col = columnPaths[i];
        if (!persistentKeys[col.key]) continue;
        var cellRange = sheet.getRange(sheetRow, col.index + 1, 1, 1);
        var raw = cellRange.getValue();
        var obj = null;
        if (typeof raw === "string" && raw.replace(/^\s+/, "").charAt(0) === "{") {
          try { obj = JSON.parse(raw); } catch (e) { obj = null; }
        }
        if (Object.prototype.toString.call(obj) === "[object Array]") obj = { files: obj }; // 旧 files 配列形を救済
        else if (!obj || typeof obj !== "object") obj = { files: [] };
        if (Object.prototype.toString.call(obj.files) !== "[object Array]") obj.files = [];

        var folderUrl = (typeof obj.folderUrl === "string") ? obj.folderUrl.trim() : "";
        var live = folderUrl ? nfbResolveFolderFromInputIfExists_(folderUrl) : null;
        if (!live) {
          var created = nfbResolveUploadFolder_({ recordId: recordId, persistentFolder: true });
          obj.folderUrl = created.folder.getUrl();
          obj.folderName = created.folder.getName();
          cellRange.setValue(JSON.stringify(obj));
          changed = true;
          folders[col.key] = { folderUrl: obj.folderUrl, folderName: obj.folderName };
        } else {
          folders[col.key] = {
            folderUrl: folderUrl,
            folderName: (typeof obj.folderName === "string" && obj.folderName) ? obj.folderName : live.getName()
          };
        }
      }
      if (changed) { try { Sheets_touchSheetLastUpdated_(sheet, Date.now()); } catch (e) { /* no-op */ } }
      return { ok: true, folders: folders };
    });
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

function nfbEscapeReplaceTextReplacement_(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "\\$");
}

function nfbEscapeJavaRegex_(str) {
  return String(str).replace(/([\\^$.|?*+()\[\]{}])/g, "\\$1");
}

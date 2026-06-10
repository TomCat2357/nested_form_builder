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
  // 回答は日本ローカルタイムで保存する。新規スプレッドシートは作成ユーザーのロケール依存の
  // タイムゾーンになるため、明示的に Asia/Tokyo (= NFB_TZ) に揃える。
  try {
    ss.setSpreadsheetTimeZone(NFB_TZ);
  } catch (tzErr) {
    Logger.log("[Forms_createSpreadsheet_] setSpreadsheetTimeZone failed: " + tzErr);
  }
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
    // 自動整理が ON で明示指定が無い場合は 04_spreadsheets へ作成する。
    var stdSpreadsheetFolderId = StdFolders_autoFileFolderIdOrNull_("spreadsheets");
    var createdRoot = Forms_createSpreadsheet_(Forms_buildSpreadsheetName_(form), stdSpreadsheetFolderId);
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
    throw new Error("スプレッドシートにアクセスできません: " + nfbErrorToString_(err));
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
 * フォームをGoogle Driveに保存（新規作成または更新）
 * @param {Object} form - フォームオブジェクト
 * @param {string} targetUrl - 保存先URL（オプション）
 * @param {string} saveMode - 保存モード（auto|overwrite_existing|copy_to_root|copy_to_folder）
 * @return {Object} { ok: true, fileId, fileUrl, form }
 */

function Forms_saveForm_(form, targetUrl, saveMode) {
  return WithScriptLock_("フォーム保存", function() {
    if (!form) {
      throw new Error("Form data is required");
    }

    var requestedSaveMode = saveMode || "auto";
    // id ＝ Drive fileId へ統一。新規フォームは保存（ファイル作成）まで id を持たない。
    // 既存フォームは form.id（＝fileId）を上書き対象とする。
    var formId = form.id || "";
    // 渡された id（旧 ULID キーの可能性あり）を保持。保存後に fileId と異なれば旧キーを掃除する。
    var originalFormId = formId;
    var mapping = Forms_getMapping_();
    var mappingEntry = formId ? (mapping[formId] || {}) : {};
    // 既存ファイルを「fileId → 実体 URL → 論理パス folder + title アンカー」の順で解決する
    // （Forms_getForm_ / Forms_resolveFormRef_ と対称）。フロントの cache 優先取得が渡す stale な
    // id（実体とずれた fileId / 旧 f_... ULID）でも実体を引き当て、リネームを「別ファイル新規作成 /
    // 上書き失敗」ではなく「実体の上書き(setName)」へ倒して二重化・保存エラーを防ぐ。
    var existingFile = formId
      ? Forms_resolveFormFileOrNull_(Nfb_resolveFileIdFromEntry_(mappingEntry), formId, mappingEntry, form.driveFileUrl)
      : null;
    var existingFileId = existingFile
      ? existingFile.getId()
      : (Nfb_resolveFileIdFromEntry_(mappingEntry) || (formId || null));

    // タイトル正規化 + 衝突時の自動採番。衝突判定は「同一論理フォルダ内」に限定する。
    // 論理パス folder が違えば同名フォームを許容する（種類が違う Question / Dashboard とは
    // そもそも mapping が別物なので衝突しない）。
    var targetFolderPath = typeof form.folder === "string" ? Forms_normalizeFolderPath_(form.folder) : "";
    var existingTitles = [];
    for (var otherId in mapping) {
      if (!mapping.hasOwnProperty(otherId) || otherId === formId) continue;
      // 二重登録が残っている場合、同一物理ファイル（fileId）を指す別名キー（旧 ULID 等）も
      // 自分扱いで除外する。除外しないと自分の名前と衝突して誤って ` (1)` が付く。
      if (existingFileId && Nfb_resolveFileIdFromEntry_(mapping[otherId]) === existingFileId) continue;
      // 論理フォルダが異なるフォームは衝突対象外（フォルダが違えば同名可）。
      if (Forms_normalizeFolderPath_(mapping[otherId] && mapping[otherId].folder) !== targetFolderPath) continue;
      var t = mapping[otherId] && mapping[otherId].title;
      if (t) existingTitles.push(t);
    }
    var desiredTitle = (form.settings && form.settings.formTitle) || "";
    var uniqueTitle = Forms_makeUniqueFormTitle_(desiredTitle, existingTitles);
    form.settings = form.settings || {};
    form.settings.formTitle = uniqueTitle;

    var file;
    var fileId = null;
    var nowDate = new Date();
    var currentTs = Sheets_dateToSerial_(nowDate);
    var currentTsJst = Sheets_formatJstString_(currentTs);
    var createdAtSerial = Sheets_toUnixMs_(form.createdAt, true);
    if (createdAtSerial === null) {
      createdAtSerial = currentTs;
    }
    var createdAtJst = Sheets_formatJstString_(createdAtSerial) || currentTsJst;

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

    // 仮のフォームオブジェクトを作成（driveFileUrlなし）。id は保存後に fileId で確定する。
    var formWithTimestamp = {
      id: formId,
      description: form.description || "",
      folder: typeof form.folder === "string" ? form.folder : "",
      schema: form.schema || [],
      settings: settingsForSave,
      schemaHash: form.schemaHash || "",
      importantFields: form.importantFields || [],
      displayFieldSettings: form.displayFieldSettings || [],
      createdAt: createdAtJst,
      modifiedAt: currentTsJst,
      createdAtUnixMs: createdAtSerial,
      modifiedAtUnixMs: currentTs,
      archived: !!form.archived,
      readOnly: !!form.readOnly,
      childOnly: !!form.childOnly,
      schemaVersion: form.schemaVersion || 1,
    };

    // formLink の childFormPath を中央辞書から導出して冗長保存（stamp）する。リンク切れ時の復旧アンカー。
    try { StdFolders_stampRefPaths_(formWithTimestamp, "forms"); }
    catch (errStamp) { Logger.log("[Forms_saveForm_] stampRefPaths failed: " + nfbErrorToString_(errStamp)); }

    var content = JSON.stringify(formWithTimestamp, null, 2);
    // ファイル名 ＝ 一意化済みタイトル（名前 ＝ Drive ファイル名 へ統一するため uniqueTitle を権威とする）。
    var fileName = uniqueTitle.substring(0, 100) + ".json";

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
        // 既に解決済みの実体があれば再取得を避けて再利用する（同一 fileId のとき）。
        file = (existingFile && overwriteFileId === existingFile.getId())
          ? existingFile
          : DriveApp.getFileById(overwriteFileId);
      } catch (errOpenFile) {
        throw new Error("[save-stage=open-file] ファイルにアクセスできません. formId=" + form.id + ", fileId=" + overwriteFileId + ", saveMode=" + effectiveSaveMode + ", error=" + nfbErrorToString_(errOpenFile));
      }

      try {
        // 名前を変えたら Drive ファイル名も追従させる（safeTitle.json へリネーム）。
        if (file.getName() !== fileName) file.setName(fileName);
        file.setContent(content);
        fileId = overwriteFileId;
        // folder が変わっていれば物理フォルダ（01_forms 配下）へも移動（既に正しい親なら no-op）。
        var overwriteFolderPath = typeof form.folder === "string" ? Forms_normalizeFolderPath_(form.folder) : "";
        FormsDrive_moveFormFileToPath_(overwriteFileId, overwriteFolderPath);
      } catch (errWriteFile) {
        throw new Error("[save-stage=write-file] ファイル更新に失敗しました. formId=" + form.id + ", fileId=" + overwriteFileId + ", saveMode=" + effectiveSaveMode + ", error=" + nfbErrorToString_(errWriteFile));
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
        throw new Error("[save-stage=create-in-folder] 指定フォルダへの保存に失敗しました. formId=" + form.id + ", folderId=" + parsedTarget.id + ", saveMode=" + effectiveSaveMode + ", error=" + nfbErrorToString_(errCreateInFolder));
      }
    } else if (effectiveSaveMode === "copy_to_root") {
      try {
        // 自動整理が ON で明示指定が無い場合は form.folder に対応する物理フォルダ（01_forms 配下）へ
        // 作成する。folder 未指定なら 01_forms 直下、解決不能ならマイドライブ直下。
        var formFolderPath = typeof form.folder === "string" ? Forms_normalizeFolderPath_(form.folder) : "";
        var targetFolder = FormsDrive_ensureFolderForPath_(formFolderPath);
        file = targetFolder
          ? targetFolder.createFile(fileName, content, MimeType.PLAIN_TEXT)
          : DriveApp.createFile(fileName, content, MimeType.PLAIN_TEXT);
        fileId = file.getId();
      } catch (errCreateInRoot) {
        throw new Error("[save-stage=create-in-root] マイドライブ直下への保存に失敗しました. formId=" + form.id + ", saveMode=" + effectiveSaveMode + ", error=" + nfbErrorToString_(errCreateInRoot));
      }
    } else {
      throw new Error("[save-stage=resolve-mode] 未知のsaveModeです: " + effectiveSaveMode + ", formId=" + form.id);
    }

    if (!file && fileId) {
      try {
        file = DriveApp.getFileById(fileId);
      } catch (errReload) {
        throw new Error("[save-stage=reload-file] 保存後ファイルの再取得に失敗しました. formId=" + form.id + ", fileId=" + fileId + ", saveMode=" + effectiveSaveMode + ", error=" + nfbErrorToString_(errReload));
      }
    }

    var fileUrl = null;
    try {
      fileUrl = file.getUrl();
    } catch (errGetUrl) {
      throw new Error("[save-stage=get-url] ファイルURLの取得に失敗しました. formId=" + form.id + ", fileId=" + fileId + ", saveMode=" + effectiveSaveMode + ", error=" + nfbErrorToString_(errGetUrl));
    }
    // id ＝ Drive fileId へ確定。名前 ＝ ファイル名（uniqueTitle）へ揃える。
    formId = fileId;
    formWithTimestamp.id = fileId;
    formWithTimestamp.driveFileUrl = fileUrl;
    formWithTimestamp.settings = (formWithTimestamp.settings && typeof formWithTimestamp.settings === "object" && !Array.isArray(formWithTimestamp.settings)) ? formWithTimestamp.settings : {};
    formWithTimestamp.settings.formTitle = uniqueTitle;

    // 保存する .json は「自分自身の id も名前（ファイル名）も持たない」運用とする。
    // id と settings.formTitle を除外して書き出す。読み込み時に fileId / ファイル名から復元する。
    var formForFile = {};
    for (var key in formWithTimestamp) {
      if (!formWithTimestamp.hasOwnProperty(key)) continue;
      if (key === "id") continue;
      if (key === "schema") {
        formForFile.schema = Forms_stripSchemaIds_(formWithTimestamp.schema);
      } else if (key === "settings") {
        var settingsCopy = {};
        var srcSettings = formWithTimestamp.settings || {};
        for (var sk in srcSettings) {
          if (srcSettings.hasOwnProperty(sk) && sk !== "formTitle") settingsCopy[sk] = srcSettings[sk];
        }
        formForFile.settings = settingsCopy;
      } else {
        formForFile[key] = formWithTimestamp[key];
      }
    }
    formForFile.driveFileUrl = fileUrl;

    // driveFileUrlを含めて再度ファイルに書き込み（id・名前なし）
    try {
      file.setContent(JSON.stringify(formForFile, null, 2));
    } catch (errWriteFinal) {
      throw new Error("[save-stage=final-write] driveFileUrl反映書き込みに失敗しました. formId=" + fileId + ", fileId=" + fileId + ", saveMode=" + effectiveSaveMode + ", error=" + nfbErrorToString_(errWriteFinal));
    }

    // 旧 id キー（移行前の ULID 等）が今回確定した fileId と異なる場合は除去し、
    // 同一ファイルを指すキーが 2 つ残る二重登録を防ぐ（Analytics_saveTemplate_ と対称）。
    // existingFileId は旧キーのエントリから解決済みなので、この delete は fileId 確定後に行う。
    if (originalFormId && originalFormId !== fileId && mapping.hasOwnProperty(originalFormId)) {
      delete mapping[originalFormId];
    }
    // マッピング（fileId キー）を更新（title / 論理パス folder を中央辞書へ第一級保存）
    mapping[fileId] = {
      fileId: fileId,
      driveFileUrl: fileUrl,
      title: uniqueTitle,
      folder: typeof form.folder === "string" ? Forms_normalizeFolderPath_(form.folder) : ""
    };
    Forms_saveMapping_(mapping);

    // 認証用URLマップにも登録（?form=xxx でアクセス可能にする）
    try {
      AddFormUrl_(fileId, fileUrl);
    } catch (err) {
      Logger.log("[Forms_saveForm_] AddFormUrl_ failed (non-critical): " + err);
    }

    // 保存後: formLink フィールドの参照先（子フォーム）に ⓪①②③ 整合を適用し、
    // ②③ で子フォーム id が変わったら親スキーマの childFormId を追従させる
    // （Analytics_saveTemplate_ と対称）。base 未設定なら no-op。
    var referenceSync = null;
    try {
      referenceSync = StdFolders_alignReferencesOnSave_("forms", fileId);
      if (referenceSync && referenceSync.remap) {
        StdFolders_applyRemapToRefs_(formWithTimestamp, "forms", referenceSync.remap);
      }
    } catch (errRefSync) {
      Logger.log("[Forms_saveForm_] alignReferencesOnSave failed: " + nfbErrorToString_(errRefSync));
    }

    return {
      ok: true,
      fileId: fileId,
      fileUrl: fileUrl,
      saveMode: effectiveSaveMode,
      form: formWithTimestamp,
    };
  });
}

/**
 * 全フォームを取得（Drive API v3 バッチリクエスト最適化版）
 * @param {Object} options - { includeArchived: boolean }
 * @return {Array} フォーム配列
 */

function Dashboards_normalize_(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("ダッシュボード定義が不正です");
  }

  var normalized = {};
  normalized.id = raw.id ? String(raw.id) : "";
  normalized.schemaVersion = Number.isFinite(raw.schemaVersion) ? raw.schemaVersion : DASHBOARDS_SCHEMA_VERSION;
  normalized.description = typeof raw.description === "string" ? raw.description : "";

  var settings = (raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings)) ? raw.settings : {};
  var copiedSettings = {};
  for (var sKey in settings) {
    if (!settings.hasOwnProperty(sKey)) continue;
    copiedSettings[sKey] = settings[sKey];
  }
  if (typeof copiedSettings.title !== "string") {
    copiedSettings.title = "";
  }
  normalized.settings = copiedSettings;

  normalized.templateUrl = typeof raw.templateUrl === "string" ? raw.templateUrl : "";
  normalized.templateFileId = typeof raw.templateFileId === "string" ? raw.templateFileId : "";

  normalized.dataSources = Array.isArray(raw.dataSources) ? raw.dataSources : [];
  normalized.queries = Array.isArray(raw.queries) ? raw.queries : [];
  normalized.widgets = Array.isArray(raw.widgets) ? raw.widgets : [];
  normalized.layout = Array.isArray(raw.layout) ? raw.layout : [];

  normalized.archived = !!raw.archived;
  normalized.readOnly = !!raw.readOnly;

  if (raw.driveFileUrl) normalized.driveFileUrl = String(raw.driveFileUrl);
  if (Number.isFinite(raw.createdAtUnixMs)) normalized.createdAtUnixMs = raw.createdAtUnixMs;
  if (Number.isFinite(raw.modifiedAtUnixMs)) normalized.modifiedAtUnixMs = raw.modifiedAtUnixMs;

  return normalized;
}

function Dashboards_buildDashboardName_(dashboard) {
  var base = "";
  if (dashboard && dashboard.settings && dashboard.settings.title) {
    base = String(dashboard.settings.title || "");
  }
  if (!base && dashboard && dashboard.id) {
    base = "dashboard_" + dashboard.id;
  }
  base = String(base || "Nested Form Builder Dashboard");
  base = base.replace(/[\r\n]/g, " ").replace(/\//g, "-").trim();
  if (!base) {
    base = "Nested Form Builder Dashboard";
  }
  var name = "NFB Dashboard - " + base;
  if (name.length > 120) {
    name = name.substring(0, 120);
  }
  return name;
}

function Dashboards_extractTemplateFileId_(templateUrl) {
  if (!templateUrl) return "";
  var parsed = Forms_parseGoogleDriveUrl_(templateUrl);
  return (parsed && parsed.type === "file" && parsed.id) ? parsed.id : "";
}

function Dashboards_saveDashboard_(dashboard, targetUrl, saveMode) {
  return WithScriptLock_("ダッシュボード保存", function() {
    if (!dashboard) {
      throw new Error("ダッシュボード定義が必要です");
    }

    var requestedSaveMode = saveMode || "auto";
    var mapping = Dashboards_getMapping_();
    var inputId = dashboard.id ? String(dashboard.id) : "";
    var dashboardId = inputId || Dashboards_generateDashboardId_(mapping);
    var mappingEntry = mapping[dashboardId] || {};
    var existingFileId = mappingEntry.fileId;

    var nowMs = new Date().getTime();
    var createdAtUnixMs = Number.isFinite(dashboard.createdAtUnixMs) ? dashboard.createdAtUnixMs : nowMs;

    var dashboardForFile = Dashboards_normalize_({
      id: dashboardId,
      schemaVersion: dashboard.schemaVersion || DASHBOARDS_SCHEMA_VERSION,
      description: dashboard.description || "",
      settings: dashboard.settings || {},
      templateUrl: dashboard.templateUrl || "",
      templateFileId: dashboard.templateFileId || Dashboards_extractTemplateFileId_(dashboard.templateUrl || ""),
      dataSources: dashboard.dataSources || [],
      queries: dashboard.queries || [],
      widgets: dashboard.widgets || [],
      layout: dashboard.layout || [],
      archived: !!dashboard.archived,
      readOnly: !!dashboard.readOnly,
      createdAtUnixMs: createdAtUnixMs,
      modifiedAtUnixMs: nowMs,
    });

    var fileTitle = (dashboardForFile.settings && dashboardForFile.settings.title) || dashboardForFile.description || dashboardId;
    var safeTitle = String(fileTitle).replace(/[\\/:*?"<>|]/g, "_").substring(0, 100);
    var fileName = safeTitle + ".dashboard.json";

    var parsedTarget = null;
    if (targetUrl) {
      parsedTarget = Forms_parseGoogleDriveUrl_(targetUrl);
      if (!parsedTarget.type) {
        throw new Error("[dashboards-save-stage=parse-target] 無効なGoogle Drive URLです. dashboardId=" + dashboardId);
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

    var file = null;
    var fileId = null;
    var contentForFile = null;

    var formForFile = {};
    for (var key in dashboardForFile) {
      if (!dashboardForFile.hasOwnProperty(key)) continue;
      if (key === "id") continue;
      formForFile[key] = dashboardForFile[key];
    }
    contentForFile = JSON.stringify(formForFile, null, 2);

    if (effectiveSaveMode === "overwrite_existing") {
      var overwriteFileId = null;
      if (parsedTarget && parsedTarget.type === "file") {
        overwriteFileId = parsedTarget.id;
      } else if (existingFileId) {
        overwriteFileId = existingFileId;
      }

      if (!overwriteFileId) {
        throw new Error("[dashboards-save-stage=resolve-overwrite-target] 上書き保存先のファイルIDを解決できません. dashboardId=" + dashboardId);
      }

      try {
        file = DriveApp.getFileById(overwriteFileId);
      } catch (errOpenFile) {
        throw new Error("[dashboards-save-stage=open-file] ファイルにアクセスできません. dashboardId=" + dashboardId + ", fileId=" + overwriteFileId + ", error=" + nfbErrorToString_(errOpenFile));
      }

      try {
        file.setContent(contentForFile);
        fileId = overwriteFileId;
      } catch (errWriteFile) {
        throw new Error("[dashboards-save-stage=write-file] ファイル更新に失敗しました. dashboardId=" + dashboardId + ", fileId=" + overwriteFileId + ", error=" + nfbErrorToString_(errWriteFile));
      }
    } else if (effectiveSaveMode === "copy_to_folder") {
      if (!parsedTarget || parsedTarget.type !== "folder") {
        throw new Error("[dashboards-save-stage=resolve-folder-target] copy_to_folder にはフォルダURLが必要です. dashboardId=" + dashboardId);
      }
      try {
        var folder = DriveApp.getFolderById(parsedTarget.id);
        file = folder.createFile(fileName, contentForFile, MimeType.PLAIN_TEXT);
        fileId = file.getId();
      } catch (errCreateInFolder) {
        throw new Error("[dashboards-save-stage=create-in-folder] 指定フォルダへの保存に失敗しました. dashboardId=" + dashboardId + ", folderId=" + parsedTarget.id + ", error=" + nfbErrorToString_(errCreateInFolder));
      }
    } else if (effectiveSaveMode === "copy_to_root") {
      try {
        file = DriveApp.createFile(fileName, contentForFile, MimeType.PLAIN_TEXT);
        fileId = file.getId();
      } catch (errCreateInRoot) {
        throw new Error("[dashboards-save-stage=create-in-root] マイドライブ直下への保存に失敗しました. dashboardId=" + dashboardId + ", error=" + nfbErrorToString_(errCreateInRoot));
      }
    } else {
      throw new Error("[dashboards-save-stage=resolve-mode] 未知のsaveModeです: " + effectiveSaveMode + ", dashboardId=" + dashboardId);
    }

    var fileUrl = null;
    try {
      fileUrl = file.getUrl();
    } catch (errGetUrl) {
      throw new Error("[dashboards-save-stage=get-url] ファイルURLの取得に失敗しました. dashboardId=" + dashboardId + ", error=" + nfbErrorToString_(errGetUrl));
    }
    dashboardForFile.driveFileUrl = fileUrl;

    var formForFileFinal = {};
    for (var k2 in dashboardForFile) {
      if (!dashboardForFile.hasOwnProperty(k2)) continue;
      if (k2 === "id") continue;
      formForFileFinal[k2] = dashboardForFile[k2];
    }
    formForFileFinal.driveFileUrl = fileUrl;
    try {
      file.setContent(JSON.stringify(formForFileFinal, null, 2));
    } catch (errWriteFinal) {
      throw new Error("[dashboards-save-stage=final-write] driveFileUrl反映書き込みに失敗しました. dashboardId=" + dashboardId + ", error=" + nfbErrorToString_(errWriteFinal));
    }

    mapping[dashboardId] = { fileId: fileId, driveFileUrl: fileUrl };
    Dashboards_saveMapping_(mapping);

    return {
      ok: true,
      dashboardId: dashboardId,
      fileId: fileId,
      fileUrl: fileUrl,
      saveMode: effectiveSaveMode,
      dashboard: dashboardForFile,
    };
  });
}

function Dashboards_getDashboard_(dashboardId) {
  if (!dashboardId) return null;

  var mapping = Dashboards_getMapping_();
  var mappingEntry = mapping[dashboardId] || {};
  var fileId = mappingEntry.fileId;
  var driveFileUrlFromMap = mappingEntry.driveFileUrl;

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
    var raw = JSON.parse(content);
    raw.id = dashboardId;
    if (!raw.driveFileUrl) {
      raw.driveFileUrl = driveFileUrlFromMap || file.getUrl();
    }
    return Dashboards_normalize_(raw);
  } catch (err) {
    Logger.log("[Dashboards_getDashboard_] Error loading dashboard " + dashboardId + ": " + err);
    return null;
  }
}

function Dashboards_listDashboards_(options) {
  var includeArchived = !!(options && options.includeArchived);

  var mapping = Dashboards_getMapping_();
  var dashboards = [];
  var loadFailures = [];

  var pushFailure = function(id, fId, fName, fUrl, stage, errMsg) {
    loadFailures.push({
      id: id,
      fileId: fId,
      fileName: fName || null,
      driveFileUrl: fUrl || (fId ? Dashboards_buildDriveFileUrlFromId_(fId) : null),
      errorStage: stage,
      errorMessage: errMsg,
      lastTriedAt: new Date().toISOString(),
    });
  };

  for (var dashboardId in mapping) {
    if (!mapping.hasOwnProperty(dashboardId)) continue;
    var mappingEntry = mapping[dashboardId] || {};
    var fileId = mappingEntry.fileId;
    var driveFileUrlFromMap = mappingEntry.driveFileUrl;

    if (!fileId && driveFileUrlFromMap) {
      var parsedFromUrl = Forms_parseGoogleDriveUrl_(driveFileUrlFromMap);
      if (parsedFromUrl.type === "file") {
        fileId = parsedFromUrl.id;
      }
    }

    if (!fileId) {
      pushFailure(dashboardId, null, null, driveFileUrlFromMap, "fileId", "プロパティサービスにファイルIDが登録されていません");
      continue;
    }

    try {
      var file = DriveApp.getFileById(fileId);
      var content = file.getBlob().getDataAsString();
      var raw = JSON.parse(content);
      raw.id = dashboardId;
      if (!raw.driveFileUrl) {
        raw.driveFileUrl = driveFileUrlFromMap || file.getUrl();
      }
      var normalized = Dashboards_normalize_(raw);

      if (!includeArchived && normalized.archived) {
        continue;
      }
      dashboards.push(normalized);
    } catch (err) {
      pushFailure(dashboardId, fileId, null, driveFileUrlFromMap, "read", nfbErrorToString_(err));
    }
  }

  return {
    dashboards: dashboards,
    loadFailures: loadFailures,
  };
}

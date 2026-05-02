function Dashboards_normalizeImportedDashboardData_(rawDashboard) {
  if (!rawDashboard || typeof rawDashboard !== "object" || Array.isArray(rawDashboard)) {
    return null;
  }
  try {
    return Dashboards_normalize_(rawDashboard);
  } catch (err) {
    Logger.log("[Dashboards_normalizeImportedDashboardData_] normalize failed: " + err);
    return null;
  }
}

function Dashboards_importFromDrive_(url) {
  if (!url || typeof url !== "string") {
    throw new Error("URLが必要です");
  }

  var parsed = Forms_parseGoogleDriveUrl_(url);
  if (!parsed.type) {
    throw new Error("無効なGoogle Drive URLです");
  }

  var mapping = Dashboards_getMapping_();
  var dashboards = [];
  var skipped = 0;
  var parseFailed = 0;
  var totalFiles = 0;

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
      var dashboardData = JSON.parse(content);
      var normalized = Dashboards_normalizeImportedDashboardData_(dashboardData);
      if (!normalized) {
        throw new Error("ダッシュボード形式として無効なJSONです: " + fileName);
      }
      dashboards.push({ dashboard: normalized, fileId: parsed.id, fileUrl: fileUrl });
    } catch (err) {
      throw new Error("ファイルの読み込みに失敗しました: " + err.message);
    }
  } else if (parsed.type === "folder") {
    try {
      var folder = DriveApp.getFolderById(parsed.id);
      var files = folder.getFiles();

      while (files.hasNext()) {
        var folderFile = files.next();
        var folderFileName = folderFile.getName();
        var folderFileId = folderFile.getId();
        var folderFileUrl = folderFile.getUrl();

        var folderFileMime = folderFile.getMimeType();
        var isJsonByExt = folderFileName.toLowerCase().endsWith(".json");
        var isJsonByMime = folderFileMime === "application/json" || folderFileMime === "text/plain";
        if (!isJsonByExt && !isJsonByMime) {
          continue;
        }

        totalFiles += 1;

        if (existingDriveFileUrls.indexOf(folderFileUrl) !== -1 || existingFileIds.indexOf(folderFileId) !== -1) {
          skipped += 1;
          continue;
        }

        try {
          var folderContent = folderFile.getBlob().getDataAsString();
          var folderDashboardData = JSON.parse(folderContent);
          var folderNormalized = Dashboards_normalizeImportedDashboardData_(folderDashboardData);
          if (!folderNormalized) {
            parseFailed += 1;
            continue;
          }
          dashboards.push({ dashboard: folderNormalized, fileId: folderFileId, fileUrl: folderFileUrl });
        } catch (parseErr) {
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
    dashboards: dashboards,
    skipped: skipped,
    parseFailed: parseFailed || 0,
    totalFiles: totalFiles || 0,
  };
}

function Dashboards_registerImportedDashboard_(payload) {
  if (!payload || !payload.dashboard || !payload.fileId) {
    throw new Error("dashboard と fileId が必要です");
  }

  var dashboard = Dashboards_normalizeImportedDashboardData_(payload.dashboard);
  if (!dashboard) {
    throw new Error("ダッシュボードJSONが有効な形式ではありません");
  }
  var fileId = payload.fileId;
  var fileUrl = payload.fileUrl || ("https://drive.google.com/file/d/" + fileId + "/view");

  var mapping = Dashboards_getMapping_();
  var dashboardId = dashboard.id ? String(dashboard.id) : "";
  if (dashboardId && mapping[dashboardId] && mapping[dashboardId].fileId && mapping[dashboardId].fileId !== fileId) {
    Logger.log("[Dashboards_registerImportedDashboard_] Existing id conflict. Assigning new id: " + dashboardId);
    dashboardId = "";
  }
  if (!dashboardId) {
    dashboardId = Dashboards_generateDashboardId_(mapping);
  }
  dashboard.id = dashboardId;
  dashboard.driveFileUrl = fileUrl;

  mapping[dashboardId] = { fileId: fileId, driveFileUrl: fileUrl };
  Dashboards_saveMapping_(mapping);

  return { ok: true, dashboard: dashboard, fileId: fileId, fileUrl: fileUrl };
}

function Dashboards_deleteDashboards_(dashboardIds) {
  var ids = Dashboards_normalizeIds_(dashboardIds);
  if (!ids.length) {
    throw new Error("Dashboard IDs are required");
  }

  var mapping = Dashboards_getMapping_();
  var deleted = 0;

  for (var i = 0; i < ids.length; i++) {
    var dashboardId = ids[i];
    if (mapping.hasOwnProperty(dashboardId)) {
      delete mapping[dashboardId];
      deleted += 1;
    }
  }

  Dashboards_saveMapping_(mapping);

  return {
    ok: true,
    deleted: deleted,
    errors: [],
  };
}

function Dashboards_setArchivedState_(dashboardIds, archived) {
  var ids = Dashboards_normalizeIds_(dashboardIds);
  if (!ids.length) {
    throw new Error("Dashboard IDs are required");
  }

  var errors = [];
  var updated = 0;
  var updatedDashboards = [];

  for (var i = 0; i < ids.length; i++) {
    var dashboardId = ids[i];
    try {
      var dashboard = Dashboards_getDashboard_(dashboardId);
      if (!dashboard) {
        errors.push({ dashboardId: dashboardId, error: "Dashboard not found" });
        continue;
      }
      dashboard.archived = !!archived;
      if (dashboard.archived) {
        dashboard.readOnly = false;
      }
      var result = Dashboards_saveDashboard_(dashboard);
      if (result && result.ok) {
        updated += 1;
        updatedDashboards.push(result.dashboard);
      } else {
        errors.push({ dashboardId: dashboardId, error: "Save failed" });
      }
    } catch (err) {
      Logger.log("[Dashboards_setArchivedState_] Error: " + err);
      errors.push({ dashboardId: dashboardId, error: err.message || String(err) });
    }
  }

  return {
    ok: errors.length === 0,
    updated: updated,
    errors: errors,
    dashboards: updatedDashboards,
  };
}

function Dashboards_setReadOnlyState_(dashboardIds, readOnly) {
  var ids = Dashboards_normalizeIds_(dashboardIds);
  if (!ids.length) {
    throw new Error("Dashboard IDs are required");
  }

  var errors = [];
  var updated = 0;
  var updatedDashboards = [];

  for (var i = 0; i < ids.length; i++) {
    var dashboardId = ids[i];
    try {
      var dashboard = Dashboards_getDashboard_(dashboardId);
      if (!dashboard) {
        errors.push({ dashboardId: dashboardId, error: "Dashboard not found" });
        continue;
      }
      dashboard.readOnly = !!readOnly;
      if (dashboard.readOnly) {
        dashboard.archived = false;
      }
      var result = Dashboards_saveDashboard_(dashboard);
      if (result && result.ok) {
        updated += 1;
        updatedDashboards.push(result.dashboard);
      } else {
        errors.push({ dashboardId: dashboardId, error: "Save failed" });
      }
    } catch (err) {
      Logger.log("[Dashboards_setReadOnlyState_] Error: " + err);
      errors.push({ dashboardId: dashboardId, error: err.message || String(err) });
    }
  }

  return {
    ok: errors.length === 0,
    updated: updated,
    errors: errors,
    dashboards: updatedDashboards,
  };
}

function Dashboards_copyDashboard_(dashboardId) {
  if (!dashboardId) throw new Error("dashboardId is required");

  var sourceDashboard = Dashboards_getDashboard_(dashboardId);
  if (!sourceDashboard) throw new Error("コピー元ダッシュボードが見つかりません: " + dashboardId);

  var mapping = Dashboards_getMapping_();
  var mappingEntry = mapping[dashboardId] || {};
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
      Logger.log("[Dashboards_copyDashboard_] Failed to get parent folder: " + e);
    }
  }

  var newDashboard = JSON.parse(JSON.stringify(sourceDashboard));
  newDashboard.id = "";
  newDashboard.settings = newDashboard.settings || {};
  var originalTitle = newDashboard.settings.title || "";
  newDashboard.settings.title = originalTitle + "（コピー）";
  newDashboard.archived = false;
  newDashboard.readOnly = false;
  delete newDashboard.driveFileUrl;
  delete newDashboard.createdAtUnixMs;
  delete newDashboard.modifiedAtUnixMs;

  var saveMode = parentFolderUrl ? "copy_to_folder" : "copy_to_root";
  return Dashboards_saveDashboard_(newDashboard, parentFolderUrl, saveMode);
}

function nfbListDashboards(options) {
  return nfbSafeCall_(function() {
    var result = Dashboards_listDashboards_(options || {});
    return {
      ok: true,
      dashboards: result.dashboards || [],
      loadFailures: result.loadFailures || [],
    };
  });
}

function nfbGetDashboard(dashboardId) {
  return nfbSafeCall_(function() {
    var dashboard = Dashboards_getDashboard_(dashboardId);
    if (!dashboard) {
      return { ok: false, error: "Dashboard not found" };
    }
    return { ok: true, dashboard: dashboard };
  });
}

function nfbSaveDashboard(payload) {
  return nfbSafeCall_(function() {
    var dashboard = (payload && payload.dashboard) ? payload.dashboard : payload;
    var targetUrl = (payload && payload.targetUrl) || null;
    var saveMode = (payload && payload.saveMode) || "auto";
    return Dashboards_saveDashboard_(dashboard, targetUrl, saveMode);
  });
}

function nfbDeleteDashboard(dashboardId) {
  return nfbSafeCall_(function() {
    var res = Dashboards_deleteDashboards_([dashboardId]);
    return { ok: res.ok };
  });
}

function nfbDeleteDashboards(dashboardIds) {
  return nfbSafeCall_(function() {
    return Dashboards_deleteDashboards_(dashboardIds);
  });
}

function nfbArchiveDashboards(dashboardIds) {
  return nfbSafeCall_(function() {
    return Dashboards_setArchivedState_(dashboardIds, true);
  });
}

function nfbUnarchiveDashboards(dashboardIds) {
  return nfbSafeCall_(function() {
    return Dashboards_setArchivedState_(dashboardIds, false);
  });
}

function nfbSetDashboardsReadOnly(dashboardIds) {
  return nfbSafeCall_(function() {
    return Dashboards_setReadOnlyState_(dashboardIds, true);
  });
}

function nfbClearDashboardsReadOnly(dashboardIds) {
  return nfbSafeCall_(function() {
    return Dashboards_setReadOnlyState_(dashboardIds, false);
  });
}

function nfbCopyDashboard(dashboardId) {
  return nfbSafeCall_(function() {
    if (!dashboardId) return { ok: false, error: "dashboardId is required" };
    return Dashboards_copyDashboard_(dashboardId);
  });
}

function nfbImportDashboardsFromDrive(url) {
  return nfbSafeCall_(function() {
    return Dashboards_importFromDrive_(url);
  });
}

function nfbRegisterImportedDashboard(payload) {
  return nfbSafeCall_(function() {
    return Dashboards_registerImportedDashboard_(payload);
  });
}

function nfbGetDashboardTemplate(templateUrl) {
  return nfbSafeCall_(function() {
    var result = Dashboards_getTemplate_(templateUrl);
    return {
      ok: true,
      html: result.html,
      fileId: result.fileId,
      fileName: result.fileName,
      fileUrl: result.fileUrl,
      fetchedAt: result.fetchedAt,
      fromCache: !!result.fromCache,
    };
  });
}

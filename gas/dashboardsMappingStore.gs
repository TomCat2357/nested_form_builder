function Dashboards_getActiveProps_() {
  return Nfb_getActiveProperties_();
}

function Dashboards_buildDriveFileUrlFromId_(fileId) {
  if (!fileId) return null;
  return "https://drive.google.com/file/d/" + fileId + "/view";
}

function Dashboards_normalizeMappingValue_(value) {
  var fileId = null;
  var driveFileUrl = null;

  if (value && typeof value === "object" && !Array.isArray(value)) {
    fileId = typeof value.fileId === "string" ? String(value.fileId).trim() : null;
    driveFileUrl = typeof value.driveFileUrl === "string" ? String(value.driveFileUrl).trim() : null;
  }

  if (!driveFileUrl && fileId) {
    driveFileUrl = Dashboards_buildDriveFileUrlFromId_(fileId);
  }

  return { fileId: fileId, driveFileUrl: driveFileUrl };
}

function Dashboards_normalizeMapping_(mapping) {
  var normalized = {};
  for (var dashboardId in mapping) {
    if (!mapping.hasOwnProperty(dashboardId)) continue;
    normalized[dashboardId] = Dashboards_normalizeMappingValue_(mapping[dashboardId]);
  }
  return normalized;
}

function Dashboards_parseMappingJson_(json, label) {
  if (!json) return {};
  try {
    var parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    if (parsed.version !== DASHBOARDS_PROPERTY_VERSION) return {};
    if (!parsed.mapping || typeof parsed.mapping !== "object" || Array.isArray(parsed.mapping)) return {};
    return parsed.mapping;
  } catch (err) {
    Logger.log("[Dashboards_parseMappingJson_] Failed to parse " + label + ": " + err);
    return {};
  }
}

function Dashboards_getMapping_() {
  var props = Dashboards_getActiveProps_();
  var rawJson = props.getProperty(DASHBOARDS_PROPERTY_KEY);
  var mode = Nfb_getPropertyStoreMode_();
  var mapping = Dashboards_parseMappingJson_(rawJson, mode);
  return Dashboards_normalizeMapping_(mapping);
}

function Dashboards_saveMapping_(mapping) {
  var normalized = Dashboards_normalizeMapping_(mapping || {});
  var mappingStr = JSON.stringify({ version: DASHBOARDS_PROPERTY_VERSION, mapping: normalized });
  var props = Dashboards_getActiveProps_();
  props.setProperty(DASHBOARDS_PROPERTY_KEY, mappingStr);
}

function Dashboards_normalizeIds_(ids) {
  var source = Array.isArray(ids) ? ids : [ids];
  var seen = {};
  var normalized = [];

  for (var i = 0; i < source.length; i++) {
    var rawId = source[i];
    if (!rawId) continue;
    var dashboardId = String(rawId);
    if (seen[dashboardId]) continue;
    seen[dashboardId] = true;
    normalized.push(dashboardId);
  }

  return normalized;
}

function Dashboards_generateDashboardId_(mapping) {
  var nextId = "";
  do {
    nextId = Nfb_generateDashboardId_();
  } while (mapping && mapping[nextId]);
  return nextId;
}

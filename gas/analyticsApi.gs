// =============================================
// Analytics API
// =============================================

var ANALYTICS_FOLDER_NAME = "Nested Form Builder - Analytics";
var ANALYTICS_QUESTIONS_SUBFOLDER_NAME = "Questions";
var ANALYTICS_DASHBOARDS_SUBFOLDER_NAME = "Dashboards";
var ANALYTICS_QUESTIONS_PROPERTY_KEY = "nfb.analytics.questions.mapping";
var ANALYTICS_DASHBOARDS_PROPERTY_KEY = "nfb.analytics.dashboards.mapping";
var ANALYTICS_MAPPING_VERSION = 2;

// ---- Snapshot API ----

function AnalyticsApi_GetSnapshot_(ctx) {
  return nfbSafeCall_(function() {
    var spreadsheetId = ctx.spreadsheetId;
    var sheetName = ctx.sheetName || NFB_DEFAULT_SHEET_NAME;
    var formId = ctx.raw && ctx.raw.formId ? String(ctx.raw.formId) : "";
    var includeDeleted = !!(ctx.raw && ctx.raw.includeDeleted);

    var sheet = Sheets_getOrCreateSheet_(spreadsheetId, sheetName);
    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    var snapshotVersion = GetSheetLastUpdatedAt_(spreadsheetId, sheetName);

    if (lastColumn === 0) {
      return {
        ok: true,
        formId: formId,
        snapshotVersion: snapshotVersion,
        rowCount: 0,
        columns: [],
        headerMatrix: []
      };
    }

    var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);
    var headerMatrix = sheet.getRange(NFB_HEADER_START_ROW, 1, NFB_HEADER_DEPTH, lastColumn).getValues();
    var rowCount = Math.max(0, lastRow - NFB_DATA_START_ROW + 1);

    if (rowCount === 0) {
      return {
        ok: true,
        formId: formId,
        snapshotVersion: snapshotVersion,
        rowCount: 0,
        columns: columnPaths.map(function(cp) {
          return { key: cp.key, path: cp.path, values: [] };
        }),
        headerMatrix: headerMatrix
      };
    }

    var data = sheet.getRange(NFB_DATA_START_ROW, 1, rowCount, lastColumn).getValues();

    // deletedAt列インデックスを動的検索
    var deletedAtColIndex = -1;
    for (var c = 0; c < columnPaths.length; c++) {
      if (columnPaths[c].path.length === 1 && columnPaths[c].path[0] === "deletedAt") {
        deletedAtColIndex = columnPaths[c].index;
        break;
      }
    }

    // 有効行のみ抽出（削除済みを除外）
    var validRowIndices = [];
    for (var r = 0; r < data.length; r++) {
      if (!includeDeleted && deletedAtColIndex >= 0) {
        var deletedAtValue = data[r][deletedAtColIndex];
        if (deletedAtValue !== null && deletedAtValue !== "" && deletedAtValue !== 0) {
          continue;
        }
      }
      validRowIndices.push(r);
    }

    // 列指向データを構築
    var columns = [];
    for (var ci = 0; ci < columnPaths.length; ci++) {
      var cp = columnPaths[ci];
      var colDataIndex = cp.index;
      var values = [];
      for (var ri = 0; ri < validRowIndices.length; ri++) {
        var rowData = data[validRowIndices[ri]];
        var rawVal = colDataIndex < rowData.length ? rowData[colDataIndex] : null;
        var val;
        if (rawVal === "" || rawVal === undefined || rawVal === null) {
          val = null;
        } else if (rawVal instanceof Date) {
          val = rawVal.getTime();
        } else {
          val = rawVal;
        }
        values.push(val);
      }
      columns.push({ key: cp.key, path: cp.path, values: values });
    }

    return {
      ok: true,
      formId: formId,
      snapshotVersion: snapshotVersion,
      rowCount: validRowIndices.length,
      columns: columns,
      headerMatrix: headerMatrix
    };
  });
}

function AnalyticsApi_CheckVersion_(ctx) {
  return nfbSafeCall_(function() {
    var spreadsheetId = ctx.spreadsheetId;
    var sheetName = ctx.sheetName || NFB_DEFAULT_SHEET_NAME;
    var formId = ctx.raw && ctx.raw.formId ? String(ctx.raw.formId) : "";

    var sheet = Sheets_getOrCreateSheet_(spreadsheetId, sheetName);
    var snapshotVersion = GetSheetLastUpdatedAt_(spreadsheetId, sheetName);
    var lastRow = sheet.getLastRow();
    var rowCount = Math.max(0, lastRow - NFB_DATA_START_ROW + 1);

    return { ok: true, formId: formId, snapshotVersion: snapshotVersion, rowCount: rowCount };
  });
}

// ---- Analytics Template Mapping Store ----

function Analytics_getActiveProps_() {
  return Nfb_getActiveProperties_();
}

function Analytics_getPropertyKey_(type) {
  return type === "questions" ? ANALYTICS_QUESTIONS_PROPERTY_KEY : ANALYTICS_DASHBOARDS_PROPERTY_KEY;
}

function Analytics_parseMappingJson_(json) {
  if (!json) return {};
  try {
    var parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    if (parsed.version !== ANALYTICS_MAPPING_VERSION) return {};
    if (!parsed.mapping || typeof parsed.mapping !== "object" || Array.isArray(parsed.mapping)) return {};
    return parsed.mapping;
  } catch (err) {
    Logger.log("[Analytics_parseMappingJson_] Parse error: " + err);
    return {};
  }
}

function Analytics_getMapping_(type) {
  var props = Analytics_getActiveProps_();
  var key = Analytics_getPropertyKey_(type);
  return Analytics_parseMappingJson_(props.getProperty(key));
}

function Analytics_saveMapping_(type, mapping) {
  var props = Analytics_getActiveProps_();
  var key = Analytics_getPropertyKey_(type);
  var normalized = {};
  for (var id in mapping) {
    if (!mapping.hasOwnProperty(id)) continue;
    var entry = mapping[id] || {};
    normalized[id] = { fileId: entry.fileId || null, driveFileUrl: entry.driveFileUrl || null };
  }
  props.setProperty(key, JSON.stringify({ version: ANALYTICS_MAPPING_VERSION, mapping: normalized }));
}

function Analytics_getOrCreateFolder_(type) {
  var rootFolders = DriveApp.getFoldersByName(ANALYTICS_FOLDER_NAME);
  var rootFolder = rootFolders.hasNext() ? rootFolders.next() : DriveApp.createFolder(ANALYTICS_FOLDER_NAME);
  var subName = type === "questions" ? ANALYTICS_QUESTIONS_SUBFOLDER_NAME : ANALYTICS_DASHBOARDS_SUBFOLDER_NAME;
  var subFolders = rootFolder.getFoldersByName(subName);
  return subFolders.hasNext() ? subFolders.next() : rootFolder.createFolder(subName);
}

// ---- Question CRUD (public API) ----

function AnalyticsApi_ListQuestions_(ctx) {
  return Analytics_listTemplates_("questions");
}

function AnalyticsApi_GetQuestion_(ctx) {
  return Analytics_getTemplate_("questions", ctx.raw && ctx.raw.questionId);
}

function AnalyticsApi_SaveQuestion_(ctx) {
  return Analytics_saveTemplate_("questions", ctx.raw && ctx.raw.question, ctx.raw && ctx.raw.targetUrl);
}

function AnalyticsApi_DeleteQuestion_(ctx) {
  return Analytics_deleteTemplate_("questions", ctx.raw && ctx.raw.questionId);
}

// ---- Dashboard CRUD (public API) ----

function AnalyticsApi_ListDashboards_(ctx) {
  return Analytics_listTemplates_("dashboards");
}

function AnalyticsApi_GetDashboard_(ctx) {
  return Analytics_getTemplate_("dashboards", ctx.raw && ctx.raw.dashboardId);
}

function AnalyticsApi_SaveDashboard_(ctx) {
  return Analytics_saveTemplate_("dashboards", ctx.raw && ctx.raw.dashboard, ctx.raw && ctx.raw.targetUrl);
}

function AnalyticsApi_DeleteDashboard_(ctx) {
  return Analytics_deleteTemplate_("dashboards", ctx.raw && ctx.raw.dashboardId);
}

// ---- Template CRUD (internal) ----

function Analytics_listTemplates_(type) {
  return nfbSafeCall_(function() {
    var mapping = Analytics_getMapping_(type);
    var items = [];
    var loadFailures = [];

    for (var id in mapping) {
      if (!mapping.hasOwnProperty(id)) continue;
      var entry = mapping[id] || {};
      var fileId = entry.fileId;
      if (!fileId && entry.driveFileUrl) {
        var parsed = Forms_parseGoogleDriveUrl_(entry.driveFileUrl);
        if (parsed.type === "file") fileId = parsed.id;
      }
      if (!fileId) {
        loadFailures.push({ id: id, error: "ファイルIDが登録されていません" });
        continue;
      }
      try {
        var file = DriveApp.getFileById(fileId);
        if (file.isTrashed()) {
          loadFailures.push({ id: id, error: "ファイルがゴミ箱に移動されています" });
          continue;
        }
        var item = JSON.parse(file.getBlob().getDataAsString());
        item.id = id;
        if (!item.driveFileUrl) item.driveFileUrl = entry.driveFileUrl || file.getUrl();
        items.push(item);
      } catch (err) {
        loadFailures.push({ id: id, error: nfbErrorToString_(err) });
      }
    }

    var result = { ok: true, loadFailures: loadFailures };
    result[type] = items;
    return result;
  });
}

function Analytics_getTemplate_(type, templateId) {
  return nfbSafeCall_(function() {
    if (!templateId) throw new Error("IDが指定されていません");
    var mapping = Analytics_getMapping_(type);
    var entry = mapping[templateId] || {};
    var fileId = entry.fileId;
    if (!fileId && entry.driveFileUrl) {
      var parsed = Forms_parseGoogleDriveUrl_(entry.driveFileUrl);
      if (parsed.type === "file") fileId = parsed.id;
    }
    if (!fileId) throw new Error("ファイルIDが登録されていません: " + templateId);

    var file = DriveApp.getFileById(fileId);
    var item = JSON.parse(file.getBlob().getDataAsString());
    item.id = templateId;
    if (!item.driveFileUrl) item.driveFileUrl = entry.driveFileUrl || file.getUrl();

    var resultKey = type === "questions" ? "question" : "dashboard";
    var result = { ok: true };
    result[resultKey] = item;
    return result;
  });
}

function Analytics_saveTemplate_(type, template, targetUrl) {
  return nfbSafeCall_(function() {
    if (!template || typeof template !== "object") throw new Error("テンプレートデータが不正です");

    var id = template.id;
    var isNew = !id;
    if (isNew) {
      var prefix = type === "questions" ? "q" : "d";
      id = prefix + "_" + Nfb_generateUlid_();
    }

    var mapping = Analytics_getMapping_(type);
    var existingEntry = mapping[id] || {};
    var existingFileId = existingEntry.fileId;
    if (!existingFileId && existingEntry.driveFileUrl) {
      var parsedExisting = Forms_parseGoogleDriveUrl_(existingEntry.driveFileUrl);
      if (parsedExisting.type === "file") existingFileId = parsedExisting.id;
    }

    // ファイルコンテンツ（idとdriveFileUrlはマッピングから復元するため含めない）
    var templateToSave = {};
    for (var k in template) {
      if (template.hasOwnProperty(k) && k !== "id" && k !== "driveFileUrl") {
        templateToSave[k] = template[k];
      }
    }
    var content = JSON.stringify(templateToSave, null, 2);
    var fileName = id + ".json";

    var file = null;
    var fileUrl;

    // targetUrlが指定されていれば上書き
    if (targetUrl) {
      var parsedTarget = Forms_parseGoogleDriveUrl_(targetUrl);
      if (parsedTarget.type === "file" && parsedTarget.id) {
        try {
          file = DriveApp.getFileById(parsedTarget.id);
          file.setContent(content);
          fileUrl = file.getUrl();
          existingFileId = file.getId();
        } catch (err) {
          Logger.log("[Analytics_saveTemplate_] targetUrl update failed: " + err);
          file = null;
        }
      }
    }

    // 既存ファイルIDがあれば上書き
    if (!file && existingFileId) {
      try {
        file = DriveApp.getFileById(existingFileId);
        if (!file.isTrashed()) {
          file.setContent(content);
          fileUrl = file.getUrl();
        } else {
          file = null;
        }
      } catch (err) {
        Logger.log("[Analytics_saveTemplate_] Existing file update failed: " + err);
        file = null;
      }
    }

    // 新規ファイル作成
    if (!file) {
      var folder = Analytics_getOrCreateFolder_(type);
      var existing = folder.getFilesByName(fileName);
      while (existing.hasNext()) {
        existing.next().setTrashed(true);
      }
      file = folder.createFile(fileName, content, MimeType.PLAIN_TEXT);
      fileUrl = file.getUrl();
    }

    // マッピング更新
    mapping[id] = { fileId: file.getId(), driveFileUrl: fileUrl };
    Analytics_saveMapping_(type, mapping);

    var saved = {};
    for (var sk in template) {
      if (template.hasOwnProperty(sk)) saved[sk] = template[sk];
    }
    saved.id = id;
    saved.driveFileUrl = fileUrl;

    var resultKey = type === "questions" ? "question" : "dashboard";
    var result = { ok: true, fileUrl: fileUrl };
    result[resultKey] = saved;
    return result;
  });
}

function Analytics_deleteTemplate_(type, templateId) {
  return nfbSafeCall_(function() {
    if (!templateId) throw new Error("IDが指定されていません");
    var mapping = Analytics_getMapping_(type);
    var entry = mapping[templateId] || {};
    var fileId = entry.fileId;
    if (!fileId && entry.driveFileUrl) {
      var parsed = Forms_parseGoogleDriveUrl_(entry.driveFileUrl);
      if (parsed.type === "file") fileId = parsed.id;
    }
    if (fileId) {
      try {
        DriveApp.getFileById(fileId).setTrashed(true);
      } catch (err) {
        Logger.log("[Analytics_deleteTemplate_] Trash failed: " + err);
      }
    }
    delete mapping[templateId];
    Analytics_saveMapping_(type, mapping);
    return { ok: true, id: templateId };
  });
}

// ---- public google.script.run wrappers ----

function nfbGetAnalyticsSnapshot(payload) {
  return executeAction_("analytics_snapshot", payload, { source: "scriptRun" });
}

function nfbCheckAnalyticsSnapshotVersion(payload) {
  return executeAction_("analytics_snapshot_version", payload, { source: "scriptRun" });
}

function nfbListAnalyticsQuestions() {
  return executeAction_("analytics_questions_list", {}, { source: "scriptRun" });
}

function nfbGetAnalyticsQuestion(questionId) {
  return executeAction_("analytics_questions_get", { questionId: questionId }, { source: "scriptRun" });
}

function nfbSaveAnalyticsQuestion(payload) {
  return executeAction_("analytics_questions_save", payload, { source: "scriptRun" });
}

function nfbDeleteAnalyticsQuestion(questionId) {
  return executeAction_("analytics_questions_delete", { questionId: questionId }, { source: "scriptRun" });
}

function nfbListAnalyticsDashboards() {
  return executeAction_("analytics_dashboards_list", {}, { source: "scriptRun" });
}

function nfbGetAnalyticsDashboard(dashboardId) {
  return executeAction_("analytics_dashboards_get", { dashboardId: dashboardId }, { source: "scriptRun" });
}

function nfbSaveAnalyticsDashboard(payload) {
  return executeAction_("analytics_dashboards_save", payload, { source: "scriptRun" });
}

function nfbDeleteAnalyticsDashboard(dashboardId) {
  return executeAction_("analytics_dashboards_delete", { dashboardId: dashboardId }, { source: "scriptRun" });
}

// =============================================
// Analytics API — Question / Dashboard CRUD + Archive / Copy / Import / Export
// =============================================
//
// type: "questions" | "dashboards" のいずれかをパラメータで受け取り、
// 共通ロジック (Analytics_*Template*_ 系) でフォームと同等の管理機能を提供する。
//
// 公開 API は `nfb*Analytics*` プレフィックスで `executeAction_` 経由で呼ばれる。

var ANALYTICS_FOLDER_NAME = "Nested Form Builder - Analytics";
var ANALYTICS_QUESTIONS_SUBFOLDER_NAME = "Questions";
var ANALYTICS_DASHBOARDS_SUBFOLDER_NAME = "Dashboards";
var ANALYTICS_QUESTIONS_PROPERTY_KEY = "nfb.analytics.questions.mapping";
var ANALYTICS_DASHBOARDS_PROPERTY_KEY = "nfb.analytics.dashboards.mapping";
var ANALYTICS_MAPPING_VERSION = 2;

// ---- Mapping store ----

function Analytics_getPropertyKey_(type) {
  return type === "questions" ? ANALYTICS_QUESTIONS_PROPERTY_KEY : ANALYTICS_DASHBOARDS_PROPERTY_KEY;
}

function Analytics_getResultKey_(type) {
  return type === "questions" ? "question" : "dashboard";
}

function Analytics_getResultListKey_(type) {
  return type === "questions" ? "questions" : "dashboards";
}

function Analytics_getIdPrefix_(type) {
  return type === "questions" ? "q" : "d";
}

function Analytics_getMapping_(type) {
  var props = Nfb_getActiveProperties_();
  var key = Analytics_getPropertyKey_(type);
  return Nfb_parseVersionedMapping_(props.getProperty(key), ANALYTICS_MAPPING_VERSION, "analytics:" + type);
}

function Analytics_saveMapping_(type, mapping) {
  var props = Nfb_getActiveProperties_();
  var key = Analytics_getPropertyKey_(type);
  Nfb_serializeVersionedMapping_(props, key, ANALYTICS_MAPPING_VERSION, mapping || {}, function(entry) {
    // 名前（= Drive ファイル名）をキャッシュ保持する。論理側 fileId が失われたときの
    // 「論理パス（名前）で物理ファイルを探し直す」フォールバック（forms の title 相当）に使う。
    return {
      fileId: entry.fileId || null,
      driveFileUrl: entry.driveFileUrl || null,
      name: (typeof entry.name === "string" && entry.name) ? entry.name : null
    };
  });
}

function Analytics_getOrCreateFolder_(type) {
  var rootFolders = DriveApp.getFoldersByName(ANALYTICS_FOLDER_NAME);
  var rootFolder = rootFolders.hasNext() ? rootFolders.next() : DriveApp.createFolder(ANALYTICS_FOLDER_NAME);
  var subName = type === "questions" ? ANALYTICS_QUESTIONS_SUBFOLDER_NAME : ANALYTICS_DASHBOARDS_SUBFOLDER_NAME;
  var subFolders = rootFolder.getFoldersByName(subName);
  return subFolders.hasNext() ? subFolders.next() : rootFolder.createFolder(subName);
}


// ---- Action handler ディスパッチテーブル ----
// mode に応じて Analytics_*Template*_ ヘルパへ raw payload を中継する。
// idKey: payload 上の単一 ID キー。idsKey: 複数 ID 配列キー。

var ANALYTICS_HANDLERS_ = {
  "analytics_questions_list":             { type: "questions",  mode: "list" },
  "analytics_questions_get":              { type: "questions",  mode: "get",            idKey: "questionId" },
  "analytics_questions_save":             { type: "questions",  mode: "save",           payloadKey: "question",  urlKey: "targetUrl" },
  "analytics_questions_delete":           { type: "questions",  mode: "delete_one",     idKey: "questionId" },
  "analytics_questions_delete_batch":     { type: "questions",  mode: "delete_batch",   idsKey: "questionIds" },
  "analytics_questions_archive":          { type: "questions",  mode: "archive_one",    idKey: "questionId",     archived: true },
  "analytics_questions_unarchive":        { type: "questions",  mode: "archive_one",    idKey: "questionId",     archived: false },
  "analytics_questions_archive_batch":    { type: "questions",  mode: "archive_batch",  idsKey: "questionIds",   archived: true },
  "analytics_questions_unarchive_batch":  { type: "questions",  mode: "archive_batch",  idsKey: "questionIds",   archived: false },
  "analytics_questions_copy":             { type: "questions",  mode: "copy",           idKey: "questionId" },
  "analytics_questions_import":           { type: "questions",  mode: "import" },
  "analytics_questions_register_import":  { type: "questions",  mode: "register" },
  "analytics_questions_resolve_ref":      { type: "questions",  mode: "resolve_ref" },
  "analytics_dashboards_list":            { type: "dashboards", mode: "list" },
  "analytics_dashboards_get":             { type: "dashboards", mode: "get",            idKey: "dashboardId" },
  "analytics_dashboards_save":            { type: "dashboards", mode: "save",           payloadKey: "dashboard", urlKey: "targetUrl" },
  "analytics_dashboards_delete":          { type: "dashboards", mode: "delete_one",     idKey: "dashboardId" },
  "analytics_dashboards_delete_batch":    { type: "dashboards", mode: "delete_batch",   idsKey: "dashboardIds" },
  "analytics_dashboards_archive":         { type: "dashboards", mode: "archive_one",    idKey: "dashboardId",    archived: true },
  "analytics_dashboards_unarchive":       { type: "dashboards", mode: "archive_one",    idKey: "dashboardId",    archived: false },
  "analytics_dashboards_archive_batch":   { type: "dashboards", mode: "archive_batch",  idsKey: "dashboardIds",  archived: true },
  "analytics_dashboards_unarchive_batch": { type: "dashboards", mode: "archive_batch",  idsKey: "dashboardIds",  archived: false },
  "analytics_dashboards_copy":            { type: "dashboards", mode: "copy",           idKey: "dashboardId" },
  "analytics_dashboards_import":          { type: "dashboards", mode: "import" },
  "analytics_dashboards_register_import": { type: "dashboards", mode: "register" },
  "analytics_questions_folders_list":     { type: "questions",  mode: "folders_list" },
  "analytics_questions_folder_create":    { type: "questions",  mode: "folder_create" },
  "analytics_questions_move":             { type: "questions",  mode: "folder_move" },
  "analytics_questions_folder_rename":    { type: "questions",  mode: "folder_rename" },
  "analytics_questions_folder_delete":    { type: "questions",  mode: "folder_delete" },
  "analytics_dashboards_folders_list":    { type: "dashboards", mode: "folders_list" },
  "analytics_dashboards_folder_create":   { type: "dashboards", mode: "folder_create" },
  "analytics_dashboards_move":            { type: "dashboards", mode: "folder_move" },
  "analytics_dashboards_folder_rename":   { type: "dashboards", mode: "folder_rename" },
  "analytics_dashboards_folder_delete":   { type: "dashboards", mode: "folder_delete" }
};

function Analytics_dispatch_(action, ctx) {
  var def = ANALYTICS_HANDLERS_[action];
  var raw = (ctx && ctx.raw) || {};
  switch (def.mode) {
    case "list":          return Analytics_listTemplates_(def.type, raw.options || {});
    case "get":           return Analytics_getTemplate_(def.type, raw[def.idKey]);
    case "save":          return Analytics_saveTemplate_(def.type, raw[def.payloadKey], raw[def.urlKey]);
    case "delete_one":    return Analytics_deleteTemplates_(def.type, [raw[def.idKey]]);
    case "delete_batch":  return Analytics_deleteTemplates_(def.type, raw[def.idsKey] || []);
    case "archive_one":   return Analytics_setTemplatesArchivedStateWrap_(def.type, [raw[def.idKey]], def.archived);
    case "archive_batch": return Analytics_setTemplatesArchivedState_(def.type, raw[def.idsKey] || [], def.archived);
    case "copy":          return Analytics_copyTemplate_(def.type, raw[def.idKey]);
    case "import":        return Analytics_importFromDrive_(def.type, raw.url);
    case "register":      return Analytics_registerImportedTemplate_(def.type, raw);
    case "resolve_ref":   return Analytics_resolveQuestionRef_(raw.ref || raw);
    case "folders_list":  return Analytics_listFolders_(def.type);
    case "folder_create": return Analytics_createFolder_(def.type, raw.path);
    case "folder_move":   return Analytics_moveItems_(def.type, raw || {});
    case "folder_rename": return Analytics_renameFolder_(def.type, raw || {});
    case "folder_delete": return Analytics_deleteFolder_(def.type, raw.path);
  }
  throw new Error("Unknown analytics action: " + action);
}

// ACTION_DEFINITIONS_ から呼ばれる handler は単一行で dispatch するだけ。

function AnalyticsApi_ListQuestions_(ctx)             { return Analytics_dispatch_("analytics_questions_list", ctx); }
function AnalyticsApi_GetQuestion_(ctx)               { return Analytics_dispatch_("analytics_questions_get", ctx); }
function AnalyticsApi_SaveQuestion_(ctx)              { return Analytics_dispatch_("analytics_questions_save", ctx); }
function AnalyticsApi_DeleteQuestion_(ctx)            { return Analytics_dispatch_("analytics_questions_delete", ctx); }
function AnalyticsApi_DeleteQuestions_(ctx)           { return Analytics_dispatch_("analytics_questions_delete_batch", ctx); }
function AnalyticsApi_ArchiveQuestion_(ctx)           { return Analytics_dispatch_("analytics_questions_archive", ctx); }
function AnalyticsApi_UnarchiveQuestion_(ctx)         { return Analytics_dispatch_("analytics_questions_unarchive", ctx); }
function AnalyticsApi_ArchiveQuestions_(ctx)          { return Analytics_dispatch_("analytics_questions_archive_batch", ctx); }
function AnalyticsApi_UnarchiveQuestions_(ctx)        { return Analytics_dispatch_("analytics_questions_unarchive_batch", ctx); }
function AnalyticsApi_CopyQuestion_(ctx)              { return Analytics_dispatch_("analytics_questions_copy", ctx); }
function AnalyticsApi_ImportQuestions_(ctx)           { return Analytics_dispatch_("analytics_questions_import", ctx); }
function AnalyticsApi_RegisterImportedQuestion_(ctx)  { return Analytics_dispatch_("analytics_questions_register_import", ctx); }
function AnalyticsApi_ResolveQuestionRef_(ctx)        { return Analytics_dispatch_("analytics_questions_resolve_ref", ctx); }
function AnalyticsApi_ListDashboards_(ctx)            { return Analytics_dispatch_("analytics_dashboards_list", ctx); }
function AnalyticsApi_GetDashboard_(ctx)              { return Analytics_dispatch_("analytics_dashboards_get", ctx); }
function AnalyticsApi_SaveDashboard_(ctx)             { return Analytics_dispatch_("analytics_dashboards_save", ctx); }
function AnalyticsApi_DeleteDashboard_(ctx)           { return Analytics_dispatch_("analytics_dashboards_delete", ctx); }
function AnalyticsApi_DeleteDashboards_(ctx)          { return Analytics_dispatch_("analytics_dashboards_delete_batch", ctx); }
function AnalyticsApi_ArchiveDashboard_(ctx)          { return Analytics_dispatch_("analytics_dashboards_archive", ctx); }
function AnalyticsApi_UnarchiveDashboard_(ctx)        { return Analytics_dispatch_("analytics_dashboards_unarchive", ctx); }
function AnalyticsApi_ArchiveDashboards_(ctx)         { return Analytics_dispatch_("analytics_dashboards_archive_batch", ctx); }
function AnalyticsApi_UnarchiveDashboards_(ctx)       { return Analytics_dispatch_("analytics_dashboards_unarchive_batch", ctx); }
function AnalyticsApi_CopyDashboard_(ctx)             { return Analytics_dispatch_("analytics_dashboards_copy", ctx); }
function AnalyticsApi_ImportDashboards_(ctx)          { return Analytics_dispatch_("analytics_dashboards_import", ctx); }
function AnalyticsApi_RegisterImportedDashboard_(ctx) { return Analytics_dispatch_("analytics_dashboards_register_import", ctx); }
function AnalyticsApi_ListQuestionFolders_(ctx)        { return Analytics_dispatch_("analytics_questions_folders_list",    ctx); }
function AnalyticsApi_CreateQuestionFolder_(ctx)       { return Analytics_dispatch_("analytics_questions_folder_create",   ctx); }
function AnalyticsApi_MoveQuestions_(ctx)              { return Analytics_dispatch_("analytics_questions_move",            ctx); }
function AnalyticsApi_RenameQuestionFolder_(ctx)       { return Analytics_dispatch_("analytics_questions_folder_rename",   ctx); }
function AnalyticsApi_DeleteQuestionFolder_(ctx)       { return Analytics_dispatch_("analytics_questions_folder_delete",   ctx); }
function AnalyticsApi_ListDashboardFolders_(ctx)       { return Analytics_dispatch_("analytics_dashboards_folders_list",   ctx); }
function AnalyticsApi_CreateDashboardFolder_(ctx)      { return Analytics_dispatch_("analytics_dashboards_folder_create",  ctx); }
function AnalyticsApi_MoveDashboards_(ctx)             { return Analytics_dispatch_("analytics_dashboards_move",           ctx); }
function AnalyticsApi_RenameDashboardFolder_(ctx)      { return Analytics_dispatch_("analytics_dashboards_folder_rename",  ctx); }
function AnalyticsApi_DeleteDashboardFolder_(ctx)      { return Analytics_dispatch_("analytics_dashboards_folder_delete",  ctx); }

// ---- single-id archive 結果のラップ ----

function Analytics_setTemplatesArchivedStateWrap_(type, ids, archived) {
  return Nfb_unwrapSingleResult_(
    Analytics_setTemplatesArchivedState_(type, ids, archived),
    Analytics_getResultListKey_(type),
    Analytics_getResultKey_(type)
  );
}

// ---- public google.script.run wrappers ----
// google.script.run はトップレベル global function を要求するので、各エンドポイントを
// 個別関数として宣言するが本体は共通の Nfb_runScriptAction_（errors.gs）への 1 行転送に統一する。

function Analytics_runScriptAction_(action, payload) {
  return Nfb_runScriptAction_(action, payload);
}

function nfbListAnalyticsQuestions(options)              { return Analytics_runScriptAction_("analytics_questions_list",             { options: options || {} }); }
function nfbGetAnalyticsQuestion(questionId)             { return Analytics_runScriptAction_("analytics_questions_get",              { questionId: questionId }); }
function nfbSaveAnalyticsQuestion(payload)               { return Analytics_runScriptAction_("analytics_questions_save",             payload); }
function nfbDeleteAnalyticsQuestion(questionId)          { return Analytics_runScriptAction_("analytics_questions_delete",           { questionId: questionId }); }
function nfbDeleteAnalyticsQuestions(questionIds)        { return Analytics_runScriptAction_("analytics_questions_delete_batch",     { questionIds: questionIds }); }
function nfbArchiveAnalyticsQuestion(questionId)         { return Analytics_runScriptAction_("analytics_questions_archive",          { questionId: questionId }); }
function nfbUnarchiveAnalyticsQuestion(questionId)       { return Analytics_runScriptAction_("analytics_questions_unarchive",        { questionId: questionId }); }
function nfbArchiveAnalyticsQuestions(questionIds)       { return Analytics_runScriptAction_("analytics_questions_archive_batch",    { questionIds: questionIds }); }
function nfbUnarchiveAnalyticsQuestions(questionIds)     { return Analytics_runScriptAction_("analytics_questions_unarchive_batch",  { questionIds: questionIds }); }
function nfbCopyAnalyticsQuestion(questionId)            { return Analytics_runScriptAction_("analytics_questions_copy",             { questionId: questionId }); }
function nfbImportAnalyticsQuestionsFromDrive(url)       { return Analytics_runScriptAction_("analytics_questions_import",           { url: url }); }
function nfbRegisterImportedAnalyticsQuestion(payload)   { return Analytics_runScriptAction_("analytics_questions_register_import",  payload); }
function nfbResolveAnalyticsQuestionRef(payload)         { return Analytics_runScriptAction_("analytics_questions_resolve_ref",      payload); }
function nfbListAnalyticsDashboards(options)             { return Analytics_runScriptAction_("analytics_dashboards_list",            { options: options || {} }); }
function nfbGetAnalyticsDashboard(dashboardId)           { return Analytics_runScriptAction_("analytics_dashboards_get",             { dashboardId: dashboardId }); }
function nfbSaveAnalyticsDashboard(payload)              { return Analytics_runScriptAction_("analytics_dashboards_save",            payload); }
function nfbDeleteAnalyticsDashboard(dashboardId)        { return Analytics_runScriptAction_("analytics_dashboards_delete",          { dashboardId: dashboardId }); }
function nfbDeleteAnalyticsDashboards(dashboardIds)      { return Analytics_runScriptAction_("analytics_dashboards_delete_batch",    { dashboardIds: dashboardIds }); }
function nfbArchiveAnalyticsDashboard(dashboardId)       { return Analytics_runScriptAction_("analytics_dashboards_archive",         { dashboardId: dashboardId }); }
function nfbUnarchiveAnalyticsDashboard(dashboardId)     { return Analytics_runScriptAction_("analytics_dashboards_unarchive",       { dashboardId: dashboardId }); }
function nfbArchiveAnalyticsDashboards(dashboardIds)     { return Analytics_runScriptAction_("analytics_dashboards_archive_batch",   { dashboardIds: dashboardIds }); }
function nfbUnarchiveAnalyticsDashboards(dashboardIds)   { return Analytics_runScriptAction_("analytics_dashboards_unarchive_batch", { dashboardIds: dashboardIds }); }
function nfbCopyAnalyticsDashboard(dashboardId)          { return Analytics_runScriptAction_("analytics_dashboards_copy",            { dashboardId: dashboardId }); }
function nfbImportAnalyticsDashboardsFromDrive(url)      { return Analytics_runScriptAction_("analytics_dashboards_import",          { url: url }); }
function nfbRegisterImportedAnalyticsDashboard(payload)  { return Analytics_runScriptAction_("analytics_dashboards_register_import", payload); }
function nfbListAnalyticsQuestionFolders()               { return Analytics_runScriptAction_("analytics_questions_folders_list",    {}); }
function nfbCreateAnalyticsQuestionFolder(path)          { return Analytics_runScriptAction_("analytics_questions_folder_create",   { path: path }); }
function nfbMoveAnalyticsQuestions(payload)              { return Analytics_runScriptAction_("analytics_questions_move",            payload); }
function nfbRenameAnalyticsQuestionFolder(payload)       { return Analytics_runScriptAction_("analytics_questions_folder_rename",   payload); }
function nfbDeleteAnalyticsQuestionFolder(path)          { return Analytics_runScriptAction_("analytics_questions_folder_delete",   { path: path }); }
function nfbListAnalyticsDashboardFolders()              { return Analytics_runScriptAction_("analytics_dashboards_folders_list",   {}); }
function nfbCreateAnalyticsDashboardFolder(path)         { return Analytics_runScriptAction_("analytics_dashboards_folder_create",  { path: path }); }
function nfbMoveAnalyticsDashboards(payload)             { return Analytics_runScriptAction_("analytics_dashboards_move",           payload); }
function nfbRenameAnalyticsDashboardFolder(payload)      { return Analytics_runScriptAction_("analytics_dashboards_folder_rename",  payload); }
function nfbDeleteAnalyticsDashboardFolder(path)         { return Analytics_runScriptAction_("analytics_dashboards_folder_delete",  { path: path }); }

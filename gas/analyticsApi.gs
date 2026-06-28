// =============================================
// Analytics API — Question / Dashboard CRUD + Archive / Copy / Import / Export
// =============================================
//
// type: "questions" | "dashboards" のいずれかをパラメータで受け取り、
// 共通ロジック (Analytics_*Template*_ 系) でフォームと同等の管理機能を提供する。
//
// 公開 API は `nfb*Analytics*` プレフィックスで `executeAction_` 経由で呼ばれる。
//
// ［ハンドラ表の流派について（意図的差異）］
// Analytics は type × mode が直交するため ANALYTICS_HANDLERS_ は宣言的 `{ type, mode, idKey, ... }`
// ＋中央 Analytics_dispatch_ の switch 方式を採る。一方 Forms（formsPublicApi.gs）はアドホックな
// アクションが多く `{ run: function(raw){...} }` クロージャ方式。両者は `*_dispatch_ →
// Nfb_runScriptAction_ → executeAction_` の単一経路へ収束済みで機能的な不整合は無い。表の書き味の
// 違いは各ドメインの性質に合わせた意図的なもので、一律統一はしない（formsPublicApi.gs 冒頭も参照）。

var ANALYTICS_FOLDER_NAME = "Nested Form Builder - Analytics";
var ANALYTICS_QUESTIONS_SUBFOLDER_NAME = "Questions";
var ANALYTICS_DASHBOARDS_SUBFOLDER_NAME = "Dashboards";
// 串刺しフォーム検索（cross-form search）= 第 3 のメタエンティティ（type "crossSearches"）。
var ANALYTICS_CROSSSEARCHES_SUBFOLDER_NAME = "CrossSearches";
var ANALYTICS_QUESTIONS_PROPERTY_KEY = "nfb.analytics.questions.mapping";
var ANALYTICS_DASHBOARDS_PROPERTY_KEY = "nfb.analytics.dashboards.mapping";
var ANALYTICS_CROSSSEARCHES_PROPERTY_KEY = "nfb.analytics.crossSearches.mapping";
var ANALYTICS_MAPPING_VERSION = 2;

// ---- Mapping store ----

function Analytics_getPropertyKey_(type) {
  if (type === "questions") return ANALYTICS_QUESTIONS_PROPERTY_KEY;
  if (type === "crossSearches") return ANALYTICS_CROSSSEARCHES_PROPERTY_KEY;
  return ANALYTICS_DASHBOARDS_PROPERTY_KEY;
}

function Analytics_getResultKey_(type) {
  if (type === "questions") return "question";
  if (type === "crossSearches") return "crossSearch";
  return "dashboard";
}

function Analytics_getResultListKey_(type) {
  if (type === "questions") return "questions";
  if (type === "crossSearches") return "crossSearches";
  return "dashboards";
}

function Analytics_getMapping_(type) {
  var props = Nfb_getActiveProperties_();
  var key = Analytics_getPropertyKey_(type);
  var mapping = Nfb_parseVersionedMapping_(props.getProperty(key), ANALYTICS_MAPPING_VERSION, "analytics:" + type);
  // 読取側の正規化は共通コア Nfb_normalizeMapping_（gas/formsMappingStore.gs）へ集約。
  // Analytics（questions/dashboards）は name キーでラベルを保持する。driveFileUrl は fileId から都度復元し、
  // 読取は完全なエントリ（fileId / driveFileUrl / name / folder）を返す（forms の "title" と対称）。
  // name（= Drive ファイル名）と論理パス folder は、論理側 fileId が失われたときに
  // 「論理パス（folder + 名前）で物理ファイルを探し直す」復旧アンカーになる。folder は中央辞書の
  // 第一級フィールドで、null は「未バックフィル」sentinel（"" の「ルート」と区別する）。
  return Nfb_normalizeMapping_(mapping, "name");
}

function Analytics_saveMapping_(type, mapping) {
  var props = Nfb_getActiveProperties_();
  var key = Analytics_getPropertyKey_(type);
  Nfb_serializeVersionedMapping_(props, key, ANALYTICS_MAPPING_VERSION, mapping || {}, function(entry) {
    // 永続化用の最小化。driveFileUrl は fileId から読取時に復元できるため捨て、
    // { fileId, name, folder } だけ残す（forms の Forms_normalizeMappingForStorage_ と対称・共通コア
    // Nfb_minifyMappingForStorage_ へ集約）。name / folder は fileId 消失時の復旧アンカー、
    // folder の null sentinel（未バックフィル）もそのまま残す。読取側は完全なエントリを受け取る。
    return Nfb_minifyMappingForStorage_(entry, "name");
  });
}

function Analytics_getOrCreateFolder_(type) {
  var rootFolders = DriveApp.getFoldersByName(ANALYTICS_FOLDER_NAME);
  var rootFolder = rootFolders.hasNext() ? rootFolders.next() : DriveApp.createFolder(ANALYTICS_FOLDER_NAME);
  var subName = ANALYTICS_DASHBOARDS_SUBFOLDER_NAME;
  if (type === "questions") subName = ANALYTICS_QUESTIONS_SUBFOLDER_NAME;
  else if (type === "crossSearches") subName = ANALYTICS_CROSSSEARCHES_SUBFOLDER_NAME;
  var subFolders = rootFolder.getFoldersByName(subName);
  return subFolders.hasNext() ? subFolders.next() : rootFolder.createFolder(subName);
}


// ---- Action handler ディスパッチテーブル ----
// mode に応じて Analytics_*Template*_ ヘルパへ raw payload を中継する。
// idKey: payload 上の単一 ID キー。idsKey: 複数 ID 配列キー。

var ANALYTICS_HANDLERS_ = {
  "analytics_questions_list":             { type: "questions",  mode: "list" },
  "analytics_questions_get":              { type: "questions",  mode: "get",            idKey: "questionId" },
  "analytics_questions_save":             { type: "questions",  mode: "save",           payloadKey: "question" },
  "analytics_questions_delete":           { type: "questions",  mode: "delete_one",     idKey: "questionId" },
  "analytics_questions_delete_batch":     { type: "questions",  mode: "delete_batch",   idsKey: "questionIds" },
  "analytics_questions_archive":          { type: "questions",  mode: "archive_one",    idKey: "questionId",     archived: true },
  "analytics_questions_unarchive":        { type: "questions",  mode: "archive_one",    idKey: "questionId",     archived: false },
  "analytics_questions_delete_with_files_batch": { type: "questions",  mode: "delete_with_files_batch", idsKey: "questionIds" },
  "analytics_questions_archive_batch":    { type: "questions",  mode: "archive_batch",  idsKey: "questionIds",   archived: true },
  "analytics_questions_unarchive_batch":  { type: "questions",  mode: "archive_batch",  idsKey: "questionIds",   archived: false },
  "analytics_questions_copy":             { type: "questions",  mode: "copy",           idKey: "questionId" },
  "analytics_questions_import":           { type: "questions",  mode: "import" },
  "analytics_questions_register_import":  { type: "questions",  mode: "register" },
  "analytics_questions_resolve_ref":      { type: "questions",  mode: "resolve_ref" },
  "analytics_dashboards_list":            { type: "dashboards", mode: "list" },
  "analytics_dashboards_get":             { type: "dashboards", mode: "get",            idKey: "dashboardId" },
  "analytics_dashboards_save":            { type: "dashboards", mode: "save",           payloadKey: "dashboard" },
  "analytics_dashboards_delete":          { type: "dashboards", mode: "delete_one",     idKey: "dashboardId" },
  "analytics_dashboards_delete_batch":    { type: "dashboards", mode: "delete_batch",   idsKey: "dashboardIds" },
  "analytics_dashboards_archive":         { type: "dashboards", mode: "archive_one",    idKey: "dashboardId",    archived: true },
  "analytics_dashboards_unarchive":       { type: "dashboards", mode: "archive_one",    idKey: "dashboardId",    archived: false },
  "analytics_dashboards_delete_with_files_batch": { type: "dashboards", mode: "delete_with_files_batch", idsKey: "dashboardIds" },
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
  "analytics_dashboards_folder_delete":   { type: "dashboards", mode: "folder_delete" },
  // 串刺しフォーム検索（cross-form search）。import / register / resolve_ref は v1 では非対応。
  "analytics_cross_searches_list":            { type: "crossSearches", mode: "list" },
  "analytics_cross_searches_get":             { type: "crossSearches", mode: "get",            idKey: "crossSearchId" },
  "analytics_cross_searches_save":            { type: "crossSearches", mode: "save",           payloadKey: "crossSearch" },
  "analytics_cross_searches_delete":          { type: "crossSearches", mode: "delete_one",     idKey: "crossSearchId" },
  "analytics_cross_searches_delete_batch":    { type: "crossSearches", mode: "delete_batch",   idsKey: "crossSearchIds" },
  "analytics_cross_searches_delete_with_files_batch": { type: "crossSearches", mode: "delete_with_files_batch", idsKey: "crossSearchIds" },
  "analytics_cross_searches_archive":         { type: "crossSearches", mode: "archive_one",    idKey: "crossSearchId",  archived: true },
  "analytics_cross_searches_unarchive":       { type: "crossSearches", mode: "archive_one",    idKey: "crossSearchId",  archived: false },
  "analytics_cross_searches_archive_batch":   { type: "crossSearches", mode: "archive_batch",  idsKey: "crossSearchIds", archived: true },
  "analytics_cross_searches_unarchive_batch": { type: "crossSearches", mode: "archive_batch",  idsKey: "crossSearchIds", archived: false },
  "analytics_cross_searches_copy":            { type: "crossSearches", mode: "copy",           idKey: "crossSearchId" },
  "analytics_cross_searches_import":          { type: "crossSearches", mode: "import" },
  "analytics_cross_searches_register_import": { type: "crossSearches", mode: "register" },
  "analytics_cross_searches_folders_list":    { type: "crossSearches", mode: "folders_list" },
  "analytics_cross_searches_folder_create":   { type: "crossSearches", mode: "folder_create" },
  "analytics_cross_searches_move":            { type: "crossSearches", mode: "folder_move" },
  "analytics_cross_searches_folder_rename":   { type: "crossSearches", mode: "folder_rename" },
  "analytics_cross_searches_folder_delete":   { type: "crossSearches", mode: "folder_delete" }
};

function Analytics_dispatch_(action, ctx) {
  var def = ANALYTICS_HANDLERS_[action];
  var raw = (ctx && ctx.raw) || {};
  switch (def.mode) {
    case "list":          return Analytics_listTemplates_(def.type, raw.options || {});
    case "get":           return Analytics_getTemplate_(def.type, raw[def.idKey]);
    case "save":          return Analytics_saveTemplate_(def.type, raw[def.payloadKey]);
    case "delete_one":    return Analytics_deleteTemplates_(def.type, [raw[def.idKey]]);
    case "delete_batch":  return Analytics_deleteTemplates_(def.type, raw[def.idsKey] || []);
    case "delete_with_files_batch": return Analytics_deleteTemplatesWithFiles_(def.type, raw[def.idsKey] || []);
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

// ACTION_DEFINITIONS_（Code.gs）からは action 名で Analytics_dispatch_ を直接呼ぶため、
// かつての AnalyticsApi_*_ 1 行委譲ラッパー群は撤去した（純粋な中継のみで冗長だった）。

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
function nfbDeleteAnalyticsQuestionsWithFiles(questionIds) { return Analytics_runScriptAction_("analytics_questions_delete_with_files_batch", { questionIds: questionIds }); }
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
function nfbDeleteAnalyticsDashboardsWithFiles(dashboardIds) { return Analytics_runScriptAction_("analytics_dashboards_delete_with_files_batch", { dashboardIds: dashboardIds }); }
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
// 串刺しフォーム検索（cross-form search）。関数名は makeEntityClient("CrossSearch") が導出する
// nfb<Verb>AnalyticsCrossSearch[s] に一致させる（複数形は機械的に末尾 s を付与）。
function nfbListAnalyticsCrossSearchs(options)           { return Analytics_runScriptAction_("analytics_cross_searches_list",       { options: options || {} }); }
function nfbGetAnalyticsCrossSearch(crossSearchId)       { return Analytics_runScriptAction_("analytics_cross_searches_get",        { crossSearchId: crossSearchId }); }
function nfbSaveAnalyticsCrossSearch(payload)            { return Analytics_runScriptAction_("analytics_cross_searches_save",       payload); }
function nfbDeleteAnalyticsCrossSearch(crossSearchId)    { return Analytics_runScriptAction_("analytics_cross_searches_delete",     { crossSearchId: crossSearchId }); }
function nfbDeleteAnalyticsCrossSearchs(crossSearchIds)  { return Analytics_runScriptAction_("analytics_cross_searches_delete_batch", { crossSearchIds: crossSearchIds }); }
function nfbDeleteAnalyticsCrossSearchsWithFiles(crossSearchIds) { return Analytics_runScriptAction_("analytics_cross_searches_delete_with_files_batch", { crossSearchIds: crossSearchIds }); }
function nfbArchiveAnalyticsCrossSearch(crossSearchId)   { return Analytics_runScriptAction_("analytics_cross_searches_archive",    { crossSearchId: crossSearchId }); }
function nfbUnarchiveAnalyticsCrossSearch(crossSearchId) { return Analytics_runScriptAction_("analytics_cross_searches_unarchive",  { crossSearchId: crossSearchId }); }
function nfbArchiveAnalyticsCrossSearchs(crossSearchIds) { return Analytics_runScriptAction_("analytics_cross_searches_archive_batch", { crossSearchIds: crossSearchIds }); }
function nfbUnarchiveAnalyticsCrossSearchs(crossSearchIds) { return Analytics_runScriptAction_("analytics_cross_searches_unarchive_batch", { crossSearchIds: crossSearchIds }); }
function nfbCopyAnalyticsCrossSearch(crossSearchId)      { return Analytics_runScriptAction_("analytics_cross_searches_copy",       { crossSearchId: crossSearchId }); }
function nfbImportAnalyticsCrossSearchsFromDrive(url)    { return Analytics_runScriptAction_("analytics_cross_searches_import",      { url: url }); }
function nfbRegisterImportedAnalyticsCrossSearch(payload) { return Analytics_runScriptAction_("analytics_cross_searches_register_import", payload); }
function nfbListAnalyticsCrossSearchFolders()            { return Analytics_runScriptAction_("analytics_cross_searches_folders_list", {}); }
function nfbCreateAnalyticsCrossSearchFolder(path)       { return Analytics_runScriptAction_("analytics_cross_searches_folder_create", { path: path }); }
function nfbMoveAnalyticsCrossSearchs(payload)           { return Analytics_runScriptAction_("analytics_cross_searches_move",       payload); }
function nfbRenameAnalyticsCrossSearchFolder(payload)    { return Analytics_runScriptAction_("analytics_cross_searches_folder_rename", payload); }
function nfbDeleteAnalyticsCrossSearchFolder(path)       { return Analytics_runScriptAction_("analytics_cross_searches_folder_delete", { path: path }); }

function doGet(e) {
  const html = HtmlService.createHtmlOutputFromFile("Index");
  const webAppUrl = ScriptApp.getService().getUrl();
  let htmlContent = html.getContent();

  const formParam = e?.parameter?.form ? String(e.parameter.form) : "";
  const recordParam = e?.parameter?.record ? String(e.parameter.record) : "";
  const adminkeyParam = e?.parameter?.adminkey ? String(e.parameter.adminkey) : "";
  // 新しいタブで開いた Question 編集等の SPA ルートを iframe 内 React に伝えるためのパラメータ。
  // GAS は二重 iframe 構造で外側 URL のハッシュが内側に伝播しないため、ハッシュではなく ?route= で渡す。
  const routeParamRaw = e?.parameter?.route ? String(e.parameter.route) : "";
  const routeParam = routeParamRaw ? (routeParamRaw.charAt(0) === "/" ? routeParamRaw : "/" + routeParamRaw) : "";
  const userEmail = ResolveActiveUserEmail_();

  const authResult = DetermineAccess_(formParam, adminkeyParam, userEmail);
  const userProfile = userEmail ? ResolveActiveUserProfile_() : { displayName: "", affiliation: "", title: "", phone: "" };
  const userName = userProfile.displayName;
  const userAffiliation = userProfile.affiliation;
  const userTitle = userProfile.title;
  const userPhone = userProfile.phone;
  const adminEmail = authResult.isAdmin ? GetAdminEmail_() : "";
  const propertyStoreMode = Nfb_getPropertyStoreMode_();
  const adminSettingsEnabled = Nfb_isAdminSettingsEnabled_();

  const injectedScript = `<script>
    window.__GAS_WEBAPP_URL__ = "${EscapeForInlineScript_(webAppUrl)}";
    window.__IS_ADMIN__ = ${authResult.isAdmin};
    window.__FORM_ID__ = "${EscapeForInlineScript_(authResult.formId)}";
    window.__RECORD_ID__ = "${EscapeForInlineScript_(recordParam)}";
    window.__AUTH_ERROR__ = "${EscapeForInlineScript_(authResult.authError)}";
    window.__USER_EMAIL__ = "${EscapeForInlineScript_(userEmail)}";
    window.__USER_NAME__ = "${EscapeForInlineScript_(userName)}";
    window.__USER_AFFILIATION__ = "${EscapeForInlineScript_(userAffiliation)}";
    window.__USER_TITLE__ = "${EscapeForInlineScript_(userTitle)}";
    window.__USER_PHONE__ = "${EscapeForInlineScript_(userPhone)}";
    window.__ADMIN_EMAIL__ = "${EscapeForInlineScript_(adminEmail)}";
    window.__PROPERTY_STORE_MODE__ = "${EscapeForInlineScript_(propertyStoreMode)}";
    window.__ADMIN_SETTINGS_ENABLED__ = ${adminSettingsEnabled};
    window.__INITIAL_HASH__ = "${EscapeForInlineScript_(routeParam)}";
  </script>`;

  htmlContent = htmlContent.replace('</head>', injectedScript + '</head>');

  return HtmlService.createHtmlOutput(htmlContent)
    .setTitle("Nested Form Builder")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

const ACTION_DEFINITIONS_ = {
  "admin_key_get":   { handler: () => ({ ok: true, adminKey: GetAdminKey_() }), adminOnly: true },
  "admin_key_set":   { handler: (ctx) => SetAdminKey_(ctx.raw?.adminKey ?? ""), adminOnly: true },
  "admin_email_get": { handler: () => ({ ok: true, adminEmail: GetAdminEmail_() }), adminOnly: true },
  "admin_email_set": { handler: (ctx) => SetAdminEmail_(ctx.raw?.adminEmail ?? ""), adminOnly: true },
  // 標準フォルダ構成（システムごとコピー / マッピング再構築）
  "std_folders_copy":         { handler: (ctx) => StdFolders_copy_(ctx.raw || {}), adminOnly: true },
  "std_folders_rebuild_map":  { handler: (ctx) => StdFolders_rebuildMappings_(ctx.raw || {}), adminOnly: true },
  "std_folders_consume_rebuild": { handler: () => StdFolders_consumePendingRebuild_(), adminOnly: true },
  // doPost HTTP 用フォームアクション（従来契約）。list/get は nfb* 経由と同じくゲートなし。
  "forms_list":      { handler: FormsApi_List_ },
  "forms_get":       { handler: FormsApi_Get_ },
  "forms_create":    { handler: FormsApi_Create_, adminOnly: true },
  "forms_import":    { handler: FormsApi_Import_, adminOnly: true },
  "forms_update":    { handler: FormsApi_Update_, adminOnly: true },
  "forms_delete":    { handler: FormsApi_Delete_, adminOnly: true },
  "forms_archive":   { handler: FormsApi_SetArchived_, adminOnly: true },
  "forms_readonly":  { handler: FormsApi_SetReadOnly_, adminOnly: true },
  // google.script.run の nfb* フォーム関数が経由するアクション（従来どおりゲートなし）。
  "forms_save":                 { handler: (ctx) => Forms_dispatch_("forms_save", ctx) },
  "forms_delete_one":           { handler: (ctx) => Forms_dispatch_("forms_delete_one", ctx) },
  "forms_delete_batch":         { handler: (ctx) => Forms_dispatch_("forms_delete_batch", ctx) },
  "forms_archive_one":          { handler: (ctx) => Forms_dispatch_("forms_archive_one", ctx) },
  "forms_unarchive_one":        { handler: (ctx) => Forms_dispatch_("forms_unarchive_one", ctx) },
  "forms_archive_batch":        { handler: (ctx) => Forms_dispatch_("forms_archive_batch", ctx) },
  "forms_unarchive_batch":      { handler: (ctx) => Forms_dispatch_("forms_unarchive_batch", ctx) },
  "forms_readonly_set_one":     { handler: (ctx) => Forms_dispatch_("forms_readonly_set_one", ctx) },
  "forms_readonly_clear_one":   { handler: (ctx) => Forms_dispatch_("forms_readonly_clear_one", ctx) },
  "forms_readonly_set_batch":   { handler: (ctx) => Forms_dispatch_("forms_readonly_set_batch", ctx) },
  "forms_readonly_clear_batch": { handler: (ctx) => Forms_dispatch_("forms_readonly_clear_batch", ctx) },
  "forms_copy":                 { handler: (ctx) => Forms_dispatch_("forms_copy", ctx) },
  "forms_import_drive":         { handler: (ctx) => Forms_dispatch_("forms_import_drive", ctx) },
  "forms_register_import":      { handler: (ctx) => Forms_dispatch_("forms_register_import", ctx) },
  "forms_folders_list":         { handler: (ctx) => Forms_dispatch_("forms_folders_list", ctx) },
  "forms_folder_create":        { handler: (ctx) => Forms_dispatch_("forms_folder_create", ctx), adminOnly: true },
  "forms_move":                 { handler: (ctx) => Forms_dispatch_("forms_move", ctx), adminOnly: true },
  "forms_folder_rename":        { handler: (ctx) => Forms_dispatch_("forms_folder_rename", ctx), adminOnly: true },
  "forms_folder_delete":        { handler: (ctx) => Forms_dispatch_("forms_folder_delete", ctx), adminOnly: true },
  "delete":          { handler: DeleteRecord_, requireFormId: true, requireRecordId: true },
  "list":            { handler: ListRecordsAction_, requireFormId: true },
  "get":             { handler: GetRecord_, requireFormId: true, requireRecordId: true },
  "save":            { handler: SubmitResponses_, requireFormId: true },
  "save_lock":       { handler: AcquireSaveLock_, requireFormId: true },
  "sync_records":    { handler: SyncRecords_, requireFormId: true },
  "run_purge_check": { handler: RunPurgeCheck_ },
  "analytics_questions_list":              { handler: AnalyticsApi_ListQuestions_ },
  "analytics_questions_get":               { handler: AnalyticsApi_GetQuestion_ },
  "analytics_questions_save":              { handler: AnalyticsApi_SaveQuestion_,             adminOnly: true },
  "analytics_questions_delete":            { handler: AnalyticsApi_DeleteQuestion_,           adminOnly: true },
  "analytics_questions_delete_batch":      { handler: AnalyticsApi_DeleteQuestions_,          adminOnly: true },
  "analytics_questions_archive":           { handler: AnalyticsApi_ArchiveQuestion_,          adminOnly: true },
  "analytics_questions_unarchive":         { handler: AnalyticsApi_UnarchiveQuestion_,        adminOnly: true },
  "analytics_questions_archive_batch":     { handler: AnalyticsApi_ArchiveQuestions_,         adminOnly: true },
  "analytics_questions_unarchive_batch":   { handler: AnalyticsApi_UnarchiveQuestions_,       adminOnly: true },
  "analytics_questions_copy":              { handler: AnalyticsApi_CopyQuestion_,             adminOnly: true },
  "analytics_questions_import":            { handler: AnalyticsApi_ImportQuestions_,          adminOnly: true },
  "analytics_questions_register_import":   { handler: AnalyticsApi_RegisterImportedQuestion_, adminOnly: true },
  "analytics_dashboards_list":             { handler: AnalyticsApi_ListDashboards_ },
  "analytics_dashboards_get":              { handler: AnalyticsApi_GetDashboard_ },
  "analytics_dashboards_save":             { handler: AnalyticsApi_SaveDashboard_,            adminOnly: true },
  "analytics_dashboards_delete":           { handler: AnalyticsApi_DeleteDashboard_,          adminOnly: true },
  "analytics_dashboards_delete_batch":     { handler: AnalyticsApi_DeleteDashboards_,         adminOnly: true },
  "analytics_dashboards_archive":          { handler: AnalyticsApi_ArchiveDashboard_,         adminOnly: true },
  "analytics_dashboards_unarchive":        { handler: AnalyticsApi_UnarchiveDashboard_,       adminOnly: true },
  "analytics_dashboards_archive_batch":    { handler: AnalyticsApi_ArchiveDashboards_,        adminOnly: true },
  "analytics_dashboards_unarchive_batch":  { handler: AnalyticsApi_UnarchiveDashboards_,      adminOnly: true },
  "analytics_dashboards_copy":             { handler: AnalyticsApi_CopyDashboard_,            adminOnly: true },
  "analytics_dashboards_import":           { handler: AnalyticsApi_ImportDashboards_,         adminOnly: true },
  "analytics_dashboards_register_import":  { handler: AnalyticsApi_RegisterImportedDashboard_, adminOnly: true },
  "analytics_questions_folders_list":      { handler: AnalyticsApi_ListQuestionFolders_ },
  "analytics_questions_folder_create":     { handler: AnalyticsApi_CreateQuestionFolder_,  adminOnly: true },
  "analytics_questions_move":              { handler: AnalyticsApi_MoveQuestions_,          adminOnly: true },
  "analytics_questions_folder_rename":     { handler: AnalyticsApi_RenameQuestionFolder_,   adminOnly: true },
  "analytics_questions_folder_delete":     { handler: AnalyticsApi_DeleteQuestionFolder_,   adminOnly: true },
  "analytics_dashboards_folders_list":     { handler: AnalyticsApi_ListDashboardFolders_ },
  "analytics_dashboards_folder_create":    { handler: AnalyticsApi_CreateDashboardFolder_, adminOnly: true },
  "analytics_dashboards_move":             { handler: AnalyticsApi_MoveDashboards_,         adminOnly: true },
  "analytics_dashboards_folder_rename":    { handler: AnalyticsApi_RenameDashboardFolder_,  adminOnly: true },
  "analytics_dashboards_folder_delete":    { handler: AnalyticsApi_DeleteDashboardFolder_,  adminOnly: true },
};

function ResolveActionContext_(rawPayload, source) {
  return source === "doPost"
    ? Model_parseRequest_(rawPayload)
    : Model_fromScriptRunPayload_(rawPayload);
}

function ExecuteActionHttpError_(message, source) {
  if (source !== "doPost") return { ok: false, error: message };
  return JsonBadRequest_(message);
}

function ExecuteActionAuthError_(message, source) {
  if (source !== "doPost") return { ok: false, error: message };
  return JsonForbidden_(message);
}

function ExecuteActionInternalError_(err, source) {
  if (source !== "doPost") return nfbFail_(err);
  return JsonInternalError_(err);
}

function ExecuteActionSuccess_(result, source) {
  if (source !== "doPost") return result;
  return JsonOutput_(result, 200);
}

function executeAction_(action, rawPayload, options = {}) {
  const source = options.source || "scriptRun";
  Nfb_resetFormRequestCache_();
  const ctx = ResolveActionContext_(rawPayload, source);
  const resolvedAction = action || ctx.raw?.action || "save";
  const route = ACTION_DEFINITIONS_[resolvedAction];
  if (!route) return ExecuteActionHttpError_("Unknown action", source);

  if (route.adminOnly) {
    const adminSettingsEnabled = Nfb_isAdminSettingsEnabled_();
    if (!adminSettingsEnabled && resolvedAction.startsWith("admin_")) {
      return ExecuteActionAuthError_("管理者設定は現在のプロパティ保存モードでは利用できません", source);
    }
    if (adminSettingsEnabled) {
      const isAdmin = IsAdmin_(ctx.raw?.authKey || "", ResolveActiveUserEmail_());
      if (!isAdmin) return ExecuteActionAuthError_("管理者権限が必要です", source);
    }
  }

  if (route.requireFormId) {
    const formIdErr = RequireFormId_(ctx);
    if (formIdErr) return ExecuteActionHttpError_(formIdErr.error, source);
    // spreadsheetId / sheetName はクライアント送信値を信用せず formId から権威的に解決する。
    const target = Nfb_resolveFormSheetTarget_(ctx.raw.formId);
    if (!target) {
      const ssErr = RequireSpreadsheetId_({});
      return ExecuteActionHttpError_(ssErr.error, source);
    }
    ctx.spreadsheetId = target.spreadsheetId;
    ctx.sheetName = target.sheetName;
  }
  if (route.requireRecordId) {
    const idErr = RequireRecordId_(ctx);
    if (idErr) return ExecuteActionHttpError_(idErr.error, source);
  }

  if (!route.skipRateLimit) {
    const rl = Nfb_checkRateLimit_();
    if (rl) return Nfb_rateLimitResponse_(rl, source);
  }

  try {
    const result = route.handler(ctx);
    return ExecuteActionSuccess_(result, source);
  } catch (err) {
    return ExecuteActionInternalError_(err, source);
  }
}

// デプロイがテストモード(/dev)かを判定する。
// 1) Script Property NFB_DEPLOY_MODE の手動上書きを最優先（"test"/"prod"）。
// 2) 次に deploy.ps1 がビルド時に焼き込む NFB_DEPLOY_MODE_BAKED（-TestMode で "test"）。
// 3) 未設定時は公開 URL 末尾を補助的に見る。ただし ScriptApp.getService().getUrl() は
//    アクセス経路に依らず /exec を返すことが多く /dev を確実に検出できないため補助扱い。
// 4) いずれも不明なら安全側（prod = email 必須）。
function Nfb_isTestModeDeploy_() {
  try {
    var mode = Nfb_getScriptProperties_().getProperty(NFB_DEPLOY_MODE_KEY);
    if (mode === "test") return true;
    if (mode === "prod") return false;
  } catch (e) { /* fallthrough */ }
  // deploy.ps1 がビルド時に焼き込んだデプロイ種別（-TestMode で "test"）。
  var baked = String(NFB_DEPLOY_MODE_BAKED || "").trim().toLowerCase();
  if (baked === "test") return true;
  if (baked === "prod") return false;
  try {
    var url = ScriptApp.getService().getUrl() || "";
    if (/\/dev$/.test(url)) return true;
  } catch (e2) { /* fallthrough */ }
  return false;
}

// ユーザーあたり 120 回/分のスライディングウィンドウ（分バケット）。fail-open しない。
// 本番(prod)で email 取得不可なら UNAUTHORIZED。テストモードでは email 空も許可するが、
// 全匿名アクセスは email="" の単一カウンタを共有する。
// 制限内なら null（=通過）、制限/拒否時はエラーオブジェクトを返す。
function Nfb_checkRateLimit_() {
  var email = ResolveActiveUserEmail_();
  var isTestMode = Nfb_isTestModeDeploy_();
  if (!email && !isTestMode) {
    return { ok: false, error: "認証が必要です", code: "UNAUTHORIZED" };
  }
  var key = "rl:" + email + ":" + Math.floor(Date.now() / 60000);
  try {
    var cache = CacheService.getScriptCache();
    var count = parseInt(cache.get(key), 10) || 0;
    if (count >= NFB_RATE_LIMIT_PER_MINUTE) {
      return { ok: false, error: "リクエストが多すぎます。しばらくお待ちください", code: "RATE_LIMITED" };
    }
    cache.put(key, String(count + 1), 90);
    return null;
  } catch (e) {
    Logger.log("[Nfb_checkRateLimit_] cache error: " + e);
    return { ok: false, error: "処理中にエラーが発生しました", code: "INTERNAL" };
  }
}

// レート制限エラーのレスポンス整形。doPost は HTTP ステータスを付ける。
function Nfb_rateLimitResponse_(rl, source) {
  if (source !== "doPost") return rl;
  var status = rl.code === "UNAUTHORIZED" ? 403 : (rl.code === "RATE_LIMITED" ? 429 : 500);
  return JsonOutput_(rl, status);
}

function doPost(e) {
  return handleCors_(e, () => executeAction_(null, e, { source: "doPost" }));
}

function saveResponses(payload) {
  return executeAction_("save", payload, { source: "scriptRun" });
}

function nfbAcquireSaveLock(payload) {
  return executeAction_("save_lock", payload, { source: "scriptRun" });
}

function deleteRecord(payload) {
  return executeAction_("delete", payload, { source: "scriptRun" });
}

function getRecord(payload) {
  return executeAction_("get", payload, { source: "scriptRun" });
}

function listRecords(payload) {
  return executeAction_("list", payload, { source: "scriptRun" });
}

function nfbRunPurgeCheck(payload) {
  return executeAction_("run_purge_check", payload, { source: "scriptRun" });
}

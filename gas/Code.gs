function doGet(e) {
  const output = HtmlService.createHtmlOutputFromFile("Index");
  const webAppUrl = ScriptApp.getService().getUrl();

  const formParam = e?.parameter?.form ? String(e.parameter.form) : "";
  const recordParam = e?.parameter?.record ? String(e.parameter.record) : "";
  // pid（親レコード ID）。指定されている間は、その pid に等しい行だけを一覧し、
  // 新規行にはその pid を必ず刻む。フロントは window.__PID__ を読んで各 API 呼び出しに付与する。
  const pidParam = e?.parameter?.pid ? String(e.parameter.pid) : "";
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
    window.__PID__ = "${EscapeForInlineScript_(pidParam)}";
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

  // バンドル全体を createHtmlOutput(string) で再パースすると、インライン script 内に構造タグ
  // （<script>/<style>/<head>/<body>/<html> 等）の部分文字列があった場合に GAS のパーサが入れ子を
  // 誤認し「形式が正しくない HTML コンテンツ」で doGet 全体が落ちる。よって getContent()→replace→
  // createHtmlOutput(string) の往復はやめ、ファイル出力（信頼パス＝厳格検証されない）に注入スクリプト
  // だけを append する。本体 2MB はパーサに渡らないので、フロントが構造タグ部分文字列を含んでも安全。
  // append された script は </html> の後ろに付くが classic script なので defer の React module より
  // 先に実行され、__INITIAL_HASH__ を含む window グローバルは読まれる前にセットされる（順序保証は
  // 従来の </head> 直前注入と同じ）。
  output.append(injectedScript);

  return output
    .setTitle("Nested Form Builder")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

const ACTION_DEFINITIONS_ = {
  "admin_key_get":   { handler: () => ({ ok: true, adminKey: GetAdminKey_() }), adminOnly: true },
  "admin_key_set":   { handler: (ctx) => SetAdminKey_(ctx.raw?.adminKey ?? ""), adminOnly: true },
  "admin_email_get": { handler: () => ({ ok: true, adminEmail: GetAdminEmail_() }), adminOnly: true },
  "admin_email_set": { handler: (ctx) => SetAdminEmail_(ctx.raw?.adminEmail ?? ""), adminOnly: true },
  "admin_ext_action_secret_get": { handler: () => ({ ok: true, extActionSecret: GetExtActionSecret_() }), adminOnly: true },
  // バックエンド（Bundle.gs）のデプロイ時刻。deploy.ps1 が焼き込む。設定画面の「システム情報」表示用（ゲートなし）。
  "deploy_info_get": { handler: () => ({ ok: true, backendDeployTime: Nfb_getBackendDeployTime_() }) },
  "admin_ext_action_secret_set": { handler: (ctx) => SetExtActionSecret_(ctx.raw?.extActionSecret ?? ""), adminOnly: true },
  // 標準フォルダ構成（システムごとコピー / マッピングのエクスポート・インポート）
  // 注: 同期走査（std_folders_rebuild_map）と構成レポート（std_folders_link_report）は廃止。
  //     参照の再リンク / 同名重複整理は保存時のサーバ側自動リンク補完（alignReferencesOnSave_）が担う。
  "std_folders_copy":         { handler: (ctx) => StdFolders_copy_(ctx.raw || {}), adminOnly: true },
  "std_folders_export_map":   { handler: () => StdFolders_exportMapping_(), adminOnly: true },
  "std_folders_import_map":   { handler: (ctx) => StdFolders_importMappingFromSource_(ctx.raw || {}), adminOnly: true },
  "std_folders_get_root":     { handler: () => StdFolders_getRootInfo_(), adminOnly: true },
  "std_folders_ensure":       { handler: (ctx) => StdFolders_ensureFolders_(ctx.raw || {}), adminOnly: true },
  "std_folders_align_all":    { handler: () => StdFolders_alignAllEntries_(), adminOnly: true },
  "std_backfill_ref_paths":   { handler: () => nfbSafeCall_(() => Admin_backfillRefPaths_()), adminOnly: true },
  // 印刷様式テンプレート一覧（05_report_templates 配下の Google ドキュメント）。論理パス選択 UI 用の読み取り専用。
  "report_templates_list":    { handler: () => StdFolders_listFiles_("report_templates", "application/vnd.google-apps.document") },
  // スプレッドシート一覧（04_spreadsheets 配下の Google スプレッドシート）。フォーム→シートの論理パス選択 UI 用の読み取り専用。
  "spreadsheets_list":        { handler: () => StdFolders_listFiles_("spreadsheets", "application/vnd.google-apps.spreadsheet") },
  // 外部アクション（externalAction）のサーバ間リレー送信。送信自体は全ユーザー可
  // （機微 storage はクライアントが adminOnly && isAdmin のときだけ payload に載せる）。
  "ext_action_send":          { handler: (ctx) => ExtAction_send_(ctx.raw || {}) },
  // doPost HTTP 用フォームアクション（従来契約）。list/get は nfb* 経由と同じくゲートなし。
  "forms_list":      { handler: (ctx) => Forms_dispatch_("forms_list", ctx) },
  "forms_get":       { handler: (ctx) => Forms_dispatch_("forms_get", ctx) },
  "forms_create":    { handler: (ctx) => Forms_dispatch_("forms_save", ctx), adminOnly: true },
  "forms_import":    { handler: (ctx) => Forms_dispatch_("forms_import", ctx), adminOnly: true },
  "forms_update":    { handler: (ctx) => Forms_dispatch_("forms_update", ctx), adminOnly: true },
  "forms_delete":    { handler: (ctx) => Forms_dispatch_("forms_delete_one", ctx), adminOnly: true },
  // archived / readOnly フラグは doPost の文字列値（"true"/"false"）を真偽へ正規化してから分岐するため
  // 専用ハンドラを残す（純粋な 1 行転送ではない）。
  "forms_archive":   { handler: FormsApi_SetArchived_, adminOnly: true },
  "forms_readonly":  { handler: FormsApi_SetReadOnly_, adminOnly: true },
  // google.script.run の nfb* フォーム関数が経由するアクション（従来どおりゲートなし）。
  "forms_save":                 { handler: (ctx) => Forms_dispatch_("forms_save", ctx) },
  "forms_delete_one":           { handler: (ctx) => Forms_dispatch_("forms_delete_one", ctx) },
  "forms_delete_batch":         { handler: (ctx) => Forms_dispatch_("forms_delete_batch", ctx) },
  "forms_delete_with_files_batch": { handler: (ctx) => Forms_dispatch_("forms_delete_with_files_batch", ctx) },
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
  "forms_resolve_ref":          { handler: (ctx) => Forms_dispatch_("forms_resolve_ref", ctx) },
  "forms_folders_list":         { handler: (ctx) => Forms_dispatch_("forms_folders_list", ctx) },
  "forms_folder_create":        { handler: (ctx) => Forms_dispatch_("forms_folder_create", ctx), adminOnly: true },
  "forms_move":                 { handler: (ctx) => Forms_dispatch_("forms_move", ctx), adminOnly: true },
  "forms_folder_rename":        { handler: (ctx) => Forms_dispatch_("forms_folder_rename", ctx), adminOnly: true },
  "forms_folder_delete":        { handler: (ctx) => Forms_dispatch_("forms_folder_delete", ctx), adminOnly: true },
  "forms_folders_backfill_physical": { handler: (ctx) => Forms_dispatch_("forms_folders_backfill_physical", ctx), adminOnly: true },
  "delete":          { handler: DeleteRecord_, requireFormId: true, requireRecordId: true },
  "list":            { handler: ListRecordsAction_, requireFormId: true },
  "get":             { handler: GetRecord_, requireFormId: true, requireRecordId: true },
  "save":            { handler: SubmitResponses_, requireFormId: true },
  "save_lock":       { handler: AcquireSaveLock_, requireFormId: true },
  "sync_records":    { handler: SyncRecords_, requireFormId: true },
  "run_purge_check": { handler: RunPurgeCheck_ },
  // Analytics（Question / Dashboard）は宣言的ハンドラ表 ANALYTICS_HANDLERS_ ＋中央 Analytics_dispatch_ に
  // 収束する。ACTION_DEFINITIONS_ からは action 名で dispatch を直接呼ぶ（Forms の forms_* と同じ書き味）。
  "analytics_questions_list":              { handler: (ctx) => Analytics_dispatch_("analytics_questions_list", ctx) },
  "analytics_questions_get":               { handler: (ctx) => Analytics_dispatch_("analytics_questions_get", ctx) },
  "analytics_questions_save":              { handler: (ctx) => Analytics_dispatch_("analytics_questions_save", ctx),             adminOnly: true },
  "analytics_questions_delete":            { handler: (ctx) => Analytics_dispatch_("analytics_questions_delete", ctx),           adminOnly: true },
  "analytics_questions_delete_batch":      { handler: (ctx) => Analytics_dispatch_("analytics_questions_delete_batch", ctx),     adminOnly: true },
  "analytics_questions_delete_with_files_batch": { handler: (ctx) => Analytics_dispatch_("analytics_questions_delete_with_files_batch", ctx), adminOnly: true },
  "analytics_questions_archive":           { handler: (ctx) => Analytics_dispatch_("analytics_questions_archive", ctx),          adminOnly: true },
  "analytics_questions_unarchive":         { handler: (ctx) => Analytics_dispatch_("analytics_questions_unarchive", ctx),        adminOnly: true },
  "analytics_questions_archive_batch":     { handler: (ctx) => Analytics_dispatch_("analytics_questions_archive_batch", ctx),    adminOnly: true },
  "analytics_questions_unarchive_batch":   { handler: (ctx) => Analytics_dispatch_("analytics_questions_unarchive_batch", ctx),  adminOnly: true },
  "analytics_questions_copy":              { handler: (ctx) => Analytics_dispatch_("analytics_questions_copy", ctx),             adminOnly: true },
  "analytics_questions_import":            { handler: (ctx) => Analytics_dispatch_("analytics_questions_import", ctx),           adminOnly: true },
  "analytics_questions_register_import":   { handler: (ctx) => Analytics_dispatch_("analytics_questions_register_import", ctx),  adminOnly: true },
  "analytics_questions_resolve_ref":       { handler: (ctx) => Analytics_dispatch_("analytics_questions_resolve_ref", ctx) },
  "analytics_dashboards_list":             { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_list", ctx) },
  "analytics_dashboards_get":              { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_get", ctx) },
  "analytics_dashboards_save":             { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_save", ctx),            adminOnly: true },
  "analytics_dashboards_delete":           { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_delete", ctx),          adminOnly: true },
  "analytics_dashboards_delete_batch":     { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_delete_batch", ctx),    adminOnly: true },
  "analytics_dashboards_delete_with_files_batch": { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_delete_with_files_batch", ctx), adminOnly: true },
  "analytics_dashboards_archive":          { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_archive", ctx),         adminOnly: true },
  "analytics_dashboards_unarchive":        { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_unarchive", ctx),       adminOnly: true },
  "analytics_dashboards_archive_batch":    { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_archive_batch", ctx),   adminOnly: true },
  "analytics_dashboards_unarchive_batch":  { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_unarchive_batch", ctx), adminOnly: true },
  "analytics_dashboards_copy":             { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_copy", ctx),            adminOnly: true },
  "analytics_dashboards_import":           { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_import", ctx),          adminOnly: true },
  "analytics_dashboards_register_import":  { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_register_import", ctx), adminOnly: true },
  "analytics_questions_folders_list":      { handler: (ctx) => Analytics_dispatch_("analytics_questions_folders_list", ctx) },
  "analytics_questions_folder_create":     { handler: (ctx) => Analytics_dispatch_("analytics_questions_folder_create", ctx),   adminOnly: true },
  "analytics_questions_move":              { handler: (ctx) => Analytics_dispatch_("analytics_questions_move", ctx),             adminOnly: true },
  "analytics_questions_folder_rename":     { handler: (ctx) => Analytics_dispatch_("analytics_questions_folder_rename", ctx),    adminOnly: true },
  "analytics_questions_folder_delete":     { handler: (ctx) => Analytics_dispatch_("analytics_questions_folder_delete", ctx),    adminOnly: true },
  "analytics_dashboards_folders_list":     { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_folders_list", ctx) },
  "analytics_dashboards_folder_create":    { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_folder_create", ctx),  adminOnly: true },
  "analytics_dashboards_move":             { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_move", ctx),            adminOnly: true },
  "analytics_dashboards_folder_rename":    { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_folder_rename", ctx),   adminOnly: true },
  "analytics_dashboards_folder_delete":    { handler: (ctx) => Analytics_dispatch_("analytics_dashboards_folder_delete", ctx),   adminOnly: true },
  // 串刺しフォーム検索（cross-form search）。一覧/取得/フォルダ一覧は閲覧可、変更系は管理者のみ。
  "analytics_cross_searches_list":            { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_list", ctx) },
  "analytics_cross_searches_get":             { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_get", ctx) },
  "analytics_cross_searches_save":            { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_save", ctx),            adminOnly: true },
  "analytics_cross_searches_delete":          { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_delete", ctx),          adminOnly: true },
  "analytics_cross_searches_delete_batch":    { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_delete_batch", ctx),    adminOnly: true },
  "analytics_cross_searches_delete_with_files_batch": { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_delete_with_files_batch", ctx), adminOnly: true },
  "analytics_cross_searches_archive":         { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_archive", ctx),         adminOnly: true },
  "analytics_cross_searches_unarchive":       { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_unarchive", ctx),       adminOnly: true },
  "analytics_cross_searches_archive_batch":   { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_archive_batch", ctx),   adminOnly: true },
  "analytics_cross_searches_unarchive_batch": { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_unarchive_batch", ctx), adminOnly: true },
  "analytics_cross_searches_copy":            { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_copy", ctx),            adminOnly: true },
  "analytics_cross_searches_import":          { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_import", ctx),          adminOnly: true },
  "analytics_cross_searches_register_import": { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_register_import", ctx), adminOnly: true },
  "analytics_cross_searches_folders_list":    { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_folders_list", ctx) },
  "analytics_cross_searches_folder_create":   { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_folder_create", ctx),  adminOnly: true },
  "analytics_cross_searches_move":            { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_move", ctx),            adminOnly: true },
  "analytics_cross_searches_folder_rename":   { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_folder_rename", ctx),   adminOnly: true },
  "analytics_cross_searches_folder_delete":   { handler: (ctx) => Analytics_dispatch_("analytics_cross_searches_folder_delete", ctx),   adminOnly: true },
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

// バックエンド（Bundle.gs）のデプロイ時刻を返す。deploy.ps1 が NFB_DEPLOY_TIME_BAKED へ焼き込む。
// 未置換（手動 bundle 等でプレースホルダのまま）の場合は空文字へ正規化する。
function Nfb_getBackendDeployTime_() {
  var baked = Nfb_trimStr_(NFB_DEPLOY_TIME_BAKED);
  // 未置換ならプレースホルダ文字列のまま残るので空扱いにする。
  // 注: deploy.ps1 は焼き込みプレースホルダを全置換するため、この比較用リテラルを
  //     連結で組み立てて「置換対象に巻き込まれない」ようにする（直書きすると自分も置換され誤判定する）。
  var placeholder = "__NFB_" + "DEPLOY_TIME__";
  if (!baked || baked === placeholder) return "";
  return baked;
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
  var baked = Nfb_trimStr_(NFB_DEPLOY_MODE_BAKED).toLowerCase();
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
    return { ok: false, error: NFB_GENERIC_INTERNAL_ERROR_MESSAGE, code: "INTERNAL" };
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

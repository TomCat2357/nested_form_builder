function doGet(e) {
  const html = HtmlService.createHtmlOutputFromFile("Index");
  const webAppUrl = ScriptApp.getService().getUrl();
  let htmlContent = html.getContent();

  const formParam = e?.parameter?.form ? String(e.parameter.form) : "";
  const recordParam = e?.parameter?.record ? String(e.parameter.record) : "";
  const adminkeyParam = e?.parameter?.adminkey ? String(e.parameter.adminkey) : "";
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
  "forms_list":      { handler: FormsApi_List_, adminOnly: true },
  "forms_get":       { handler: FormsApi_Get_, adminOnly: true },
  "forms_create":    { handler: FormsApi_Create_, adminOnly: true },
  "forms_import":    { handler: FormsApi_Import_, adminOnly: true },
  "forms_update":    { handler: FormsApi_Update_, adminOnly: true },
  "forms_delete":    { handler: FormsApi_Delete_, adminOnly: true },
  "forms_archive":   { handler: FormsApi_SetArchived_, adminOnly: true },
  "forms_readonly":  { handler: FormsApi_SetReadOnly_, adminOnly: true },
  "delete":          { handler: DeleteRecord_, requireSpreadsheetId: true, requireRecordId: true },
  "list":            { handler: ListRecordsAction_, requireSpreadsheetId: true },
  "get":             { handler: GetRecord_, requireSpreadsheetId: true, requireRecordId: true },
  "save":            { handler: SubmitResponses_, requireSpreadsheetId: true },
  "save_lock":       { handler: AcquireSaveLock_, requireSpreadsheetId: true },
  "sync_records":    { handler: SyncRecords_, requireSpreadsheetId: true },
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

  if (route.requireSpreadsheetId) {
    const ssErr = RequireSpreadsheetId_(ctx);
    if (ssErr) return ExecuteActionHttpError_(ssErr.error, source);
  }
  if (route.requireRecordId) {
    const idErr = RequireRecordId_(ctx);
    if (idErr) return ExecuteActionHttpError_(idErr.error, source);
  }

  try {
    const result = route.handler(ctx);
    return ExecuteActionSuccess_(result, source);
  } catch (err) {
    return ExecuteActionInternalError_(err, source);
  }
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

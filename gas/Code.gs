function doGet(e) {
  const html = HtmlService.createHtmlOutputFromFile("Index");
  const webAppUrl = ScriptApp.getService().getUrl();
  let htmlContent = html.getContent();

  const formParam = e?.parameter?.form ? String(e.parameter.form) : "";
  const adminkeyParam = e?.parameter?.adminkey ? String(e.parameter.adminkey) : "";
  const userEmail = Session.getActiveUser().getEmail() || "";

  const authResult = DetermineAccess_(formParam, adminkeyParam, userEmail);
  const userName = ResolveActiveUserDisplayName_();
  const adminEmail = GetAdminEmail_();
  const propertyStoreMode = Nfb_getPropertyStoreMode_();
  const adminSettingsEnabled = Nfb_isAdminSettingsEnabled_();

  const injectedScript = `<script>
    window.__GAS_WEBAPP_URL__ = "${EscapeForInlineScript_(webAppUrl)}";
    window.__IS_ADMIN__ = ${authResult.isAdmin};
    window.__FORM_ID__ = "${EscapeForInlineScript_(authResult.formId)}";
    window.__AUTH_ERROR__ = "${EscapeForInlineScript_(authResult.authError)}";
    window.__USER_EMAIL__ = "${EscapeForInlineScript_(userEmail)}";
    window.__USER_NAME__ = "${EscapeForInlineScript_(userName)}";
    window.__ADMIN_EMAIL__ = "${EscapeForInlineScript_(adminEmail)}";
    window.__PROPERTY_STORE_MODE__ = "${EscapeForInlineScript_(propertyStoreMode)}";
    window.__ADMIN_SETTINGS_ENABLED__ = ${adminSettingsEnabled};
  </script>`;

  htmlContent = htmlContent.replace('</head>', injectedScript + '</head>');

  return HtmlService.createHtmlOutput(htmlContent)
    .setTitle("Nested Form Builder")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function ResolveActiveUserDisplayName_() {
  try {
    const raw = Session.getActiveUser().getEmail() || "";
    const match = raw.match(/^(.*?)\s*<[^>]+>$/);
    return match && match[1] ? String(match[1]).trim() : "";
  } catch (err) {
    return "";
  }
}

function EscapeForInlineScript_(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/<\/script/gi, "<\\/script");
}

function doPost(e) {
  return handleCors_(e, () => {
    const ctx = Model_parseRequest_(e);
    const action = ctx.raw?.action || "save";
    const adminSettingsEnabled = Nfb_isAdminSettingsEnabled_();

    const adminKeyParam = ctx.raw?.authKey ? String(ctx.raw.authKey) : "";
    const userEmail = Session.getActiveUser().getEmail() || "";
    const isAdmin = adminSettingsEnabled ? IsAdmin_(adminKeyParam, userEmail) : false;

    const formAdminOnlyActions = ["forms_create", "forms_update", "forms_delete", "forms_import", "forms_archive"];
    const adminSettingsActions = ["admin_key_get", "admin_key_set", "admin_email_get", "admin_email_set"];

    try {
      if (!adminSettingsEnabled && adminSettingsActions.includes(action)) {
        return JsonForbidden_("管理者設定は現在のプロパティ保存モードでは利用できません");
      }

      if (adminSettingsEnabled && (formAdminOnlyActions.includes(action) || adminSettingsActions.includes(action)) && !isAdmin) {
        return JsonForbidden_("管理者権限が必要です");
      }

      let payload;
      switch (action) {
        case "admin_key_get": payload = { ok: true, adminKey: GetAdminKey_() }; break;
        case "admin_key_set": payload = SetAdminKey_(ctx.raw?.adminKey ?? ""); break;
        case "admin_email_get": payload = { ok: true, adminEmail: GetAdminEmail_() }; break;
        case "admin_email_set": payload = SetAdminEmail_(ctx.raw?.adminEmail ?? ""); break;
        case "forms_list": payload = FormsApi_List_(ctx); break;
        case "forms_get": payload = FormsApi_Get_(ctx); break;
        case "forms_create": payload = FormsApi_Create_(ctx); break;
        case "forms_import": payload = FormsApi_Import_(ctx); break;
        case "forms_update": payload = FormsApi_Update_(ctx); break;
        case "forms_delete": payload = FormsApi_Delete_(ctx); break;
        case "forms_archive": payload = FormsApi_SetArchived_(ctx); break;
        case "delete":
          if (RequireSpreadsheetId_(ctx)) return JsonBadRequest_(RequireSpreadsheetId_(ctx).error);
          payload = DeleteRecord_(ctx); break;
        case "list":
          if (RequireSpreadsheetId_(ctx)) return JsonBadRequest_(RequireSpreadsheetId_(ctx).error);
          payload = ListRecords_(ctx); break;
        case "get":
          if (RequireSpreadsheetId_(ctx)) return JsonBadRequest_(RequireSpreadsheetId_(ctx).error);
          payload = GetRecord_(ctx); break;
        default:
          if (RequireSpreadsheetId_(ctx)) return JsonBadRequest_(RequireSpreadsheetId_(ctx).error);
          payload = SubmitResponses_(ctx); break;
      }
      return JsonOutput_(payload, 200);
    } catch (err) {
      return JsonInternalError_(err);
    }
  });
}

function saveResponses(payload) {
  return nfbSafeCall_(() => {
    const ctx = Model_fromScriptRunPayload_(payload);
    const ssErr = RequireSpreadsheetId_(ctx);
    if (ssErr) return ssErr;
    return SubmitResponses_(ctx);
  });
}

function deleteRecord(payload) {
  return nfbSafeCall_(() => {
    const ctx = Model_fromScriptRunPayload_(payload);
    const ssErr = RequireSpreadsheetId_(ctx) || RequireRecordId_(ctx);
    if (ssErr) return ssErr;
    return DeleteRecord_(ctx);
  });
}

function getRecord(payload) {
  return nfbSafeCall_(() => {
    const ctx = Model_fromScriptRunPayload_(payload);
    const ssErr = RequireSpreadsheetId_(ctx) || RequireRecordId_(ctx);
    if (ssErr) return ssErr;
    return GetRecord_(ctx);
  });
}

function listRecords(payload) {
  return nfbSafeCall_(() => {
    const ctx = Model_fromScriptRunPayload_(payload);
    const ssErr = RequireSpreadsheetId_(ctx);
    if (ssErr) return ssErr;
    const result = ListRecords_(ctx);
    if (result?.records) result.records = result.records.map(SerializeRecord_);
    return result;
  });
}

function SerializeValue_(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function SerializeDateLike_(value, options = {}) {
  const date = Sheets_parseDateLikeToJstDate_(value, options.allowSerialNumber);
  return date ? { iso: date.toISOString(), unixMs: Sheets_toUnixMs_(date) } : { iso: SerializeValue_(value), unixMs: null };
}

function SerializeRecord_(record) {
  const serializedData = {};
  const serializedDataUnixMs = {};

  if (record.data && typeof record.data === "object") {
    Object.entries(record.data).forEach(([key, value]) => {
      const dateInfo = SerializeDateLike_(value);
      serializedData[key] = dateInfo.iso;
      if (dateInfo.unixMs !== null) serializedDataUnixMs[key] = dateInfo.unixMs;
    });
  }

  const createdInfo = SerializeDateLike_(record.createdAt, { allowSerialNumber: true });
  const modifiedInfo = SerializeDateLike_(record.modifiedAt, { allowSerialNumber: true });

  return {
    id: String(record.id || ""),
    "No.": record["No."] ?? "",
    modifiedBy: record.modifiedBy || "",
    createdBy: record.createdBy || "",
    createdAt: createdInfo.unixMs ?? createdInfo.iso,
    modifiedAt: modifiedInfo.unixMs ?? modifiedInfo.iso,
    createdAtUnixMs: createdInfo.unixMs,
    modifiedAtUnixMs: modifiedInfo.unixMs,
    data: serializedData,
    dataUnixMs: serializedDataUnixMs
  };
}

function SubmitResponses_(ctx) {
  const sheet = Sheets_getOrCreateSheet_(ctx.spreadsheetId, ctx.sheetName);
  const result = Sheets_upsertRecordById_(sheet, ctx.order, ctx);
  return {
    ok: true,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ctx.spreadsheetId}`,
    sheetName: ctx.sheetName,
    rowNumber: result.row,
    id: result.id,
  };
}

function DeleteRecord_(ctx) {
  const idErr = RequireRecordId_(ctx);
  if (idErr) return idErr;
  const sheet = Sheets_getOrCreateSheet_(ctx.spreadsheetId, ctx.sheetName);
  const result = Sheets_deleteRecordById_(sheet, ctx.id);
  if (!result.ok) return result;
  return { ok: true, id: ctx.id, deletedRow: result.row };
}

function GetRecord_(ctx) {
  const idErr = RequireRecordId_(ctx);
  if (idErr) return idErr;
  const sheet = Sheets_getOrCreateSheet_(ctx.spreadsheetId, ctx.sheetName);
  const result = Sheets_getRecordById_(sheet, ctx.id, ctx.rowIndexHint);
  if (!result?.ok) return result || { ok: false, error: "Record not found" };
  return { ok: true, record: result.record ? SerializeRecord_(result.record) : null, rowIndex: result.rowIndex };
}

function ListRecords_(ctx) {
  const sheet = Sheets_getOrCreateSheet_(ctx.spreadsheetId, ctx.sheetName);
  let temporalTypeMap = null;
  const formId = ctx?.raw?.formId;
  if (formId) {
    try {
      const form = Forms_getForm_(formId);
      if (form?.schema) temporalTypeMap = Sheets_collectTemporalPathMap_(form.schema);
    } catch (err) {
      Logger.log(`[ListRecords_] Failed to load form schema for temporal formats: ${err}`);
    }
  }
  const records = Sheets_getAllRecords_(sheet, temporalTypeMap);
  return { ok: true, records, count: records.length, headerMatrix: Sheets_readHeaderMatrix_(sheet) };
}

function handleCors_(e, handler) {
  const origin = e?.headers?.origin || "*";
  if (e?.method === "OPTIONS") return Cors_applyHeaders_(ContentService.createTextOutput(""), origin, true);
  return Cors_applyHeaders_(handler(), origin, false);
}

function Cors_applyHeaders_(output, origin, isPreflight) {
  output.setHeader("Access-Control-Allow-Origin", origin || "*");
  output.setHeader("Access-Control-Allow-Credentials", "true");
  if (isPreflight) {
    output.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    output.setHeader("Access-Control-Allow-Headers", "Content-Type");
    output.setHeader("Access-Control-Max-Age", "3600");
  }
  return output;
}

function FormsApi_List_(ctx) {
  const result = nfbListForms({ includeArchived: !!ctx.raw?.includeArchived });
  if (!result?.ok) return { ok: false, error: result?.error || "フォーム一覧の取得に失敗しました" };
  return { ok: true, forms: result.forms || [], count: (result.forms || []).length, loadFailures: result.loadFailures || [] };
}

function FormsApi_Get_(ctx) {
  if (!ctx.raw?.formId) return { ok: false, error: "フォームIDが指定されていません" };
  const result = nfbGetForm(ctx.raw.formId);
  if (!result?.ok || !result.form) return { ok: false, error: result?.error || "フォームの取得に失敗しました" };
  return { ok: true, form: result.form };
}

function FormsApi_Create_(ctx) {
  if (!ctx.raw?.formData?.id) return { ok: false, error: "フォームデータが不正です" };
  const result = nfbSaveForm({ form: ctx.raw.formData, targetUrl: ctx.raw.saveUrl || null });
  if (!result?.ok) return { ok: false, error: result?.error || "フォームの作成に失敗しました" };
  return { ok: true, form: result.form, fileUrl: result.fileUrl || null };
}

function FormsApi_Import_(ctx) {
  if (!ctx.raw?.fileUrl) return { ok: false, error: "ファイルURLが指定されていません" };
  const parsed = Forms_parseGoogleDriveUrl_(ctx.raw.fileUrl);
  if (parsed?.type !== "file" || !parsed.id) return { ok: false, error: "無効なファイルURLです" };

  let formData;
  try {
    const file = DriveApp.getFileById(parsed.id);
    formData = JSON.parse(file.getBlob().getDataAsString());
    formData.driveFileUrl = formData.driveFileUrl || file.getUrl();
  } catch (error) {
    return { ok: false, error: `フォームデータの取得に失敗しました: ${nfbErrorToString_(error)}` };
  }
  if (!formData?.id) return { ok: false, error: "フォームデータが不正です（idが必要です）" };

  const result = nfbSaveForm({ form: formData });
  if (!result?.ok) return { ok: false, error: result?.error || "フォームのインポートに失敗しました" };
  return { ok: true, form: result.form, fileUrl: result.fileUrl || null };
}

function FormsApi_Update_(ctx) {
  if (!ctx.raw?.formId || !ctx.raw?.updates) return { ok: false, error: "フォームIDまたは更新内容が指定されていません" };
  const currentResult = nfbGetForm(ctx.raw.formId);
  if (!currentResult?.ok || !currentResult.form) return { ok: false, error: currentResult?.error || "フォームが見つかりません" };

  const nextForm = { ...currentResult.form, ...ctx.raw.updates, id: ctx.raw.formId, createdAt: currentResult.form.createdAt, createdAtUnixMs: currentResult.form.createdAtUnixMs };
  const saveResult = nfbSaveForm({ form: nextForm });
  if (!saveResult?.ok) return { ok: false, error: saveResult?.error || "フォームの更新に失敗しました" };
  return { ok: true, form: saveResult.form };
}

function FormsApi_Delete_(ctx) {
  if (!ctx.raw?.formId) return { ok: false, error: "フォームIDが指定されていません" };
  const result = nfbDeleteForm(ctx.raw.formId);
  if (!result?.ok) return { ok: false, error: result?.error || "フォームの削除に失敗しました" };
  return { ok: true, message: "フォームを削除しました", formId: ctx.raw.formId };
}

function FormsApi_SetArchived_(ctx) {
  if (!ctx.raw?.formId || ctx.raw?.archived === undefined) return { ok: false, error: "フォームIDまたはアーカイブ状態が指定されていません" };
  const archivedFlag = ["true", true, 1, "1"].includes(ctx.raw.archived);
  const result = archivedFlag ? nfbArchiveForm(ctx.raw.formId) : nfbUnarchiveForm(ctx.raw.formId);
  if (!result?.ok) return { ok: false, error: result?.error || "フォームの更新に失敗しました" };
  return { ok: true, form: result.form || null };
}

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
    const person = People.People.get("people/me", { personFields: "names" });
    if (!person?.names || !person.names.length) return "";
    const displayName = person.names[0]?.displayName;
    return displayName ? String(displayName).trim() : "";
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

    const ROUTES = {
      "admin_key_get":   { handler: () => ({ ok: true, adminKey: GetAdminKey_() }), adminOnly: true },
      "admin_key_set":   { handler: (c) => SetAdminKey_(c.raw?.adminKey ?? ""), adminOnly: true },
      "admin_email_get": { handler: () => ({ ok: true, adminEmail: GetAdminEmail_() }), adminOnly: true },
      "admin_email_set": { handler: (c) => SetAdminEmail_(c.raw?.adminEmail ?? ""), adminOnly: true },
      "forms_list":      { handler: FormsApi_List_, adminOnly: true },
      "forms_get":       { handler: FormsApi_Get_, adminOnly: true },
      "forms_create":    { handler: FormsApi_Create_, adminOnly: true },
      "forms_import":    { handler: FormsApi_Import_, adminOnly: true },
      "forms_update":    { handler: FormsApi_Update_, adminOnly: true },
      "forms_delete":    { handler: FormsApi_Delete_, adminOnly: true },
      "forms_archive":   { handler: FormsApi_SetArchived_, adminOnly: true },
      "delete":          { handler: DeleteRecord_, requireSheet: true },
      "list":            { handler: ListRecords_, requireSheet: true },
      "get":             { handler: GetRecord_, requireSheet: true },
      "save":            { handler: SubmitResponses_, requireSheet: true }
    };

    const route = ROUTES[action];
    if (!route) return JsonBadRequest_("Unknown action");

    if (route.adminOnly) {
      if (!adminSettingsEnabled && action.startsWith("admin_")) {
        return JsonForbidden_("管理者設定は現在のプロパティ保存モードでは利用できません");
      }
      if (adminSettingsEnabled) {
        const isAdmin = IsAdmin_(ctx.raw?.authKey || "", Session.getActiveUser().getEmail() || "");
        if (!isAdmin) return JsonForbidden_("管理者権限が必要です");
      }
    }

    if (route.requireSheet) {
      const ssErr = RequireSpreadsheetId_(ctx);
      if (ssErr) return JsonBadRequest_(ssErr.error);
    }

    try {
      return JsonOutput_(route.handler(ctx), 200);
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

function nfbAcquireSaveLock(payload) {
  return nfbSafeCall_(() => {
    const ctx = Model_fromScriptRunPayload_(payload);
    const ssErr = RequireSpreadsheetId_(ctx);
    if (ssErr) return ssErr;
    return AcquireSaveLock_(ctx);
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

function nfbExportSearchResults(payload) {
  return nfbSafeCall_(() => {
    if (!payload || !payload.headerRows || !payload.headerRows.length) {
      return { ok: false, error: "headerRows is required" };
    }
    if (!Array.isArray(payload.rows)) {
      return { ok: false, error: "rows must be an array" };
    }
    return Sheets_exportResultMatrixToNewSpreadsheet_(payload.spreadsheetTitle || "", payload.headerRows, payload.rows, payload.themeColors || null);
  });
}

function nfbAppendExportRows(payload) {
  return nfbSafeCall_(() => {
    if (!payload || !payload.spreadsheetId) {
      return { ok: false, error: "spreadsheetId is required" };
    }
    if (!Array.isArray(payload.rows)) {
      return { ok: false, error: "rows must be an array" };
    }
    return Sheets_appendRowsToSpreadsheet_(payload.spreadsheetId, payload.rows, payload.themeColors || null, payload.headerCount || 0, payload.rowOffset || 0);
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


function ExecuteWithSheet_(ctx, actionFn) {
  let sheet;
  try {
    sheet = Sheets_getOrCreateSheet_(ctx.spreadsheetId, ctx.sheetName);
  } catch (err) {
    return { ok: false, error: Sheets_translateOpenError_(err, ctx.spreadsheetId) };
  }
  return actionFn(sheet);
}

function BuildLockTimeoutResult_(actionLabel) {
  return {
    ok: false,
    code: NFB_ERROR_CODE_LOCK_TIMEOUT,
    error: `${actionLabel}処理は現在、他のユーザーによる更新中のため実行できませんでした。しばらくしてから再度お試しください。`,
  };
}

function WithScriptLock_(actionLabel, actionFn) {
  const lock = LockService.getScriptLock();
  const locked = lock.tryLock(NFB_LOCK_WAIT_TIMEOUT_MS);
  if (!locked) return BuildLockTimeoutResult_(actionLabel);

  try {
    return actionFn();
  } finally {
    try {
      SpreadsheetApp.flush();
    } catch (flushErr) {
      Logger.log(`[WithScriptLock_] SpreadsheetApp.flush failed: ${flushErr}`);
    }
    lock.releaseLock();
  }
}

function SubmitResponses_(ctx) {
  return ExecuteWithSheet_(ctx, (sheet) => {
    return WithScriptLock_("保存", () => {
      const result = Sheets_upsertRecordById_(sheet, ctx.order, ctx);
      return {
        ok: true,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ctx.spreadsheetId}`,
        sheetName: ctx.sheetName,
        rowNumber: result.row,
        id: result.id,
        recordNo: result.recordNo,
      };
    });
  });
}

function AcquireSaveLock_(ctx) {
  return ExecuteWithSheet_(ctx, (_sheet) => {
    return WithScriptLock_("保存", () => ({ ok: true }));
  });
}

function DeleteRecord_(ctx) {
  const idErr = RequireRecordId_(ctx);
  if (idErr) return idErr;
  return ExecuteWithSheet_(ctx, (sheet) => {
    const result = Sheets_deleteRecordById_(sheet, ctx.id);
    if (!result.ok) return result;
    return { ok: true, id: ctx.id, deletedRow: result.row };
  });
}

function GetRecord_(ctx) {
  const idErr = RequireRecordId_(ctx);
  if (idErr) return idErr;
  return ExecuteWithSheet_(ctx, (sheet) => {
    const result = Sheets_getRecordById_(sheet, ctx.id, ctx.rowIndexHint);
    if (!result?.ok) return result || { ok: false, error: "Record not found" };
    return { ok: true, record: result.record ? SerializeRecord_(result.record) : null, rowIndex: result.rowIndex };
  });
}

function ListRecords_(ctx) {
  return ExecuteWithSheet_(ctx, (sheet) => {
    const toComparableUnixMs = (value, allowSerialNumber) => {
      if (value === null || value === undefined || value === "") return 0;
      if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : 0;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        if (Math.abs(value) >= 100000000000) return value;
        if (allowSerialNumber) return NFB_SHEETS_EPOCH_MS + value * NFB_MS_PER_DAY;
        return value;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return 0;
        if (/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) {
          return toComparableUnixMs(parseFloat(trimmed), allowSerialNumber);
        }
        const parsed = Date.parse(trimmed);
        if (Number.isFinite(parsed)) return parsed;
      }
      return 0;
    };

    const listRecords = () => {
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

      const sheetLastUpdatedAt = Sheets_readSheetLastUpdated_(sheet);
      const shouldNormalize = Boolean(ctx.forceFullSync) || !ctx.lastSpreadsheetReadAt;
      const allRecords = Sheets_getAllRecords_(sheet, temporalTypeMap, { normalize: shouldNormalize });
      const headerMatrix = Sheets_readHeaderMatrix_(sheet);

      if (ctx.forceFullSync || !ctx.lastSpreadsheetReadAt) {
        return {
          ok: true,
          records: allRecords,
          count: allRecords.length,
          headerMatrix,
          isDelta: false,
          sheetLastUpdatedAt,
        };
      }

      const lastSpreadsheetReadAtUnixMs = toComparableUnixMs(ctx.lastSpreadsheetReadAt, false);
      if (sheetLastUpdatedAt > 0 && lastSpreadsheetReadAtUnixMs > 0 && sheetLastUpdatedAt <= lastSpreadsheetReadAtUnixMs) {
        return {
          ok: true,
          records: [],
          allIds: null,
          count: 0,
          headerMatrix,
          isDelta: true,
          sheetLastUpdatedAt,
        };
      }

      const updatedRecords = [];
      const allIds = [];
      for (let i = 0; i < allRecords.length; i += 1) {
        const rec = allRecords[i];
        allIds.push(rec.id);
        const modifiedAtUnixMs = toComparableUnixMs(rec.modifiedAtUnixMs, true) || toComparableUnixMs(rec.modifiedAt, true);
        if (modifiedAtUnixMs > lastSpreadsheetReadAtUnixMs) {
          updatedRecords.push(rec);
        }
      }

      return {
        ok: true,
        records: updatedRecords,
        allIds,
        count: updatedRecords.length,
        headerMatrix,
        isDelta: true,
        sheetLastUpdatedAt,
      };
    };

    if (ctx.forceFullSync) {
      return WithScriptLock_("更新", listRecords);
    }
    return listRecords();
  });
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

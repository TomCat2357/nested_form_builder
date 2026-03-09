function doGet(e) {
  const html = HtmlService.createHtmlOutputFromFile("Index");
  const webAppUrl = ScriptApp.getService().getUrl();
  let htmlContent = html.getContent();

  const formParam = e?.parameter?.form ? String(e.parameter.form) : "";
  const adminkeyParam = e?.parameter?.adminkey ? String(e.parameter.adminkey) : "";
  const userEmail = Session.getActiveUser().getEmail() || "";

  const authResult = DetermineAccess_(formParam, adminkeyParam, userEmail);
  const userProfile = ResolveActiveUserProfile_();
  const userName = userProfile.displayName;
  const userAffiliation = userProfile.affiliation;
  const userTitle = userProfile.title;
  const userPhone = userProfile.phone;
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

function ResolvePrimaryPersonField_(items) {
  if (!items?.length) return null;
  return items.find((item) => item?.metadata?.primary)
    || items.find((item) => item?.current)
    || items[0]
    || null;
}

function NormalizeProfilePhone_(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("0081")) {
    digits = `0${digits.slice(4)}`;
  } else if (digits.startsWith("81")) {
    digits = `0${digits.slice(2)}`;
  }

  return digits;
}

function ResolveActiveUserProfile_() {
  const emptyProfile = { displayName: "", affiliation: "", title: "", phone: "" };
  try {
    const person = People.People.get("people/me", { personFields: "names,organizations,phoneNumbers" });
    const primaryName = ResolvePrimaryPersonField_(person?.names);
    const primaryOrganization = ResolvePrimaryPersonField_(person?.organizations);
    const primaryPhone = ResolvePrimaryPersonField_(person?.phoneNumbers);

    const displayName = primaryName?.displayName ? String(primaryName.displayName).trim() : "";
    const affiliation = primaryOrganization?.department
      ? String(primaryOrganization.department).trim()
      : (primaryOrganization?.name ? String(primaryOrganization.name).trim() : "");
    const title = primaryOrganization?.title ? String(primaryOrganization.title).trim() : "";
    const phone = NormalizeProfilePhone_(primaryPhone?.value || primaryPhone?.canonicalForm || "");

    return { displayName, affiliation, title, phone };
  } catch (err) {
    return emptyProfile;
  }
}

function ResolveActiveUserDisplayName_() {
  return ResolveActiveUserProfile_().displayName;
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
      "save":            { handler: SubmitResponses_, requireSheet: true },
      "sync_records":    { handler: SyncRecords_, requireSheet: true }
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
  const unixMsOrFallback = (value, fallbackEmpty = "") => {
    const unixMs = Sheets_toUnixMs_(value, true);
    if (Number.isFinite(unixMs)) return unixMs;
    if (value === null || value === undefined || value === "") return fallbackEmpty;
    return String(value);
  };
  const unixMsNullableOrFallback = (value) => {
    const unixMs = Sheets_toUnixMs_(value, true);
    if (Number.isFinite(unixMs)) return unixMs;
    if (value === null || value === undefined || value === "") return null;
    return String(value);
  };

  if (record.data && typeof record.data === "object") {
    Object.entries(record.data).forEach(([key, value]) => {
      const dateInfo = SerializeDateLike_(value);
      serializedData[key] = dateInfo.iso;
      if (dateInfo.unixMs !== null) serializedDataUnixMs[key] = dateInfo.unixMs;
    });
  }

  const createdInfo = SerializeDateLike_(record.createdAt, { allowSerialNumber: true });
  const modifiedInfo = SerializeDateLike_(record.modifiedAt, { allowSerialNumber: true });
  const deletedAtUnixMs = Sheets_toUnixMs_(record.deletedAt, true);

  return {
    id: String(record.id || ""),
    "No.": record["No."] ?? "",
    modifiedBy: record.modifiedBy || "",
    createdBy: record.createdBy || "",
    deletedBy: record.deletedBy || "",
    createdAt: unixMsOrFallback(record.createdAt, ""),
    modifiedAt: unixMsOrFallback(record.modifiedAt, ""),
    deletedAt: unixMsNullableOrFallback(record.deletedAt),
    createdAtUnixMs: createdInfo.unixMs,
    modifiedAtUnixMs: modifiedInfo.unixMs,
    deletedAtUnixMs,
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


function ResolveDeletedRecordRetentionDays_(ctx) {
  var rawDays = parseInt(ctx?.raw?.deletedRetentionDays, 10);
  if (isFinite(rawDays) && rawDays > 0) return rawDays;

  var formId = ctx?.raw?.formId;
  if (formId) {
    try {
      var form = Forms_getForm_(formId);
      var formDays = parseInt(form?.settings?.deletedRetentionDays, 10);
      if (isFinite(formDays) && formDays > 0) return formDays;
    } catch (error) {
      Logger.log("[ResolveDeletedRecordRetentionDays_] Failed to load form setting: " + error);
    }
  }

  return Nfb_getDeletedRecordRetentionDays_();
}

function ResolveTemporalTypeMap_(ctx) {
  if (ctx?.raw?.formSchema && Array.isArray(ctx.raw.formSchema)) {
    return Sheets_collectTemporalPathMap_(ctx.raw.formSchema);
  }
  var formId = ctx?.raw?.formId;
  if (!formId) return null;
  try {
    var form = Forms_getForm_(formId);
    if (form?.schema && Array.isArray(form.schema)) {
      return Sheets_collectTemporalPathMap_(form.schema);
    }
  } catch (error) {
    Logger.log("[ResolveTemporalTypeMap_] Failed to load schema: " + error);
  }
  return null;
}

function SubmitResponses_(ctx) {
  return ExecuteWithSheet_(ctx, (sheet) => {
    return WithScriptLock_("保存", () => {
      const temporalTypeMap = ResolveTemporalTypeMap_(ctx);
      Sheets_purgeExpiredDeletedRows_(sheet, ResolveDeletedRecordRetentionDays_(ctx));
      const result = Sheets_upsertRecordById_(sheet, ctx.order, ctx, temporalTypeMap);
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
        const normalized = Sheets_normalizeNumericToUnixMs_(value, allowSerialNumber);
        return Number.isFinite(normalized) ? normalized : 0;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return 0;
        if (/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) {
          const normalized = Sheets_normalizeNumericToUnixMs_(parseFloat(trimmed), allowSerialNumber);
          return Number.isFinite(normalized) ? normalized : 0;
        }
        const normalized = Sheets_toUnixMs_(trimmed, allowSerialNumber);
        if (Number.isFinite(normalized)) return normalized;
      }
      const normalized = Sheets_toUnixMs_(value, allowSerialNumber);
      return Number.isFinite(normalized) ? normalized : 0;
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
          count: 0,
          headerMatrix,
          isDelta: true,
          sheetLastUpdatedAt,
        };
      }

      const updatedRecords = [];
      for (let i = 0; i < allRecords.length; i += 1) {
        const rec = allRecords[i];
        const modifiedAtUnixMs = toComparableUnixMs(rec.modifiedAtUnixMs, true) || toComparableUnixMs(rec.modifiedAt, true);
        if (modifiedAtUnixMs > lastSpreadsheetReadAtUnixMs) {
          updatedRecords.push(rec);
        }
      }

      return {
        ok: true,
        records: updatedRecords,
        count: updatedRecords.length,
        headerMatrix,
        isDelta: true,
        sheetLastUpdatedAt,
      };
    };

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

function syncRecordsProxy(payload) {
  return nfbSafeCall_(() => {
    const ctx = Model_fromScriptRunPayload_(payload);
    const ssErr = RequireSpreadsheetId_(ctx);
    if (ssErr) return ssErr;
    return SyncRecords_(ctx);
  });
}

function SyncRecords_(ctx) {
  return ExecuteWithSheet_(ctx, function(sheet) {
    var forceFullSync = !!ctx.raw.forceFullSync;
    var uploadRecords = Array.isArray(ctx.raw.uploadRecords) ? ctx.raw.uploadRecords : [];
    var lastServerReadAt = parseInt(ctx.raw.lastServerReadAt, 10) || 0;
    var sheetLastUpdatedAt = Sheets_readSheetLastUpdated_(sheet);
    var serverModifiedAt = GetServerModifiedAt_();

    var getRecordModifiedAtUnixMs = function(record) {
      var modifiedAtUnixMs = parseInt(record && record.modifiedAtUnixMs, 10);
      if (isFinite(modifiedAtUnixMs) && modifiedAtUnixMs > 0) return modifiedAtUnixMs;
      return Sheets_toUnixMs_(record && record.modifiedAt, true) || 0;
    };

    var buildReadOnlyResult = function() {
      var temporalTypeMap = ResolveTemporalTypeMap_(ctx);
      var allRecords = Sheets_getAllRecords_(sheet, temporalTypeMap, { normalize: false });
      var headerMatrix = Sheets_readHeaderMatrix_(sheet);

      if (forceFullSync || lastServerReadAt <= 0) {
        var fullRecords = allRecords.map(SerializeRecord_);
        return {
          ok: true,
          serverModifiedAt: serverModifiedAt,
          serverCommitToken: serverModifiedAt,
          records: fullRecords,
          headerMatrix: headerMatrix,
          isDelta: false,
          unchanged: false,
          count: fullRecords.length,
          sheetLastUpdatedAt: sheetLastUpdatedAt,
        };
      }

      var deltaRecords = [];
      for (var i = 0; i < allRecords.length; i++) {
        var record = allRecords[i];
        if (getRecordModifiedAtUnixMs(record) > lastServerReadAt) {
          deltaRecords.push(record);
        }
      }
      var serializedDelta = deltaRecords.map(SerializeRecord_);
      return {
        ok: true,
        serverModifiedAt: serverModifiedAt,
        serverCommitToken: serverModifiedAt,
        records: serializedDelta,
        headerMatrix: headerMatrix,
        isDelta: true,
        unchanged: false,
        count: serializedDelta.length,
        sheetLastUpdatedAt: sheetLastUpdatedAt,
      };
    };

    if (uploadRecords.length === 0) {
      if (sheetLastUpdatedAt > 0 && lastServerReadAt > 0 && sheetLastUpdatedAt <= lastServerReadAt) {
        return {
          ok: true,
          serverModifiedAt: serverModifiedAt,
          serverCommitToken: serverModifiedAt,
          records: [],
          isDelta: true,
          unchanged: true,
          count: 0,
          sheetLastUpdatedAt: sheetLastUpdatedAt,
        };
      }
      return buildReadOnlyResult();
    }

    return WithScriptLock_("同期", function() {
      var nowMs = Date.now();
      var order = ctx.order || [];
      if (ctx.raw.formSchema) {
        order = Sheets_buildOrderFromSchema_(ctx.raw.formSchema);
      } else {
        order = Sheets_normalizeHeaderKeyList_(order);
      }
      var temporalTypeMap = ResolveTemporalTypeMap_(ctx);
      Sheets_ensureHeaderMatrix_(sheet, order);
      var keyToColumn = Sheets_buildHeaderKeyMap_(sheet);

      var lastColumn = Math.max(sheet.getLastColumn(), 8);
      var lastRow = sheet.getLastRow();
      var dataStartRow = NFB_DATA_START_ROW;

      // 全データを取得
      var existingData = [];
      var existingFormats = [];
      if (lastRow >= dataStartRow) {
        var dataRange = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, lastColumn);
        existingData = dataRange.getValues();
        existingFormats = dataRange.getNumberFormats();
      }

      var existingRowMap = {};
      var maxNo = 0;
      for (var i = 0; i < existingData.length; i++) {
        var id = String(existingData[i][0] || "").trim();
        if (id) existingRowMap[id] = i;
        var noVal = Number(existingData[i][1]);
        if (isFinite(noVal) && noVal > maxNo) maxNo = noVal;
      }

      var modifiedCount = 0;
      var uploadedRecordIds = {};
      var currentUserEmail = Session.getActiveUser().getEmail() || "";

      for (var j = 0; j < uploadRecords.length; j++) {
        var rec = uploadRecords[j];
        var normalizedRecordData = Sheets_normalizeRecordDataKeys_(rec && rec.data);
        var recId = rec.id || Sheets_generateRecordId_();
        var recModifiedAt = parseInt(rec.modifiedAtUnixMs, 10) || Sheets_toUnixMs_(rec.modifiedAt, true) || nowMs;

        var localIndex = existingRowMap.hasOwnProperty(recId) ? existingRowMap[recId] : -1;
        var sheetModifiedAt = 0;

        if (localIndex !== -1) {
          var modAtVal = existingData[localIndex][3];
          sheetModifiedAt = Sheets_toUnixMs_(modAtVal, true) || 0;
        }

        var shouldApplyRecord = (localIndex === -1) || (recModifiedAt > sheetModifiedAt);
        if (shouldApplyRecord) {
          var rowData;
          var rowFormats;

          if (localIndex === -1) {
            rowData = new Array(lastColumn).fill("");
            rowFormats = new Array(lastColumn).fill("General");
            rowData[0] = recId;
            maxNo++;
            rowData[1] = maxNo;
            rowData[2] = nowMs; // createdAt
            rowData[5] = rec.createdBy || currentUserEmail;

            localIndex = existingData.length;
            existingData.push(rowData);
            existingFormats.push(rowFormats);
            existingRowMap[recId] = localIndex;
          } else {
            rowData = existingData[localIndex];
            rowFormats = existingFormats[localIndex];
            for (var key in keyToColumn) {
              if (keyToColumn.hasOwnProperty(key) && !NFB_RESERVED_HEADER_KEYS[key]) {
                var cIdx = keyToColumn[key] - 1;
                if (cIdx >= 0 && cIdx < lastColumn) rowData[cIdx] = "";
              }
            }
          }

          rowData[3] = recModifiedAt;
          rowData[6] = currentUserEmail;
          rowFormats[2] = "0";
          rowFormats[3] = "0";

          if (rec.deletedAt) {
            rowData[4] = Sheets_toUnixMs_(rec.deletedAt, true) || rec.deletedAt;
            rowData[7] = rec.deletedBy || currentUserEmail;
            rowFormats[4] = "0";
          } else {
            rowData[4] = "";
            rowData[7] = "";
          }

          for (var k = 0; k < order.length; k++) {
            var kName = String(order[k] || "");
            if (!kName || NFB_RESERVED_HEADER_KEYS[kName]) continue;
            var colIdx = keyToColumn[kName] - 1;
            if (colIdx < 0) continue;

            var val = Object.prototype.hasOwnProperty.call(normalizedRecordData, kName) ? normalizedRecordData[kName] : "";
            var tType = temporalTypeMap && temporalTypeMap[kName] ? temporalTypeMap[kName] : null;
            var norm = Sheets_resolveTemporalCell_(val, tType);

            rowData[colIdx] = norm.value;
            if (norm.numberFormat) rowFormats[colIdx] = norm.numberFormat;
          }

          rec["No."] = rowData[1];
          uploadedRecordIds[String(recId)] = true;
          modifiedCount++;
        }
      }

      if (modifiedCount > 0) {
        Sheets_ensureRowCapacity_(sheet, dataStartRow + existingData.length - 1);
        if (existingData.length > 0) {
          var outRange = sheet.getRange(dataStartRow, 1, existingData.length, lastColumn);
          outRange.setValues(existingData);
          outRange.setNumberFormats(existingFormats);
        }
        SetServerModifiedAt_(nowMs);
        Sheets_touchSheetLastUpdated_(sheet, nowMs);
        serverModifiedAt = nowMs;
        sheetLastUpdatedAt = nowMs;
      } else {
        sheetLastUpdatedAt = Sheets_readSheetLastUpdated_(sheet);
        serverModifiedAt = GetServerModifiedAt_();
      }

      // 返却データ構築
      var returnRecords = [];
      var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);

      Sheets_applyTemporalFormatsToMemory_(columnPaths, existingData, existingData.length, temporalTypeMap);

      for (var r = 0; r < existingData.length; r++) {
        var aRec = Sheets_buildRecordFromRow_(existingData[r], columnPaths);
        if (!aRec) continue;

        if (forceFullSync) {
          returnRecords.push(aRec);
        } else {
          var aModAt = getRecordModifiedAtUnixMs(aRec);
          if (aModAt > lastServerReadAt || uploadedRecordIds[String(aRec.id)]) {
            returnRecords.push(aRec);
          }
        }
      }

      var headerMatrix = Sheets_readHeaderMatrix_(sheet);
      var serializedRecords = returnRecords.map(SerializeRecord_);

      return {
        ok: true,
        serverModifiedAt: serverModifiedAt,
        serverCommitToken: serverModifiedAt,
        records: serializedRecords,
        headerMatrix: headerMatrix,
        isDelta: !forceFullSync,
        unchanged: false,
        count: serializedRecords.length,
        sheetLastUpdatedAt: sheetLastUpdatedAt,
      };
    });
  });
}

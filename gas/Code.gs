function doGet(e) {
  // Serve the built single-page app via HtmlService.
  var html = HtmlService.createHtmlOutputFromFile("Index");

  // GAS WebApp URLを取得してHTMLに注入
  var webAppUrl = ScriptApp.getService().getUrl();
  var htmlContent = html.getContent();

  // URLパラメータを取得
  var formParam = (e && e.parameter && e.parameter.form) ? String(e.parameter.form) : "";
  var adminkeyParam = (e && e.parameter && e.parameter.adminkey) ? String(e.parameter.adminkey) : "";
  var userEmail = Session.getActiveUser().getEmail() || "";

  // 認証判定
  var authResult = DetermineAccess_(formParam, adminkeyParam, userEmail);
  var userName = ResolveActiveUserDisplayName_();
  var adminEmail = GetAdminEmail_();
  var propertyStoreMode = Nfb_getPropertyStoreMode_();
  var adminSettingsEnabled = Nfb_isAdminSettingsEnabled_();

  // </head>の直前にscriptタグを挿入してグローバル変数を設定
  var injectedScript = '<script>' +
    'window.__GAS_WEBAPP_URL__ = "' + EscapeForInlineScript_(webAppUrl) + '";' +
    'window.__IS_ADMIN__ = ' + (authResult.isAdmin ? 'true' : 'false') + ';' +
    'window.__FORM_ID__ = "' + EscapeForInlineScript_(authResult.formId) + '";' +
    'window.__AUTH_ERROR__ = "' + EscapeForInlineScript_(authResult.authError) + '";' +
    'window.__USER_EMAIL__ = "' + EscapeForInlineScript_(userEmail) + '";' +
    'window.__USER_NAME__ = "' + EscapeForInlineScript_(userName) + '";' +
    'window.__ADMIN_EMAIL__ = "' + EscapeForInlineScript_(adminEmail) + '";' +
    'window.__PROPERTY_STORE_MODE__ = "' + EscapeForInlineScript_(propertyStoreMode) + '";' +
    'window.__ADMIN_SETTINGS_ENABLED__ = ' + (adminSettingsEnabled ? 'true' : 'false') + ';' +
    '</script>';
  htmlContent = htmlContent.replace('</head>', injectedScript + '</head>');

  return HtmlService.createHtmlOutput(htmlContent)
    .setTitle("Nested Form Builder")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 現在ユーザーの表示名を取得する（取得できない場合は空文字）
 * NOTE: 実行環境によってはメールアドレスのみ取得可能なため、空文字フォールバックする。
 */
function ResolveActiveUserDisplayName_() {
  var displayName = "";

  try {
    var raw = Session.getActiveUser().getEmail() || "";
    var match = raw.match(/^(.*?)\s*<[^>]+>$/);
    if (match && match[1]) {
      displayName = String(match[1]).trim();
    }
  } catch (err) {
    displayName = "";
  }

  return displayName;
}

/**
 * インラインscript文字列として安全に埋め込めるようエスケープする。
 */
function EscapeForInlineScript_(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/<\/script/gi, "<\\/script");
}

function doPost(e) {
  return handleCors_(e, function() {
    var ctx = Model_parseRequest_(e);
    var action = (ctx.raw && ctx.raw.action) || "save";
    var adminSettingsEnabled = Nfb_isAdminSettingsEnabled_();

    // リクエストから管理者キーを取得して認証チェック
    var adminKeyParam = (ctx.raw && ctx.raw.authKey) ? String(ctx.raw.authKey) : "";
    var userEmail = Session.getActiveUser().getEmail() || "";
    var isAdmin = adminSettingsEnabled ? IsAdmin_(adminKeyParam, userEmail) : false;

    // scriptモードでのみ管理者専用にするアクション
    var formAdminOnlyActions = [
      "forms_create",
      "forms_update",
      "forms_delete",
      "forms_import",
      "forms_archive",
    ];

    // 管理者設定API
    var adminSettingsActions = [
      "admin_key_get",
      "admin_key_set",
      "admin_email_get",
      "admin_email_set"
    ];

    try {
      var payload;

      if (!adminSettingsEnabled && adminSettingsActions.indexOf(action) !== -1) {
        return JsonForbidden_("管理者設定は現在のプロパティ保存モードでは利用できません");
      }

      // scriptモード時のみ管理者権限を要求
      if (adminSettingsEnabled && (formAdminOnlyActions.indexOf(action) !== -1 || adminSettingsActions.indexOf(action) !== -1) && !isAdmin) {
        return JsonForbidden_("管理者権限が必要です");
      }

      // 管理者キー管理API
      if (action === "admin_key_get") {
        payload = { ok: true, adminKey: GetAdminKey_() };
      } else if (action === "admin_key_set") {
        var newKey = (ctx.raw && ctx.raw.adminKey !== undefined) ? ctx.raw.adminKey : "";
        payload = SetAdminKey_(newKey);
      } else if (action === "admin_email_get") {
        payload = { ok: true, adminEmail: GetAdminEmail_() };
      } else if (action === "admin_email_set") {
        var newEmail = (ctx.raw && ctx.raw.adminEmail !== undefined) ? ctx.raw.adminEmail : "";
        payload = SetAdminEmail_(newEmail);
      }
      // フォーム管理API
      else if (action === "forms_list") {
        payload = FormsApi_List_(ctx);
      } else if (action === "forms_get") {
        payload = FormsApi_Get_(ctx);
      } else if (action === "forms_create") {
        payload = FormsApi_Create_(ctx);
      } else if (action === "forms_import") {
        payload = FormsApi_Import_(ctx);
      } else if (action === "forms_update") {
        payload = FormsApi_Update_(ctx);
      } else if (action === "forms_delete") {
        payload = FormsApi_Delete_(ctx);
      } else if (action === "forms_archive") {
        payload = FormsApi_SetArchived_(ctx);
      }
      // スプレッドシートレコード管理API
      else if (action === "delete") {
        var ssErr = RequireSpreadsheetId_(ctx);
        if (ssErr) return JsonBadRequest_(ssErr.error);
        payload = DeleteRecord_(ctx);
      } else if (action === "list") {
        var ssErr = RequireSpreadsheetId_(ctx);
        if (ssErr) return JsonBadRequest_(ssErr.error);
        payload = ListRecords_(ctx);
      } else if (action === "get") {
        var ssErr = RequireSpreadsheetId_(ctx);
        if (ssErr) return JsonBadRequest_(ssErr.error);
        payload = GetRecord_(ctx);
      } else {
        var ssErr = RequireSpreadsheetId_(ctx);
        if (ssErr) return JsonBadRequest_(ssErr.error);
        payload = SubmitResponses_(ctx);
      }

      return JsonOutput_(payload, 200);
    } catch (err) {
      return JsonInternalError_(err);
    }
  });
}

function saveResponses(payload) {
  return nfbSafeCall_(function() {
    var ctx = Model_fromScriptRunPayload_(payload);
    var ssErr = RequireSpreadsheetId_(ctx);
    if (ssErr) return ssErr;
    return SubmitResponses_(ctx);
  });
}

function deleteRecord(payload) {
  return nfbSafeCall_(function() {
    var ctx = Model_fromScriptRunPayload_(payload);
    var ssErr = RequireSpreadsheetId_(ctx);
    if (ssErr) return ssErr;
    var idErr = RequireRecordId_(ctx);
    if (idErr) return idErr;
    return DeleteRecord_(ctx);
  });
}

function SerializeValue_(value) {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function SerializeDateLike_(value, options) {
  var allowSerialNumber = options && options.allowSerialNumber === true;
  var date = Sheets_parseDateLikeToJstDate_(value, allowSerialNumber);
  if (date) {
    return { iso: date.toISOString(), unixMs: Sheets_toUnixMs_(date) };
  }
  return { iso: SerializeValue_(value), unixMs: null };
}

function SerializeRecord_(record) {
  var serializedData = {};
  var serializedDataUnixMs = {};

  if (record.data && typeof record.data === "object") {
    for (var key in record.data) {
      if (record.data.hasOwnProperty(key)) {
        var value = record.data[key];
        var dateInfo = SerializeDateLike_(value);
        serializedData[key] = dateInfo.iso;
        if (dateInfo.unixMs !== null) {
          serializedDataUnixMs[key] = dateInfo.unixMs;
        }
      }
    }
  }

  var createdInfo = SerializeDateLike_(record.createdAt, { allowSerialNumber: true });
  var modifiedInfo = SerializeDateLike_(record.modifiedAt, { allowSerialNumber: true });
  var createdValue = createdInfo.unixMs !== null ? createdInfo.unixMs : createdInfo.iso;
  var modifiedValue = modifiedInfo.unixMs !== null ? modifiedInfo.unixMs : modifiedInfo.iso;

  return {
    id: String(record.id || ""),
    "No.": record["No."] != null ? record["No."] : "",
    modifiedBy: record.modifiedBy || "",
    createdBy: record.createdBy || "",
    createdAt: createdValue,
    modifiedAt: modifiedValue,
    createdAtUnixMs: createdInfo.unixMs,
    modifiedAtUnixMs: modifiedInfo.unixMs,
    data: serializedData,
    dataUnixMs: serializedDataUnixMs
  };
}

function getRecord(payload) {
  return nfbSafeCall_(function() {
    var ctx = Model_fromScriptRunPayload_(payload);
    var ssErr = RequireSpreadsheetId_(ctx);
    if (ssErr) return ssErr;
    var idErr = RequireRecordId_(ctx);
    if (idErr) return idErr;
    return GetRecord_(ctx);
  });
}

function listRecords(payload) {
  return nfbSafeCall_(function() {
    var ctx = Model_fromScriptRunPayload_(payload);
    var ssErr = RequireSpreadsheetId_(ctx);
    if (ssErr) return ssErr;

    var result = ListRecords_(ctx);
    if (result && Array.isArray(result.records)) {
      result.records = result.records.map(SerializeRecord_);
    }

    return result;
  });
}

function SubmitResponses_(ctx) {
  var sheet = Sheets_getOrCreateSheet_(ctx.spreadsheetId, ctx.sheetName);
  var result = Sheets_upsertRecordById_(sheet, ctx.order, ctx);
  var spreadsheetUrl = "https://docs.google.com/spreadsheets/d/" + ctx.spreadsheetId;

  return {
    ok: true,
    spreadsheetUrl: spreadsheetUrl,
    sheetName: ctx.sheetName,
    rowNumber: result.row,
    id: result.id,
  };
}

function DeleteRecord_(ctx) {
  var missingId = RequireRecordId_(ctx);
  if (missingId) return missingId;

  var sheet = Sheets_getOrCreateSheet_(ctx.spreadsheetId, ctx.sheetName);
  var result = Sheets_deleteRecordById_(sheet, ctx.id);

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    id: ctx.id,
    deletedRow: result.row,
  };
}

function GetRecord_(ctx) {
  var missingId = RequireRecordId_(ctx);
  if (missingId) return missingId;

  var sheet = Sheets_getOrCreateSheet_(ctx.spreadsheetId, ctx.sheetName);
  var result = Sheets_getRecordById_(sheet, ctx.id, ctx.rowIndexHint);

  if (!result || !result.ok) {
    return result || { ok: false, error: "Record not found" };
  }

  return {
    ok: true,
    record: result.record ? SerializeRecord_(result.record) : null,
    rowIndex: result.rowIndex
  };
}

function ListRecords_(ctx) {
  var sheet = Sheets_getOrCreateSheet_(ctx.spreadsheetId, ctx.sheetName);
  var temporalTypeMap = null;
  var formId = ctx && ctx.raw && ctx.raw.formId;
  if (formId) {
    try {
      var form = Forms_getForm_(formId);
      if (form && form.schema) {
        temporalTypeMap = Sheets_collectTemporalPathMap_(form.schema);
      }
    } catch (err) {
      Logger.log("[ListRecords_] Failed to load form schema for temporal formats: " + err);
    }
  }
  var records = Sheets_getAllRecords_(sheet, temporalTypeMap);
  var headerMatrix = Sheets_readHeaderMatrix_(sheet);

  return {
    ok: true,
    records: records,
    count: records.length,
    headerMatrix: headerMatrix,
  };
}

function handleCors_(e, handler) {
  var origin = (e && e.headers && e.headers.origin) || "*";
  if (e && e.method === "OPTIONS") {
    return Cors_applyHeaders_(ContentService.createTextOutput(""), origin, true);
  }
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

// ========================================
// フォーム管理API
// ========================================

/**
 * フォーム一覧取得API
 * @param {Object} ctx - リクエストコンテキスト
 * @return {Object} APIレスポンス
 */
function FormsApi_List_(ctx) {
  var includeArchived = !!(ctx.raw && ctx.raw.includeArchived);
  var result = nfbListForms({ includeArchived: includeArchived });
  if (!result || !result.ok) {
    return { ok: false, error: (result && result.error) || "フォーム一覧の取得に失敗しました" };
  }
  var forms = Array.isArray(result.forms) ? result.forms : [];

  return {
    ok: true,
    forms: forms,
    count: forms.length,
    loadFailures: result.loadFailures || []
  };
}

/**
 * 単一フォーム取得API
 * @param {Object} ctx - リクエストコンテキスト
 * @return {Object} APIレスポンス
 */
function FormsApi_Get_(ctx) {
  var formId = ctx.raw && ctx.raw.formId;
  if (!formId) {
    return { ok: false, error: "フォームIDが指定されていません" };
  }
  var result = nfbGetForm(formId);
  if (!result || !result.ok || !result.form) {
    return { ok: false, error: (result && result.error) || "フォームの取得に失敗しました" };
  }

  return {
    ok: true,
    form: result.form
  };
}

/**
 * フォーム作成API
 * @param {Object} ctx - リクエストコンテキスト
 * @return {Object} APIレスポンス
 */
function FormsApi_Create_(ctx) {
  var formData = ctx.raw && ctx.raw.formData;
  var saveUrl = ctx.raw && ctx.raw.saveUrl;

  if (!formData || !formData.id) {
    return { ok: false, error: "フォームデータが不正です" };
  }

  var result = nfbSaveForm({ form: formData, targetUrl: saveUrl || null });
  if (!result || !result.ok) {
    return { ok: false, error: (result && result.error) || "フォームの作成に失敗しました" };
  }

  return {
    ok: true,
    form: result.form,
    fileUrl: result.fileUrl || null
  };
}

/**
 * フォームインポートAPI
 * @param {Object} ctx - リクエストコンテキスト
 * @return {Object} APIレスポンス
 */
function FormsApi_Import_(ctx) {
  var fileUrl = ctx.raw && ctx.raw.fileUrl;
  if (!fileUrl) {
    return { ok: false, error: "ファイルURLが指定されていません" };
  }
  var parsed = Forms_parseGoogleDriveUrl_(fileUrl);
  if (!parsed || parsed.type !== "file" || !parsed.id) {
    return { ok: false, error: "無効なファイルURLです" };
  }
  var file;
  var formData;
  try {
    file = DriveApp.getFileById(parsed.id);
    formData = JSON.parse(file.getBlob().getDataAsString());
  } catch (error) {
    return { ok: false, error: "フォームデータの取得に失敗しました: " + nfbErrorToString_(error) };
  }
  if (!formData || !formData.id) {
    return { ok: false, error: "フォームデータが不正です（idが必要です）" };
  }
  formData.driveFileUrl = formData.driveFileUrl || file.getUrl();
  var result = nfbSaveForm({ form: formData });
  if (!result || !result.ok) {
    return { ok: false, error: (result && result.error) || "フォームのインポートに失敗しました" };
  }

  return {
    ok: true,
    form: result.form,
    fileUrl: result.fileUrl || null
  };
}

/**
 * フォーム更新API
 * @param {Object} ctx - リクエストコンテキスト
 * @return {Object} APIレスポンス
 */
function FormsApi_Update_(ctx) {
  var formId = ctx.raw && ctx.raw.formId;
  var updates = ctx.raw && ctx.raw.updates;

  if (!formId || !updates) {
    return { ok: false, error: "フォームIDまたは更新内容が指定されていません" };
  }

  var currentResult = nfbGetForm(formId);
  if (!currentResult || !currentResult.ok || !currentResult.form) {
    return { ok: false, error: (currentResult && currentResult.error) || "フォームが見つかりません" };
  }
  var current = currentResult.form;
  var nextForm = {};
  var key;
  for (key in current) {
    if (current.hasOwnProperty(key)) {
      nextForm[key] = current[key];
    }
  }
  for (key in updates) {
    if (updates.hasOwnProperty(key)) {
      nextForm[key] = updates[key];
    }
  }
  nextForm.id = formId;
  nextForm.createdAt = current.createdAt;
  nextForm.createdAtUnixMs = current.createdAtUnixMs;
  var saveResult = nfbSaveForm({ form: nextForm });
  if (!saveResult || !saveResult.ok) {
    return { ok: false, error: (saveResult && saveResult.error) || "フォームの更新に失敗しました" };
  }

  return {
    ok: true,
    form: saveResult.form
  };
}

/**
 * フォーム削除API
 * @param {Object} ctx - リクエストコンテキスト
 * @return {Object} APIレスポンス
 */
function FormsApi_Delete_(ctx) {
  var formId = ctx.raw && ctx.raw.formId;
  if (!formId) {
    return { ok: false, error: "フォームIDが指定されていません" };
  }
  var result = nfbDeleteForm(formId);
  if (!result || !result.ok) {
    return { ok: false, error: (result && result.error) || "フォームの削除に失敗しました" };
  }

  return {
    ok: true,
    message: "フォームを削除しました",
    formId: formId
  };
}

/**
 * フォームアーカイブ/アンアーカイブAPI
 * @param {Object} ctx - リクエストコンテキスト
 * @return {Object} APIレスポンス
 */
function FormsApi_SetArchived_(ctx) {
  var formId = ctx.raw && ctx.raw.formId;
  var archived = ctx.raw && ctx.raw.archived;

  if (!formId || archived === undefined) {
    return { ok: false, error: "フォームIDまたはアーカイブ状態が指定されていません" };
  }

  var archivedFlag = (archived === true || archived === "true" || archived === 1 || archived === "1");
  var result = archivedFlag ? nfbArchiveForm(formId) : nfbUnarchiveForm(formId);
  if (!result || !result.ok) {
    return { ok: false, error: (result && result.error) || "フォームの更新に失敗しました" };
  }

  return {
    ok: true,
    form: result.form || null
  };
}

function doGet(e) {
  // Serve the built single-page app via HtmlService.
  var html = HtmlService.createHtmlOutputFromFile("Index");

  // GAS WebApp URLを取得してHTMLに注入
  var webAppUrl = ScriptApp.getService().getUrl();
  var htmlContent = html.getContent();

  // URLパラメータを取得
  var formParam = (e && e.parameter && e.parameter.form) ? String(e.parameter.form) : "";
  var adminkeyParam = (e && e.parameter && e.parameter.adminkey) ? String(e.parameter.adminkey) : "";

  // 認証判定
  var authResult = DetermineAccess_(formParam, adminkeyParam);

  // </head>の直前にscriptタグを挿入してグローバル変数を設定
  var injectedScript = '<script>' +
    'window.__GAS_WEBAPP_URL__ = "' + webAppUrl + '";' +
    'window.__IS_ADMIN__ = ' + (authResult.isAdmin ? 'true' : 'false') + ';' +
    'window.__FORM_ID__ = "' + authResult.formId + '";' +
    'window.__AUTH_ERROR__ = "' + authResult.authError + '";' +
    '</script>';
  htmlContent = htmlContent.replace('</head>', injectedScript + '</head>');

  return HtmlService.createHtmlOutput(htmlContent)
    .setTitle("Nested Form Builder")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  return handleCors_(e, function() {
    var ctx = Model_parseRequest_(e);
    var action = (ctx.raw && ctx.raw.action) || "save";

    // リクエストから管理者キーを取得して認証チェック
    var formParam = (ctx.raw && ctx.raw.authKey) ? String(ctx.raw.authKey) : "";
    var isAdmin = IsAdmin_(formParam);

    // 管理者専用アクション
    var adminOnlyActions = [
      "forms_create",
      "forms_update",
      "forms_delete",
      "forms_archive",
      "admin_key_get",
      "admin_key_set"
    ];

    try {
      var payload;

      // 管理者専用アクションのチェック
      if (adminOnlyActions.indexOf(action) !== -1 && !isAdmin) {
        return JsonOutput_({ ok: false, error: "管理者権限が必要です" }, 403);
      }

      // 管理者キー管理API
      if (action === "admin_key_get") {
        payload = { ok: true, adminKey: GetAdminKey_() };
      } else if (action === "admin_key_set") {
        var newKey = (ctx.raw && ctx.raw.adminKey !== undefined) ? ctx.raw.adminKey : "";
        payload = SetAdminKey_(newKey);
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
        var missingSpreadsheetId = RequireSpreadsheetIdJson_(ctx);
        if (missingSpreadsheetId) return missingSpreadsheetId;
        payload = DeleteRecord_(ctx);
      } else if (action === "list") {
        var missingSpreadsheetId = RequireSpreadsheetIdJson_(ctx);
        if (missingSpreadsheetId) return missingSpreadsheetId;
        payload = ListRecords_(ctx);
      } else if (action === "get") {
        var missingSpreadsheetId = RequireSpreadsheetIdJson_(ctx);
        if (missingSpreadsheetId) return missingSpreadsheetId;
        payload = GetRecord_(ctx);
      } else {
        var missingSpreadsheetId = RequireSpreadsheetIdJson_(ctx);
        if (missingSpreadsheetId) return missingSpreadsheetId;
        payload = SubmitResponses_(ctx);
      }

      return JsonOutput_(payload, 200);
    } catch (err) {
      return JsonInternalError_(err);
    }
  });
}

function saveResponses(payload) {
  var ctx = Model_fromScriptRunPayload_(payload);
  RequireSpreadsheetId_(ctx);
  return SubmitResponses_(ctx);
}

function deleteRecord(payload) {
  var ctx = Model_fromScriptRunPayload_(payload);
  RequireSpreadsheetId_(ctx);
  RequireId_(ctx);
  return DeleteRecord_(ctx);
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
    createdAt: createdValue,
    modifiedAt: modifiedValue,
    createdAtUnixMs: createdInfo.unixMs,
    modifiedAtUnixMs: modifiedInfo.unixMs,
    data: serializedData,
    dataUnixMs: serializedDataUnixMs
  };
}

function getRecord(payload) {
  var ctx = Model_fromScriptRunPayload_(payload);
  RequireSpreadsheetId_(ctx);
  RequireId_(ctx);
  var result = GetRecord_(ctx);
  return result;
}

function listRecords(payload) {
  var ctx = Model_fromScriptRunPayload_(payload);
  RequireSpreadsheetId_(ctx);
  var result = ListRecords_(ctx);

  if (result && Array.isArray(result.records)) {
    result.records = result.records.map(SerializeRecord_);
  }

  return result;
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
  var missingId = RequireRecordIdResult_(ctx);
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
  var missingId = RequireRecordIdResult_(ctx);
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

function JsonOutput_(payload, status) {
  var output = ContentService.createTextOutput(JSON.stringify(payload || {})).setMimeType(ContentService.MimeType.JSON);
  if (typeof status === "number" && output.setStatusCode) {
    output.setStatusCode(status);
  }
  return output;
}

function JsonBadRequest_(message) {
  return JsonOutput_({ ok: false, error: message }, 400);
}

function JsonInternalError_(err) {
  return JsonOutput_({ ok: false, error: nfbErrorToString_(err) }, 500);
}

function RequireSpreadsheetIdJson_(ctx) {
  if (ctx && ctx.spreadsheetId) return null;
  return JsonBadRequest_("no spreadsheetId");
}

function RequireSpreadsheetId_(ctx) {
  if (!ctx || !ctx.spreadsheetId) throw new Error("spreadsheetId is required");
}

function RequireId_(ctx) {
  if (!ctx || !ctx.id) throw new Error("id is required");
}

function RequireRecordIdResult_(ctx) {
  if (ctx && ctx.id) return null;
  return { ok: false, error: "Record ID is required" };
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
  var urlMap = GetFormUrls_();
  var includeArchived = ctx.raw && ctx.raw.includeArchived;
  var forms = ListFormsFromUrls_(urlMap, includeArchived);

  return {
    ok: true,
    forms: forms,
    count: forms.length
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

  var fileUrl = GetFormUrl_(formId);
  if (!fileUrl) {
    return { ok: false, error: "フォームが見つかりません" };
  }

  var form = GetFormByUrl_(fileUrl);
  if (!form) {
    return { ok: false, error: "フォームの取得に失敗しました" };
  }

  return {
    ok: true,
    form: form
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

  // 新しいファイルを作成（保存先URL指定）
  var result = CreateFormFile_(formData, saveUrl);

  // URLマップに追加
  AddFormUrl_(result.formData.id, result.fileUrl);

  return {
    ok: true,
    form: result.formData
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

  // ファイルからフォームデータを取得
  var formData = GetFormByUrl_(fileUrl);
  if (!formData || !formData.id) {
    return { ok: false, error: "フォームデータの取得に失敗しました" };
  }

  // URLマップに追加
  var result = AddFormUrl_(formData.id, fileUrl);

  return {
    ok: true,
    form: formData,
    message: result.message
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

  var fileUrl = GetFormUrl_(formId);
  if (!fileUrl) {
    return { ok: false, error: "フォームが見つかりません" };
  }

  var updatedForm = UpdateFormByUrl_(fileUrl, updates);

  return {
    ok: true,
    form: updatedForm
  };
}

/**
 * フォーム削除API（URLマップから削除のみ、ファイルは削除しない）
 * @param {Object} ctx - リクエストコンテキスト
 * @return {Object} APIレスポンス
 */
function FormsApi_Delete_(ctx) {
  var formId = ctx.raw && ctx.raw.formId;
  if (!formId) {
    return { ok: false, error: "フォームIDが指定されていません" };
  }

  var result = RemoveFormUrl_(formId);

  return {
    ok: true,
    message: result.message,
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

  var fileUrl = GetFormUrl_(formId);
  if (!fileUrl) {
    return { ok: false, error: "フォームが見つかりません" };
  }

  var updatedForm = UpdateFormByUrl_(fileUrl, { archived: archived });

  return {
    ok: true,
    form: updatedForm
  };
}

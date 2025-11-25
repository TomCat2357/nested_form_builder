function doGet() {
  // Serve the built single-page app via HtmlService.
  var html = HtmlService.createHtmlOutputFromFile("Index");

  // GAS WebApp URLを取得してHTMLに注入
  var webAppUrl = ScriptApp.getService().getUrl();
  var htmlContent = html.getContent();

  // </head>の直前にscriptタグを挿入してGAS URLをグローバル変数として設定
  var injectedScript = '<script>window.__GAS_WEBAPP_URL__ = "' + webAppUrl + '";</script>';
  htmlContent = htmlContent.replace('</head>', injectedScript + '</head>');

  return HtmlService.createHtmlOutput(htmlContent)
    .setTitle("Nested Form Builder")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  return handleCors_(e, function() {
    var ctx = Model_parseRequest_(e);
    var action = (ctx.raw && ctx.raw.action) || "save";

    try {
      var payload;

      // フォーム管理API
      if (action === "forms_list") {
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
        if (!ctx.spreadsheetId) {
          return JsonOutput_({ ok: false, error: "no spreadsheetId" }, 400);
        }
        payload = DeleteRecord_(ctx);
      } else if (action === "list") {
        if (!ctx.spreadsheetId) {
          return JsonOutput_({ ok: false, error: "no spreadsheetId" }, 400);
        }
        payload = ListRecords_(ctx);
      } else if (action === "get") {
        if (!ctx.spreadsheetId) {
          return JsonOutput_({ ok: false, error: "no spreadsheetId" }, 400);
        }
        payload = GetRecord_(ctx);
      } else {
        if (!ctx.spreadsheetId) {
          return JsonOutput_({ ok: false, error: "no spreadsheetId" }, 400);
        }
        payload = SubmitResponses_(ctx);
      }

      return JsonOutput_(payload, 200);
    } catch (err) {
      return JsonOutput_({ ok: false, error: (err && err.message) || String(err) }, 500);
    }
  });
}

function saveResponses(payload) {
  var ctx = Model_fromScriptRunPayload_(payload);
  if (!ctx.spreadsheetId) throw new Error("spreadsheetId is required");
  return SubmitResponses_(ctx);
}

function deleteRecord(payload) {
  var ctx = Model_fromScriptRunPayload_(payload);
  if (!ctx.spreadsheetId) throw new Error("spreadsheetId is required");
  if (!ctx.id) throw new Error("id is required");
  return DeleteRecord_(ctx);
}

function SerializeValue_(value) {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function SerializeDateLike_(value) {
  var date = Sheets_parseDateLikeToJstDate_(value);
  if (date) {
    return { iso: date.toISOString(), unixMs: date.getTime() };
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

  var createdInfo = SerializeDateLike_(record.createdAt);
  var modifiedInfo = SerializeDateLike_(record.modifiedAt);

  return {
    id: String(record.id || ""),
    "No.": record["No."] != null ? record["No."] : "",
    createdAt: createdInfo.iso, // 互換用: 従来のISO文字列
    modifiedAt: modifiedInfo.iso, // 互換用
    createdAtUnixMs: createdInfo.unixMs,
    modifiedAtUnixMs: modifiedInfo.unixMs,
    data: serializedData,
    dataUnixMs: serializedDataUnixMs,
    rowHash: record.rowHash || ""
  };
}

function getRecord(payload) {
  var ctx = Model_fromScriptRunPayload_(payload);
  if (!ctx.spreadsheetId) throw new Error("spreadsheetId is required");
  if (!ctx.id) throw new Error("id is required");
  var result = GetRecord_(ctx);
  return result;
}

function listRecords(payload) {
  var ctx = Model_fromScriptRunPayload_(payload);
  if (!ctx.spreadsheetId) throw new Error("spreadsheetId is required");
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
  if (!ctx.id) {
    return { ok: false, error: "Record ID is required" };
  }

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
  if (!ctx.id) {
    return { ok: false, error: "Record ID is required" };
  }

  var sheet = Sheets_getOrCreateSheet_(ctx.spreadsheetId, ctx.sheetName);
  var result = Sheets_getRecordById_(sheet, ctx.id, ctx.rowIndexHint, ctx.cachedRowHash);

  if (!result || !result.ok) {
    return result || { ok: false, error: "Record not found" };
  }

  return {
    ok: true,
    record: result.record ? SerializeRecord_(result.record) : null,
    rowIndex: result.rowIndex,
    unchanged: result.unchanged,
    rowHash: result.rowHash || "",
  };
}

function ListRecords_(ctx) {
  var sheet = Sheets_getOrCreateSheet_(ctx.spreadsheetId, ctx.sheetName);
  var records = Sheets_getAllRecords_(sheet);
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

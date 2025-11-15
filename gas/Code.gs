function doGet() {
  // Serve the built single-page app via HtmlService.
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("Nested Form Builder")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  return handleCors_(e, function() {
    var ctx = Model_parseRequest_(e);
    var action = (ctx.raw && ctx.raw.action) || "save";

    if (!ctx.spreadsheetId) {
      return JsonOutput_({ ok: false, error: "no spreadsheetId" }, 400);
    }

    try {
      var payload;
      if (action === "delete") {
        payload = DeleteRecord_(ctx);
      } else if (action === "list") {
        payload = ListRecords_(ctx);
      } else if (action === "get") {
        payload = GetRecord_(ctx);
      } else {
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
  if (value instanceof Date) return value.toISOString();
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function SerializeRecord_(record) {
  var serializedData = {};
  if (record.data && typeof record.data === "object") {
    for (var key in record.data) {
      if (record.data.hasOwnProperty(key)) {
        serializedData[key] = SerializeValue_(record.data[key]);
      }
    }
  }

  return {
    id: String(record.id || ""),
    "No.": record["No."] != null ? record["No."] : "",
    createdAt: SerializeValue_(record.createdAt),
    modifiedAt: SerializeValue_(record.modifiedAt),
    data: serializedData
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
  var record = Sheets_getRecordById_(sheet, ctx.id);

  if (!record) {
    return { ok: false, error: "Record not found" };
  }

  return {
    ok: true,
    record: SerializeRecord_(record),
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

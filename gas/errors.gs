/**
 * errors.gs
 * エラーハンドリングとレスポンスヘルパー
 */

function nfbErrorToString_(err) {
  return (err && err.message) ? err.message : String(err);
}

function nfbFail_(err) {
  return { ok: false, error: nfbErrorToString_(err) };
}

function nfbSafeCall_(fn) {
  try {
    return fn();
  } catch (err) {
    return nfbFail_(err);
  }
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

function JsonForbidden_(message) {
  return JsonOutput_({ ok: false, error: message || "forbidden" }, 403);
}

function JsonInternalError_(err) {
  return JsonOutput_({ ok: false, error: nfbErrorToString_(err) }, 500);
}

// 成功時: null, 失敗時: { ok: false, error: "..." }
function RequireSpreadsheetId_(ctx) {
  if (ctx && ctx.spreadsheetId) return null;
  return nfbFail_("spreadsheetId is required");
}

// 成功時: null, 失敗時: { ok: false, error: "..." }
function RequireRecordId_(ctx) {
  if (ctx && ctx.id) return null;
  return nfbFail_("Record ID is required");
}

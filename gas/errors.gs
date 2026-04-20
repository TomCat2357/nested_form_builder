function nfbErrorToString_(err) {
  return (err && err.message) || String(err);
}

function nfbFail_(err) {
  var payload = { ok: false, error: nfbErrorToString_(err) };
  if (err && err.reason) payload.reason = err.reason;
  if (err && err.groupErrors) payload.groupErrors = err.groupErrors;
  if (err && err.detail) payload.detail = err.detail;
  return payload;
}

function nfbSafeCall_(fn) {
  try { return fn(); } catch (err) { return nfbFail_(err); }
}

function JsonOutput_(payload, status) {
  var output = ContentService.createTextOutput(JSON.stringify(payload || {})).setMimeType(ContentService.MimeType.JSON);
  if (typeof status === "number" && output.setStatusCode) output.setStatusCode(status);
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

function RequireSpreadsheetId_(ctx) {
  return (ctx && ctx.spreadsheetId) ? null : nfbFail_("スプレッドシートIDが設定されていません。フォーム設定を確認してください。");
}

function RequireRecordId_(ctx) {
  return (ctx && ctx.id) ? null : nfbFail_("レコードIDが指定されていません");
}

function Sheets_translateOpenError_(err, spreadsheetId) {
  var msg = String(err && err.message ? err.message : err);
  if (/not found/i.test(msg) || /no item/i.test(msg)) {
    return "スプレッドシートが見つかりません (ID: " + spreadsheetId + ")";
  }
  if (/permission/i.test(msg) || /access/i.test(msg) || /You do not have/i.test(msg)) {
    return "スプレッドシートへのアクセス権限がありません (ID: " + spreadsheetId + ")";
  }
  return "スプレッドシートを開けませんでした: " + msg;
}

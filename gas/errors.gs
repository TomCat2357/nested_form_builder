const nfbErrorToString_ = (err) => err?.message || String(err);
const nfbFail_ = (err) => ({ ok: false, error: nfbErrorToString_(err) });
const nfbSafeCall_ = (fn) => { try { return fn(); } catch (err) { return nfbFail_(err); } };

const JsonOutput_ = (payload, status) => {
  const output = ContentService.createTextOutput(JSON.stringify(payload || {})).setMimeType(ContentService.MimeType.JSON);
  if (typeof status === "number" && output.setStatusCode) output.setStatusCode(status);
  return output;
};

const JsonBadRequest_ = (message) => JsonOutput_({ ok: false, error: message }, 400);
const JsonForbidden_ = (message = "forbidden") => JsonOutput_({ ok: false, error: message }, 403);
const JsonInternalError_ = (err) => JsonOutput_({ ok: false, error: nfbErrorToString_(err) }, 500);

const RequireSpreadsheetId_ = (ctx) => ctx?.spreadsheetId ? null : nfbFail_("スプレッドシートIDが設定されていません。フォーム設定を確認してください。");
const RequireRecordId_ = (ctx) => ctx?.id ? null : nfbFail_("レコードIDが指定されていません");

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

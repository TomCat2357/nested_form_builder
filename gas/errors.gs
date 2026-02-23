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

const RequireSpreadsheetId_ = (ctx) => ctx?.spreadsheetId ? null : nfbFail_("spreadsheetId is required");
const RequireRecordId_ = (ctx) => ctx?.id ? null : nfbFail_("Record ID is required");

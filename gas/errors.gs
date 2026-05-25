function nfbErrorToString_(err) {
  return (err && err.message) || String(err);
}

// 生の GAS 例外（"Exception:" を含む）やスタックトレース様・極端に長い文字列は
// 内部情報の漏洩とみなし null を返す（呼び出し側で汎用メッセージに置換）。
// 既存の意図的な日本語バリデーションメッセージはそのまま通す（UX 維持）。
function nfbSanitizeErrorMessage_(rawMessage) {
  var msg = String(rawMessage == null ? "" : rawMessage);
  if (/Exception:/.test(msg)) return null;
  if (/\bat [A-Za-z0-9_$.]+ \(/.test(msg)) return null;
  if (msg.length > 300) return null;
  return msg;
}

function nfbFail_(err) {
  var rawMessage = nfbErrorToString_(err);
  var safeMessage = nfbSanitizeErrorMessage_(rawMessage);
  var payload;
  if (safeMessage === null) {
    Logger.log("[nfbFail_] internal error: " + rawMessage);
    payload = { ok: false, error: "処理中にエラーが発生しました", code: "INTERNAL" };
  } else {
    payload = { ok: false, error: safeMessage };
  }
  if (err && err.reason) payload.reason = err.reason;
  if (err && err.groupErrors) payload.groupErrors = err.groupErrors;
  if (err && err.detail) payload.detail = err.detail;
  return payload;
}

function nfbSafeCall_(fn) {
  try { return fn(); } catch (err) { return nfbFail_(err); }
}

// google.script.run 公開関数の共通転送ヘルパ。各ドメイン (Forms / Analytics) の
// nfb* ラッパが action 名 + payload を渡してくる。実体は executeAction_（Code.gs、
// バンドル後段だが GAS は関数宣言を全体ホイストするので呼び出し時には解決済み）。
function Nfb_runScriptAction_(action, payload) {
  return executeAction_(action, payload || {}, { source: "scriptRun" });
}

// バッチ系ヘルパ ({ ok, <listKey>: [...], errors: [...] }) の結果を
// 単一要素レスポンス ({ ok: true, <resultKey>: item } | { ok: false, error }) に畳む。
function Nfb_unwrapSingleResult_(res, listKey, resultKey) {
  if (!res || !res.ok) return res;
  var items = res[listKey] || [];
  if (items.length > 0) {
    var wrapped = { ok: true };
    wrapped[resultKey] = items[0];
    return wrapped;
  }
  return { ok: false, error: (res.errors && res.errors[0]) ? res.errors[0].error : "Unknown error" };
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

function RequireFormId_(ctx) {
  return (ctx && ctx.raw && ctx.raw.formId) ? null : nfbFail_("フォームIDが指定されていません");
}

function Sheets_translateOpenError_(err, spreadsheetId) {
  var msg = String(err && err.message ? err.message : err);
  // スプレッドシート ID・生の例外メッセージはクライアントに返さず、サーバログにのみ残す。
  Logger.log("[Sheets_translateOpenError_] spreadsheetId=" + spreadsheetId + " error=" + msg);
  if (/not found/i.test(msg) || /no item/i.test(msg)) {
    return "スプレッドシートが見つかりません。フォーム設定を確認してください";
  }
  if (/permission/i.test(msg) || /access/i.test(msg) || /You do not have/i.test(msg)) {
    return "スプレッドシートへのアクセス権限がありません";
  }
  return "スプレッドシートを開けませんでした。フォーム設定を確認してください";
}

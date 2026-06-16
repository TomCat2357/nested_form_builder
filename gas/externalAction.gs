// =============================================================================
// 外部アクション（externalAction）サーバ間リレー送信
//
// レコード詳細 / 検索結果の「外部アクションボタン」は、従来ブラウザの隠しフォーム
// POST で別 GAS Web アプリへ送っていたが、受信側をログイン必須（access: ANYONE）に
// すると、ログイン/アカウント選択リダイレクトで POST 本文が失われる弱点があった
// （リダイレクト後は GET になる）。GAS の iframe サンドボックスにより postMessage
// ハンドシェイクも成立しないため、本体 GAS から UrlFetchApp でサーバ間リレーする。
//
// フロント（gasClient.sendExternalAction）が { url, payload } を渡し、ここで
//   POST url?nfbRelay=1   body: payload=<JSON 文字列>   Authorization: Bearer <token>
// として送る。受信側 doPost は e.parameter.payload を JSON.parse して受け取り、
// nfbRelay=1 のときは JSON で応答する（未対応の旧受信アプリは HTML を返すが、フロント
// 側で汎用アラートにフォールバックする）。
// =============================================================================

// google.script.run 公開ラッパー（既存ドメインの nfb* と同じ Nfb_runScriptAction_ 経由）。
function nfbSendExternalAction(payload) { return Nfb_runScriptAction_("ext_action_send", payload || {}); }

// http(s) で始まる URL かを検証する純関数。
function ExtAction_isValidUrl_(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

// URL に nfbRelay=1 クエリを冪等に付与する純関数。
// 既に nfbRelay が付いていれば二重付与しない。ハッシュ（#...）があれば手前に挿す。
function ExtAction_appendRelayParam_(url) {
  var raw = String(url == null ? "" : url).trim();
  if (/[?&]nfbRelay=/.test(raw)) return raw;
  var hashIndex = raw.indexOf("#");
  var hash = "";
  var base = raw;
  if (hashIndex >= 0) {
    hash = raw.slice(hashIndex);
    base = raw.slice(0, hashIndex);
  }
  var sep = base.indexOf("?") >= 0 ? "&" : "?";
  return base + sep + "nfbRelay=1" + hash;
}

// 受信 Web アプリへ payload をサーバ間 POST する。
// 戻り値は { ok, status, body } または { ok:false, error, code }（nfbSafeCall_ 経由）。
function ExtAction_send_(raw) {
  return nfbSafeCall_(function() {
    var url = raw && typeof raw.url === "string" ? raw.url.trim() : "";
    if (!ExtAction_isValidUrl_(url)) {
      return { ok: false, error: "URL が不正です（http:// または https:// で始まる必要があります）。", code: "BAD_URL" };
    }
    var payload = (raw && raw.payload && typeof raw.payload === "object") ? raw.payload : {};
    var target = ExtAction_appendRelayParam_(url);
    var response = UrlFetchApp.fetch(target, {
      method: "post",
      payload: { payload: JSON.stringify(payload) },
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    });
    var status = response.getResponseCode();
    var body = response.getContentText();
    return { ok: status >= 200 && status < 400, status: status, body: body };
  });
}

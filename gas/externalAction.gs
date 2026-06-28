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

// 誤送信防止ハンドシェイク用の使い捨て nonce を生成する。
// 既存の ULID 生成器（constants.gs）を流用し、新規乱数実装を避ける。
function ExtAction_makeNonce_() {
  return Nfb_generateUlid_();
}

// HMAC-SHA256(message, secret) を 16 進文字列で返す純関数。
// 送信側（検証）・受信側（署名）で同一実装を使う必要がある。
function ExtAction_hmacHex_(message, secret) {
  var raw = Utilities.computeHmacSha256Signature(String(message == null ? "" : message), String(secret == null ? "" : secret));
  var hex = "";
  for (var i = 0; i < raw.length; i++) {
    var b = (raw[i] + 256) % 256;
    var s = b.toString(16);
    if (s.length === 1) s = "0" + s;
    hex += s;
  }
  return hex;
}

// プローブ応答ボディ（JSON 文字列）を検証する純関数。
// 受信側が共有シークレットで HMAC(nonce) を計算して返したときだけ true。
// { ok:true, nfbExternalAction:true, signature:<hmacHex(nonce, secret)> } のみ通す。
function ExtAction_verifyProbeResponse_(body, nonce, secret) {
  var data;
  try {
    data = JSON.parse(String(body == null ? "" : body));
  } catch (e) {
    return false;
  }
  if (!data || typeof data !== "object") return false;
  if (data.ok !== true || data.nfbExternalAction !== true) return false;
  if (typeof data.signature !== "string" || data.signature === "") return false;
  return data.signature === ExtAction_hmacHex_(nonce, secret);
}

// 受信 Web アプリへ ?nfbRelay=1 付きで bodyObj を form-POST する低レベルヘルパ。
// bodyObj はそのまま payload オブジェクトとして渡す（本送信 {payload:<JSON>} / プローブ {nfbProbe,nonce}）。
// 戻り値は { ok, status, body }。プローブ・本送信で共有する。
function ExtAction_postRelay_(url, bodyObj) {
  var target = ExtAction_appendRelayParam_(url);
  var response = UrlFetchApp.fetch(target, {
    method: "post",
    payload: bodyObj,
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
  });
  var status = response.getResponseCode();
  var body = response.getContentText();
  return { ok: status >= 200 && status < 400, status: status, body: body };
}

// 受信 Web アプリへ payload をサーバ間 POST する。
// 送信元シークレット（管理者設定 / スクリプトプロパティ）が設定されているときは、本データを
// 送る前に nonce プローブで宛先を検証し、共有シークレットの HMAC が一致した正規の受信アプリ
// にだけ送信する（誤送信防止）。
// 戻り値は { ok, status, body } または { ok:false, error, code }（nfbSafeCall_ 経由）。
function ExtAction_send_(raw) {
  return nfbSafeCall_(function() {
    var url = raw && typeof raw.url === "string" ? raw.url.trim() : "";
    if (!ExtAction_isValidUrl_(url)) {
      return { ok: false, error: "URL が不正です（http:// または https:// で始まる必要があります）。", code: "BAD_URL" };
    }
    var payload = (raw && raw.payload && typeof raw.payload === "object") ? raw.payload : {};
    // 送信元シークレットは管理者設定（スクリプトプロパティ）から読む。フォーム定義やフロント
    // ペイロードには持たせない。空文字なら誤送信防止プローブなしで送信（後方互換）。
    var secret = GetExtActionSecret_();

    if (secret !== "") {
      // Phase1: 機微データを含まないプローブで宛先を検証する（シークレットは送らない）。
      var nonce = ExtAction_makeNonce_();
      var probe = ExtAction_postRelay_(url, { nfbProbe: "1", nonce: nonce });
      if (!ExtAction_verifyProbeResponse_(probe.body, nonce, secret)) {
        return {
          ok: false,
          code: "DEST_UNVERIFIED",
          error: "宛先を外部アクション受信アプリとして確認できませんでした（誤送信防止）。送信先 URL とシークレットの設定を確認してください。",
        };
      }
    }

    // ファイル参照（名前・URL・フォルダ URL）は payload.records[].items[].files にフロントが内包
    // 済み（driveFileId から決定的に再構成）。サーバ側 Drive 解決は廃止したのでここでは何もしない。

    // Phase2（または検証なし）: 本 payload を送信する。
    return ExtAction_postRelay_(url, { payload: JSON.stringify(payload) });
  });
}

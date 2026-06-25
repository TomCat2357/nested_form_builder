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

// フロントが渡すファイル参照配列（raw.files）を解決し、質問項目ごとに「フォルダ URL/名前・
// ファイル URL/名前」を構造化して payload.files に詰める純ヘルパ。ファイル実体（base64）は
// 送らず、Drive の URL とメタデータだけを送る。Drive アクセスは deps で注入してテスト可能にする。
//   deps = {
//     resolve(name, driveFileId, folderName) -> { fileId, fileUrl }      物理優先・論理フォールバック解決
//     resolveFolder(fileId)                  -> { folderUrl, folderName }  ファイルの親フォルダ解決
//   }
// payload.files は質問パスをキーにしたオブジェクト:
//   { [question]: { fieldId, folderName, folderUrl, files: [{ name, url }] } }
// 質問パスは一意（フロントのスキーマ検証 validateUniquePaths で保証）なのでキー衝突しない。
// 解決できなかったファイルは除外し、件数を payload.filesWarning に残す。
// 機微データ（URL）を宛先未検証で送らない方針のため、プローブ（誤送信防止）には絶対に呼ばない。
function ExtAction_attachFiles_(payload, files, deps) {
  var list = (Object.prototype.toString.call(files) === "[object Array]") ? files : [];
  if (list.length === 0) return payload;
  var grouped = {};
  var folderCache = {};
  var unresolved = 0;
  for (var i = 0; i < list.length; i++) {
    var ref = list[i] || {};
    var name = typeof ref.name === "string" ? ref.name : "";
    var driveFileId = typeof ref.driveFileId === "string" ? ref.driveFileId : "";
    var folderName = typeof ref.folderName === "string" ? ref.folderName : "";
    var question = typeof ref.question === "string" ? ref.question : "";
    var resolved = deps.resolve(name, driveFileId, folderName) || {};
    var fileId = typeof resolved.fileId === "string" ? resolved.fileId : "";
    if (!fileId) { unresolved++; continue; }
    // 親フォルダ解決は重いので fileId ごとにキャッシュ（同一質問の複数ファイルは同フォルダ）。
    var folder = folderCache[fileId];
    if (!folder) {
      try {
        folder = deps.resolveFolder(fileId) || {};
      } catch (e) {
        folder = {};
      }
      folderCache[fileId] = folder;
    }
    var group = grouped[question];
    if (!group) {
      group = {
        fieldId: typeof ref.fieldId === "string" ? ref.fieldId : "",
        folderName: folderName || (typeof folder.folderName === "string" ? folder.folderName : ""),
        folderUrl: typeof folder.folderUrl === "string" ? folder.folderUrl : "",
        files: [],
      };
      grouped[question] = group;
    }
    group.files.push({
      name: name || "",
      url: typeof resolved.fileUrl === "string" ? resolved.fileUrl : "",
    });
  }
  payload.files = grouped;
  if (unresolved > 0) {
    payload.filesWarning = unresolved + " 件のファイルを取得できませんでした（移動/削除済みの可能性）。";
  }
  return payload;
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

    // アップロードファイルの URL/名前は、宛先検証（プローブ）を通過した後にだけ Drive から解決して
    // 同梱する（機微データを未検証の宛先へ送らないため）。実体（base64）は送らず URL のみ。
    var files = (raw && Object.prototype.toString.call(raw.files) === "[object Array]") ? raw.files : [];
    if (files.length > 0) {
      ExtAction_attachFiles_(payload, files, {
        resolve: Nfb_resolveUploadFileEntry_,
        resolveFolder: function(fileId) {
          var parents = DriveApp.getFileById(fileId).getParents();
          if (parents.hasNext()) {
            var folder = parents.next();
            return { folderUrl: folder.getUrl(), folderName: folder.getName() };
          }
          return { folderUrl: "", folderName: "" };
        },
      });
    }

    // Phase2（または検証なし）: 本 payload を送信する。
    return ExtAction_postRelay_(url, { payload: JSON.stringify(payload) });
  });
}

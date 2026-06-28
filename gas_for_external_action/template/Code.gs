// =============================================================================
// 外部アクション受信 Web App テンプレート (Nested Form Builder 連携)
//
// React (Builder) の「外部アクションボタン」は、隠しフォームを生成して
//   method=POST / target=_blank
// でこの Web App の URL を叩く。送信本体は 1 つの form フィールド "payload"
// (JSON 文字列) で、GAS 側は doPost(e).parameter.payload を JSON.parse して
// 全データを受け取る。
//
// payload の構造 (buildExternalActionPayload と同期):
//   起動元（編集・閲覧画面 / 検索一覧の単一選択 / 検索一覧の複数選択）に依らず単一フォーマット。
//   受信側は recordCount（= records 数）だけで単一/複数を判定する（旧 context は廃止）。
//     formId      : string
//     formName    : string
//     generatedAt : ISO8601 文字列 (送信時刻 UTC)
//     recordCount : number   records 配列の件数（編集画面・検索単一は 1、検索複数は N）
//     records     : { id, no, items }[]
//       id    : string
//       no    : string | number
//       items : { question, value, type, files?, folderUrl?, folderName? }[]
//               question = ヘッダー階層を "/" 連結した質問（子フォーム formLink は "親/#No/子質問"）。
//               fileUpload 項目は files:[{ name, url, driveFileId? }] と folderUrl/folderName を内包
//               （ファイル実体ではなく Drive の URL のみ。driveFileId から決定的に再構成）。
//               ※ Excel 等の中身を読むには、対象 Drive ファイルへの閲覧権限を持つアカウントで
//                 Drive.Files を使い Google スプレッドシートへ変換取り込みしてから読む。
//   管理者限定ボタンのときのみ付与:
//     storage.spreadsheetId / spreadsheetUrl / sheetName / driveFileUrl / userEmail
//                / childSpreadsheetId / childSpreadsheetUrl / childSheetName
//
// このファイルは「受け取って中身を確認する」ところまでを実装した雛形。
// 実際の業務処理 (シート転記・別 API 呼び出し等) は handleRecords_ の中に追記して使う。
// 単一レコード専用のアクションは handleRecords_ 冒頭の recordCount チェック例を参照。
//
// ■ 誤送信防止ハンドシェイク (任意):
//   本体アプリ側の 外部アクション 設定で「誤送信防止シークレット」を設定すると、本体は
//   データ送信の直前に { nfbProbe:"1", nonce } の軽量プローブを投げてくる。この Web App は
//   Script Properties の NFB_EXT_ACTION_SECRET と同じ値のときだけ HMAC(nonce) 署名を返し、
//   本体はそれを検証して一致したときだけ本データを送る (URL 打ち間違いによる誤送信を防止)。
//   有効化するには: この GAS プロジェクトの Script Properties に NFB_EXT_ACTION_SECRET を
//   登録し、本体フォーム側の同設定欄に同じ値を入れる。未設定なら従来どおり検証なしで届く。
//
// 動作確認はデプロイ不要。Test.gs の testDoPost_singleRecord / testDoPost_multiRecords /
// testDoPost_adminStorage を GAS エディタから実行し、実行ログ (Logger) を見る。
// =============================================================================

// ----- Web App エントリ ----------------------------------------------------
// 本体アプリは UrlFetchApp サーバ間リレーで ?nfbRelay=1 を付けて POST してくる。
// その場合は HTML ではなく JSON ({ ok, title, message, openUrl }) で応答する
// （本体側がアラート＋リンクで結果表示する）。nfbRelay なしの直接 POST は従来 HTML を返す。
function doPost(e) {
  var relay = e && e.parameter && String(e.parameter.nfbRelay) === "1";
  try {
    var payload = parsePayload_(e);
    if (!payload.ok) {
      return relay ? renderJson_({ ok: false, message: payload.error })
                   : renderHtml_("エラー", escapeHtml_(payload.error), true);
    }

    // 誤送信防止ハンドシェイク（プローブ）への署名応答。機微処理は一切せず即返す。
    // Script Properties の NFB_EXT_ACTION_SECRET と送信側フォームのシークレットが一致する
    // ときだけ、本体側が検証できる HMAC(nonce) を返す。未設定なら nfbExternalAction:false。
    if (payload.data && String(payload.data.nfbProbe) === "1") {
      var probeSecret = PropertiesService.getScriptProperties().getProperty("NFB_EXT_ACTION_SECRET") || "";
      var probeNonce = String(payload.data.nonce || "");
      if (probeSecret === "" || probeNonce === "") {
        return renderJson_({ ok: true, nfbExternalAction: false });
      }
      return renderJson_({ ok: true, nfbExternalAction: true, signature: Recv_hmacHex_(probeNonce, probeSecret) });
    }

    var result = handleRecords_(payload.data);
    if (!result.ok) {
      return relay ? renderJson_({ ok: false, message: result.error })
                   : renderHtml_("エラー", "<p>" + escapeHtml_(result.error) + "</p>", true);
    }
    if (relay) {
      return renderJson_({
        ok: true,
        title: result.title || "受信完了",
        message: (result.title || "受信完了") + "（テンプレート受信アプリ）",
        openUrl: result.openUrl || "",
      });
    }
    return renderHtml_(result.title || "受信完了", result.message, false);
  } catch (err) {
    var em = String(err && err.message ? err.message : err);
    return relay ? renderJson_({ ok: false, message: em })
                 : renderHtml_("予期せぬエラー", "<p>" + escapeHtml_(em) + "</p>", true);
  }
}

// サーバ間リレー応答用の JSON 出力。
function renderJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj || {}))
    .setMimeType(ContentService.MimeType.JSON);
}

// 誤送信防止ハンドシェイク用 HMAC-SHA256(message, secret) を 16 進文字列で返す。
// 本体側 ExtAction_hmacHex_ と同一実装にすること（署名が一致しないと送信が拒否される）。
function Recv_hmacHex_(message, secret) {
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

// GET でも開けるようにしておく (URL をブラウザで直接叩いたときの動作確認用)。
function doGet() {
  return renderHtml_(
    "外部アクション受信 Web App",
    "<p>この URL は Nested Form Builder の外部アクションボタンから POST 送信を受け取ります。" +
    "ボタン経由でアクセスしてください。</p>",
    false
  );
}


// ----- payload 取り出し -----------------------------------------------------
// e.parameter.payload (JSON 文字列) を取り出して JSON.parse する。
// 戻り値は { ok, data } または { ok:false, error }。
function parsePayload_(e) {
  var params = (e && e.parameter) || {};
  var raw = params.payload;
  if (raw == null || String(raw) === "") {
    return { ok: false, error: "payload パラメータがありません。" };
  }
  var data;
  try {
    data = JSON.parse(String(raw));
  } catch (parseErr) {
    return { ok: false, error: "payload の JSON 解析に失敗しました: " + (parseErr && parseErr.message ? parseErr.message : parseErr) };
  }
  if (!data || typeof data !== "object") {
    return { ok: false, error: "payload がオブジェクトではありません。" };
  }
  return { ok: true, data: data };
}


// ----- レコード配列の処理（起動元に依らない統一フォーマット） ----------------
// 編集画面・検索一覧（単一/複数選択）すべて payload.records[]（{id,no,items}）で届く。
// 単一/複数は recordCount（= records 数）だけで判定する（旧 context は廃止）。
function handleRecords_(data) {
  logCommonFields_(data);
  var records = Array.isArray(data.records) ? data.records : [];
  var recordCount = (typeof data.recordCount === "number") ? data.recordCount : records.length;

  Logger.log("=== records ===");
  Logger.log("recordCount = %s（records=%s）", recordCount, records.length);

  // 単一レコードしか受け取らない外部アクションは、ここで件数を見て弾く（例）:
  //   if (recordCount !== 1) {
  //     return { ok: false, error: "このアクションは単一レコード専用です（" + recordCount + " 件届きました）。" };
  //   }

  for (var ri = 0; ri < records.length; ri++) {
    var rec = records[ri] || {};
    var items = Array.isArray(rec.items) ? rec.items : [];
    Logger.log("--- record[%s] id=%s no=%s 項目数=%s ---", ri, rec.id, rec.no, items.length);
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      // question は "親/子/#1/孫" 形式（"#No" は子フォーム formLink レコードのマーカー）。
      // "/" の数だけインデントするとネスト構造が読みやすい。
      var depth = String(it.question || "").split("/").length - 1;
      Logger.log("%s[%s] %s = %s", repeat_("  ", depth > 0 ? depth : 0), it.type, it.question, it.value);
      // ファイル参照は item.files（[{ name, url, driveFileId? }]）に内包。フォルダは item.folderUrl/folderName。
      var itFiles = Array.isArray(it.files) ? it.files : [];
      for (var fi = 0; fi < itFiles.length; fi++) {
        var f = itFiles[fi] || {};
        Logger.log("    - file: %s : %s", f.name, f.url);
      }
    }
  }

  // TODO: ここに業務処理を書く（例: records を別 API に送る / シート転記 / Doc 生成 など）。
  //   ファイル実体を読むなら item.files[].url（または driveFileId）の Drive ファイルを、閲覧権限を
  //   持つアカウントで Drive.Files から Google スプレッドシート等へ取り込んでから読む。

  // --- 受信内容をそのまま画面表示する（テスト用） ---------------------------
  var html = "";
  html += '<p class="lead">レコード <strong>' + recordCount + '</strong> 件を受信しました' +
    (recordCount === 1 ? '（単一レコード）' : '') + '。</p>';
  html += renderCommonFields_(data);

  if (!records.length) {
    html += '<p class="muted">レコードがありません。</p>';
  } else {
    for (var rj = 0; rj < records.length; rj++) {
      html += renderRecordBlock_(records[rj] || {}, rj);
    }
  }
  html += renderStorageBlock_(data);

  return { ok: true, title: "レコード受信", message: html };
}

function logCommonFields_(data) {
  Logger.log("formId      = %s", data.formId);
  Logger.log("formName    = %s", data.formName);
  Logger.log("generatedAt = %s", data.generatedAt);
  if (data.storage && typeof data.storage === "object") {
    Logger.log("storage (管理者限定) = %s", JSON.stringify(data.storage));
  }
}


// ----- ヘルパ --------------------------------------------------------------
// 1 レコード（{ id, no, items }）を見出し + 項目表（質問/type/値/添付）で描画する。
function renderRecordBlock_(rec, index) {
  var items = Array.isArray(rec.items) ? rec.items : [];
  var html = '<h2>record[' + index + '] No.' + escapeHtml_(String(rec.no != null ? rec.no : "")) +
    ' <span class="muted">(<code>' + escapeHtml_(String(rec.id || "")) + '</code>)</span></h2>';
  if (!items.length) {
    html += '<p class="muted">項目がありません。</p>';
    return html;
  }
  html += '<div class="tableWrap"><table><thead><tr>' +
    '<th>質問 (ネスト)</th><th>type</th><th>値</th><th>添付</th></tr></thead><tbody>';
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    // question は "親/子/#1/孫" 形式。"/" の数だけインデントしてネスト構造を表現する。
    var parts = String(it.question || "").split("/");
    var depth = parts.length - 1;
    var leaf = parts[parts.length - 1];
    var pad = depth > 0 ? ' style="padding-left:' + (depth * 18) + 'px"' : '';
    html += '<tr>';
    html += '<td' + pad + '>' + (depth > 0 ? '<span class="muted">↳ </span>' : '') + escapeHtml_(leaf) + '</td>';
    html += '<td><span class="tag">' + escapeHtml_(String(it.type || "")) + '</span></td>';
    html += '<td>' + escapeHtml_(String(it.value == null ? "" : it.value)) + '</td>';
    html += '<td>' + renderItemFiles_(it) + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

// item.files（[{ name, url }]）と item.folderUrl/folderName を表示用 HTML に変換する。
// ファイル実体ではなく Drive のフォルダ/ファイル URL のみが届く。
function renderItemFiles_(it) {
  var files = Array.isArray(it.files) ? it.files : [];
  if (!files.length && !it.folderUrl && !it.folderName) return "";
  var html = "";
  if (it.folderUrl || it.folderName) {
    html += it.folderUrl
      ? '<a href="' + escapeHtml_(String(it.folderUrl)) + '" target="_blank" rel="noopener">' + escapeHtml_(String(it.folderName || "フォルダ")) + '</a><br>'
      : escapeHtml_(String(it.folderName || "")) + '<br>';
  }
  for (var i = 0; i < files.length; i++) {
    var f = files[i] || {};
    html += f.url
      ? '<a href="' + escapeHtml_(String(f.url)) + '" target="_blank" rel="noopener">' + escapeHtml_(String(f.name || f.url)) + '</a><br>'
      : escapeHtml_(String(f.name || "")) + '<br>';
  }
  return html;
}

// 共通フィールド (フォーム名 / formId / 件数 / 送信時刻) を key-value テーブルで表示する。
function renderCommonFields_(data) {
  var recordCount = (typeof data.recordCount === "number")
    ? data.recordCount
    : (Array.isArray(data.records) ? data.records.length : 0);
  return '<table class="kv"><tbody>' +
    '<tr><th>フォーム名</th><td>' + escapeHtml_(String(data.formName || "")) + '</td></tr>' +
    '<tr><th>formId</th><td><code>' + escapeHtml_(String(data.formId || "")) + '</code></td></tr>' +
    '<tr><th>recordCount</th><td>' + escapeHtml_(String(recordCount)) + '</td></tr>' +
    '<tr><th>送信時刻</th><td>' + escapeHtml_(String(data.generatedAt || "")) + '</td></tr>' +
    '</tbody></table>';
}

// 管理者限定ボタンのときだけ付与される storage 情報を表示する。
function renderStorageBlock_(data) {
  var st = data && data.storage;
  if (!st || typeof st !== "object") return "";
  var rows = "";
  var keys = ["spreadsheetId", "spreadsheetUrl", "sheetName", "driveFileUrl", "userEmail"];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (st[k] == null || st[k] === "") continue;
    var v = String(st[k]);
    var cell = /^https?:\/\//.test(v)
      ? '<a href="' + escapeHtml_(v) + '" target="_blank" rel="noopener">' + escapeHtml_(v) + '</a>'
      : escapeHtml_(v);
    rows += '<tr><th>' + escapeHtml_(k) + '</th><td>' + cell + '</td></tr>';
  }
  if (!rows) return "";
  return '<h2>storage (管理者限定)</h2><table class="kv"><tbody>' + rows + '</tbody></table>';
}

function repeat_(s, n) {
  var out = "";
  for (var i = 0; i < n; i++) out += s;
  return out;
}


// ----- HTML レンダラ (for_kouza/Code.gs と同じ体裁) ------------------------
function renderHtml_(title, bodyHtml, isError) {
  var bg = isError ? "#FEECEC" : "#E8F0FE";
  var border = isError ? "#D93025" : "#1A73E8";
  var html =
    '<!DOCTYPE html>' +
    '<html lang="ja"><head><meta charset="utf-8"><title>' + escapeHtml_(title) + '</title>' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans JP",sans-serif;background:#f8f9fa;margin:0;padding:24px;color:#202124;}' +
    '.card{max-width:960px;margin:0 auto;background:' + bg + ';border:2px solid ' + border + ';border-radius:8px;padding:20px 24px;}' +
    'h1{font-size:18px;margin:0 0 12px;color:' + border + ';}' +
    'h2{font-size:14px;margin:20px 0 6px;color:#3c4043;}' +
    'p{font-size:14px;line-height:1.6;margin:8px 0;}' +
    'p.lead{font-size:15px;}' +
    '.muted{color:#5f6368;}' +
    '.small{font-size:12px;color:#5f6368;margin-top:16px;}' +
    'code{font-family:Consolas,"Courier New",monospace;font-size:12px;background:rgba(0,0,0,.05);padding:1px 4px;border-radius:3px;}' +
    '.tag{display:inline-block;font-size:11px;background:#e0e0e0;color:#3c4043;border-radius:10px;padding:1px 8px;}' +
    '.tableWrap{overflow-x:auto;margin:8px 0;}' +
    'table{border-collapse:collapse;font-size:13px;background:#fff;}' +
    'table.kv{margin:8px 0;}' +
    'th,td{border:1px solid #dadce0;padding:6px 10px;text-align:left;vertical-align:top;}' +
    'thead th{background:#f1f3f4;position:sticky;top:0;}' +
    'table.kv th{background:#f1f3f4;white-space:nowrap;width:1%;}' +
    'a{color:#1a73e8;}' +
    '</style></head>' +
    '<body><div class="card">' +
    '<h1>' + escapeHtml_(title) + '</h1>' +
    bodyHtml +
    '<p class="small">このタブは閉じて差し支えありません。</p>' +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function escapeHtml_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
//   共通:
//     context     : "search" | "record"
//     formId      : string
//     formName    : string
//     generatedAt : ISO8601 文字列 (送信時刻 UTC)
//   context === "search" のとき:
//     list.headers : string[]   各列の質問 = ヘッダー階層を "|" で連結した文字列
//                    (例: "講座の種類|ヒグマ講座|実施場所")
//     list.rows    : (string | {text, hyperlink})[][]  フィルタ後の全データ行 (列順は headers と一致)
//     list.rowCount: number
//   context === "record" のとき:
//     record.id    : string
//     record.no    : string | number
//     record.items : { question, value, type }[]  question = ヘッダー階層を "|" 連結した質問
//   管理者限定ボタンのときのみ付与:
//     storage.spreadsheetId / spreadsheetUrl / sheetName / driveFileUrl / userEmail
//
// このファイルは「受け取って中身を確認する」ところまでを実装した雛形。
// 実際の業務処理 (シート転記・別 API 呼び出し等) は handleSearchPayload_ /
// handleRecordPayload_ の中に追記して使う。
//
// 動作確認はデプロイ不要。Test.gs の testDoPost_search / testDoPost_record /
// testDoPost_adminStorage を GAS エディタから実行し、実行ログ (Logger) を見る。
// =============================================================================

// ----- Web App エントリ ----------------------------------------------------
function doPost(e) {
  try {
    var payload = parsePayload_(e);
    if (!payload.ok) {
      return renderHtml_("エラー", escapeHtml_(payload.error), true);
    }

    var result = dispatchPayload_(payload.data);
    if (!result.ok) {
      return renderHtml_("エラー", "<p>" + escapeHtml_(result.error) + "</p>", true);
    }
    return renderHtml_(result.title || "受信完了", result.message, false);
  } catch (err) {
    return renderHtml_("予期せぬエラー", "<p>" + escapeHtml_(String(err && err.message ? err.message : err)) + "</p>", true);
  }
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


// ----- context によるディスパッチ ------------------------------------------
function dispatchPayload_(data) {
  var context = String(data.context || "");
  logCommonFields_(data);

  if (context === "search") {
    return handleSearchPayload_(data);
  }
  if (context === "record") {
    return handleRecordPayload_(data);
  }
  return { ok: false, error: "未知の context です: " + context };
}

function logCommonFields_(data) {
  Logger.log("context     = %s", data.context);
  Logger.log("formId      = %s", data.formId);
  Logger.log("formName    = %s", data.formName);
  Logger.log("generatedAt = %s", data.generatedAt);
  if (data.storage && typeof data.storage === "object") {
    Logger.log("storage (管理者限定) = %s", JSON.stringify(data.storage));
  }
}


// ----- context === "search": 一覧 (フィルタ後の全行) ------------------------
function handleSearchPayload_(data) {
  var list = (data && data.list) || {};
  var headers = Array.isArray(list.headers) ? list.headers : [];
  var rows = Array.isArray(list.rows) ? list.rows : [];
  var rowCount = (typeof list.rowCount === "number") ? list.rowCount : rows.length;

  Logger.log("=== search ===");
  Logger.log("列数 = %s / データ行数 = %s (rowCount=%s)", headers.length, rows.length, rowCount);
  if (headers.length) {
    Logger.log("ヘッダー (質問) = %s", JSON.stringify(headers));
  }
  if (rows.length) {
    Logger.log("先頭データ行 = %s", JSON.stringify(rows[0].map(cellToText_)));
  }

  // TODO: ここに業務処理を書く (例: 別シートへ転記、集計、通知 など)。
  //   headers[i] が i 列目の質問 (ヘッダー階層を "|" 連結)、rows[r][i] がその値。
  //   各セルは文字列、またはファイル列のとき { text, hyperlink } オブジェクト。
  //   cellToText_(cell) で表示文字列に正規化できる。

  // --- 受信内容をそのまま画面表示する (テスト用) -----------------------------
  var html = "";
  html += '<p class="lead">一覧データ <strong>' + rowCount + '</strong> 件を受信しました。</p>';
  html += renderCommonFields_(data);

  if (!headers.length && !rows.length) {
    html += '<p class="muted">表示できる行・列がありません。</p>';
  } else {
    html += '<div class="tableWrap"><table><thead><tr>';
    for (var h = 0; h < headers.length; h++) {
      html += '<th>' + escapeHtml_(headers[h]) + '</th>';
    }
    html += '</tr></thead><tbody>';
    for (var r = 0; r < rows.length; r++) {
      var row = Array.isArray(rows[r]) ? rows[r] : [];
      html += '<tr>';
      for (var c = 0; c < headers.length; c++) {
        html += '<td>' + cellToHtml_(row[c]) + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
  }
  html += renderStorageBlock_(data);

  return { ok: true, title: "一覧データ受信", message: html };
}


// ----- context === "record": 単一レコード ----------------------------------
function handleRecordPayload_(data) {
  var record = (data && data.record) || {};
  var items = Array.isArray(record.items) ? record.items : [];

  Logger.log("=== record ===");
  Logger.log("record.id = %s / record.no = %s / 項目数 = %s", record.id, record.no, items.length);
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    // question は "親|子|孫" 形式。"|" の数だけインデントするとネスト構造が読みやすい。
    var depth = String(it.question || "").split("|").length - 1;
    var indent = repeat_("  ", depth > 0 ? depth : 0);
    Logger.log("%s[%s] %s = %s", indent, it.type, it.question, it.value);
  }

  // TODO: ここに業務処理を書く (例: items を別 API に送る、Doc 生成 など)。

  // --- 受信内容をそのまま画面表示する (テスト用) -----------------------------
  var html = "";
  html += '<p class="lead">レコード <strong>No.' +
    escapeHtml_(String(record.no != null ? record.no : "")) +
    '</strong> の ' + items.length + ' 項目を受信しました。</p>';
  html += renderCommonFields_(data);
  html += '<table class="kv"><tbody>';
  html += '<tr><th>record.id</th><td><code>' + escapeHtml_(String(record.id || "")) + '</code></td></tr>';
  html += '<tr><th>record.no</th><td>' + escapeHtml_(String(record.no != null ? record.no : "")) + '</td></tr>';
  html += '</tbody></table>';

  if (!items.length) {
    html += '<p class="muted">項目がありません。</p>';
  } else {
    html += '<div class="tableWrap"><table><thead><tr>' +
      '<th>質問 (ネスト)</th><th>type</th><th>値</th></tr></thead><tbody>';
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      // question は "親|子|孫" 形式。"|" の数だけインデントしてネスト構造を表現する。
      var parts = String(it.question || "").split("|");
      var depth = parts.length - 1;
      var leaf = parts[parts.length - 1];
      var pad = depth > 0 ? ' style="padding-left:' + (depth * 18) + 'px"' : '';
      html += '<tr>';
      html += '<td' + pad + '>' + (depth > 0 ? '<span class="muted">↳ </span>' : '') + escapeHtml_(leaf) + '</td>';
      html += '<td><span class="tag">' + escapeHtml_(String(it.type || "")) + '</span></td>';
      html += '<td>' + escapeHtml_(String(it.value == null ? "" : it.value)) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';
  }
  html += renderStorageBlock_(data);

  return { ok: true, title: "レコード受信", message: html };
}


// ----- ヘルパ --------------------------------------------------------------
// 一覧セルは文字列 or { text, hyperlink }。表示文字列に正規化する。
function cellToText_(cell) {
  if (cell && typeof cell === "object") {
    return String(cell.text == null ? "" : cell.text);
  }
  return String(cell == null ? "" : cell);
}

// 一覧セルを表示用 HTML に変換する。hyperlink があればリンクにする。
function cellToHtml_(cell) {
  if (cell && typeof cell === "object" && cell.hyperlink) {
    return '<a href="' + escapeHtml_(String(cell.hyperlink)) + '" target="_blank" rel="noopener">' +
      escapeHtml_(String(cell.text == null ? cell.hyperlink : cell.text)) + '</a>';
  }
  return escapeHtml_(cellToText_(cell));
}

// 共通フィールド (フォーム名 / formId / 送信時刻) を key-value テーブルで表示する。
function renderCommonFields_(data) {
  return '<table class="kv"><tbody>' +
    '<tr><th>フォーム名</th><td>' + escapeHtml_(String(data.formName || "")) + '</td></tr>' +
    '<tr><th>formId</th><td><code>' + escapeHtml_(String(data.formId || "")) + '</code></td></tr>' +
    '<tr><th>context</th><td>' + escapeHtml_(String(data.context || "")) + '</td></tr>' +
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

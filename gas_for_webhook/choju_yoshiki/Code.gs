// =============================================================================
// 鳥獣保護管理法様式 生成 Web App (Nested Form Builder 連携)
//
// フォーム「鳥獣保護管理法許可申請」のレコード詳細にある webhook ボタンから
// 隠しフォーム POST（e.parameter.payload = JSON 文字列）を受け取り、
// Google スプレッドシート化した様式テンプレートを複製して全シートに値を書き込み、
// 生成したスプレッドシートへのリンクを返す。
//
// ■ 初期セットアップ（一度だけ）
//   1. form_data/鳥獣保護管理法様式.xlsx を Drive にアップロードし、
//      「ファイル > Google スプレッドシートとして保存」で変換（書式・結合を目視確認）
//   2. 出力先フォルダを Drive に作成
//   3. GAS エディタで setup.gs の Cho_registerSettings(テンプレID, フォルダID, アクセスキー) を実行
//   4. Cho_setupCleanTemplate() を実行（Sheet1・申請内容シートの削除と全数式の消去。冪等）
//   5. ウェブアプリとしてデプロイ（アクセス: 全員(匿名含む) / 実行ユーザー: 自分）
//      ※ 隠しフォーム POST はログインリダイレクトで本文が失われるため「全員(匿名含む)」必須
//   6. 本体アプリ側の設定:
//      - フォームの formLink「従事者情報」の includeChildData を ON
//      - webhook 質問カードを追加し URL に「デプロイ URL + ?k=<アクセスキー>」を設定
//
// ■ テスト（デプロイ不要）
//   Test.gs の testAll を GAS エディタから実行し、実行ログを確認する。
// =============================================================================

function doPost(e) {
  try {
    var payload = parsePayload_(e);
    if (!payload.ok) {
      return renderHtml_("エラー", "<p>" + escapeHtml_(payload.error) + "</p>", true);
    }
    var keyError = Cho_checkAccessKey_(e);
    if (keyError) {
      return renderHtml_("エラー", "<p>" + escapeHtml_(keyError) + "</p>", true);
    }
    var data = payload.data;
    if (String(data.context || "") !== "record") {
      return renderHtml_("エラー",
        "<p>このウェブアプリはレコード単位の webhook（context=record）専用です。受信 context: " +
        escapeHtml_(String(data.context || "(なし)")) + "</p>", true);
    }
    return Cho_handleRecord_(data);
  } catch (err) {
    return renderHtml_("予期せぬエラー",
      "<p>" + escapeHtml_(String(err && err.message ? err.message : err)) + "</p>", true);
  }
}

// GET はセットアップ状態の確認用。
function doGet() {
  var props = PropertiesService.getScriptProperties();
  var ready = props.getProperty(CHO_PROP_TEMPLATE_) && props.getProperty(CHO_PROP_FOLDER_);
  return renderHtml_(
    "鳥獣保護管理法様式 生成 Web App",
    "<p>この URL は Nested Form Builder の webhook ボタンから POST 送信を受け取り、" +
    "鳥獣保護管理法の様式（スプレッドシート）を生成します。</p>" +
    "<p>セットアップ状態: " + (ready ? "テンプレート設定済み" : "<strong>未設定</strong>（Cho_registerSettings を実行してください）") + "</p>",
    false
  );
}

// Script Property CHO_ACCESS_KEY が設定されているときだけ ?k= を照合する軽量ゲート。
function Cho_checkAccessKey_(e) {
  var expected = PropertiesService.getScriptProperties().getProperty(CHO_PROP_KEY_);
  if (!expected) return "";
  var actual = e && e.parameter ? String(e.parameter.k || "") : "";
  return actual === expected ? "" : "アクセスキーが一致しません。webhook URL の ?k= パラメータを確認してください。";
}

// レコード payload → 様式生成 → リンク応答。
function Cho_handleRecord_(data) {
  var record = (data && data.record) || {};
  var model = Cho_buildModel_(data);
  var file = Cho_createOutputCopy_(record.no);
  var ss = SpreadsheetApp.openById(file.getId());
  try {
    Cho_fillAll_(ss, model);
    SpreadsheetApp.flush();
  } catch (err) {
    // 部分生成ファイルは消さずにリンクを出す（原因調査をしやすくする）
    return renderHtml_("エラー",
      "<p>書き込み中にエラーが発生しました: " + escapeHtml_(String(err && err.message ? err.message : err)) + "</p>" +
      "<p>部分的に生成されたファイル: <a href=\"" + escapeHtml_(ss.getUrl()) + "\" target=\"_blank\" rel=\"noopener\">" +
      escapeHtml_(file.getName()) + "</a></p>", true);
  }

  var html = "";
  html += '<p class="lead">レコード <strong>No.' + escapeHtml_(String(record.no != null ? record.no : "")) +
    "</strong>（" + escapeHtml_(String(data.formName || "")) + "）から様式を作成しました。</p>";
  html += '<p><a href="' + escapeHtml_(ss.getUrl()) + '" target="_blank" rel="noopener">' +
    escapeHtml_(file.getName()) + "</a></p>";
  html += '<table class="kv"><tbody>';
  html += "<tr><th>申請者</th><td>" + escapeHtml_(String(model.applicantNameComposed || "")) + "</td></tr>";
  html += "<tr><th>個人・法人</th><td>" + escapeHtml_(String(model.applicantType || "")) + "</td></tr>";
  html += "<tr><th>従事者数</th><td>" + escapeHtml_(String(model.workerCount)) + " 名（名簿 " +
    escapeHtml_(String((model.rosterEntries || []).length)) + " ブロック）</td></tr>";
  html += "</tbody></table>";
  if (model.warnings && model.warnings.length > 0) {
    html += '<div class="warn"><strong>警告</strong><ul>';
    for (var i = 0; i < model.warnings.length; i++) {
      html += "<li>" + escapeHtml_(model.warnings[i]) + "</li>";
    }
    html += "</ul></div>";
  }
  return renderHtml_("様式を作成しました", html, false);
}


// ----- payload 取り出し（gas_for_webhook/template/Code.gs と同じ）---------------
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


// ----- HTML レンダラ（template/Code.gs の体裁 + 警告ブロック）-------------------
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
    'p{font-size:14px;line-height:1.6;margin:8px 0;}' +
    'p.lead{font-size:15px;}' +
    '.small{font-size:12px;color:#5f6368;margin-top:16px;}' +
    '.warn{background:#FEF7E0;border:1px solid #F9AB00;border-radius:6px;padding:8px 12px;margin:12px 0;font-size:13px;}' +
    '.warn ul{margin:6px 0 0;padding-left:20px;}' +
    'table{border-collapse:collapse;font-size:13px;background:#fff;}' +
    'table.kv{margin:8px 0;}' +
    'th,td{border:1px solid #dadce0;padding:6px 10px;text-align:left;vertical-align:top;}' +
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

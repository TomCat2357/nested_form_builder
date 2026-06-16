// #############################################################################
// ## Code.gs
// #############################################################################

// =============================================================================
// 鳥獣保護管理法様式 生成 Web App (Nested Form Builder 連携)
//
// フォーム「鳥獣保護管理法許可申請」のレコード詳細にある 外部アクション ボタンから
// 隠しフォーム POST（e.parameter.payload = JSON 文字列）を受け取り、
// Google スプレッドシート化した様式テンプレートを複製して全シートに値を書き込み、
// 生成したスプレッドシートへのリンクを返す。
//
// ■ 初期セットアップ（一度だけ）
//   1. form_data/鳥獣保護管理法様式_1_20260611_120316.xlsx（修正済みテンプレ）を Drive に
//      アップロードし、「ファイル > Google スプレッドシートとして保存」で変換（書式・結合を目視確認）
//   2. 出力先フォルダを Drive に作成
//   3. GAS エディタで setup.gs の Cho_registerSettings(テンプレID, フォルダID, アクセスキー) を実行
//   4. Cho_setupCleanTemplate() を実行（Sheet1・申請内容シートの削除と全数式の消去。冪等）
//   5. ウェブアプリとしてデプロイ（アクセス: 全員(匿名含む) / 実行ユーザー: 自分）
//      ※ 隠しフォーム POST はログインリダイレクトで本文が失われるため「全員(匿名含む)」必須
//   6. 本体アプリ側の設定:
//      - フォームに formLink「従事者情報」があること（子データは自動で payload に載る。設定不要）
//      - 外部アクション 質問カードを追加し URL に「デプロイ URL + ?k=<アクセスキー>」を設定
//
// ■ テスト（デプロイ不要）
//   Test.gs の testAll を GAS エディタから実行し、実行ログを確認する。
// =============================================================================

// 本体アプリは UrlFetchApp サーバ間リレーで ?nfbRelay=1 を付けて POST してくる。
// その場合は HTML ではなく JSON ({ ok, title, message, openUrl }) で応答する。
// nfbRelay なしの直接 POST は従来どおり HTML を返す。
function doPost(e) {
  var relay = e && e.parameter && String(e.parameter.nfbRelay) === "1";
  try {
    var payload = parsePayload_(e);
    if (!payload.ok) {
      return Cho_render_(relay, { ok: false, title: "エラー", message: payload.error, html: "<p>" + escapeHtml_(payload.error) + "</p>" });
    }
    var keyError = Cho_checkAccessKey_(e);
    if (keyError) {
      return Cho_render_(relay, { ok: false, title: "エラー", message: keyError, html: "<p>" + escapeHtml_(keyError) + "</p>" });
    }
    var data = payload.data;
    if (String(data.context || "") !== "record") {
      var ctxMsg = "このウェブアプリはレコード単位の 外部アクション（context=record）専用です。受信 context: " + String(data.context || "(なし)");
      return Cho_render_(relay, { ok: false, title: "エラー", message: ctxMsg, html: "<p>" + escapeHtml_(ctxMsg) + "</p>" });
    }
    return Cho_render_(relay, Cho_handleRecord_(data));
  } catch (err) {
    var em = String(err && err.message ? err.message : err);
    return Cho_render_(relay, { ok: false, title: "予期せぬエラー", message: em, html: "<p>" + escapeHtml_(em) + "</p>" });
  }
}

// 結果記述子を relay 有無に応じて JSON / HTML で出力する。
function Cho_render_(relay, result) {
  var r = result || {};
  if (relay) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: r.ok !== false,
      title: r.title || "",
      message: r.message || "",
      openUrl: r.openUrl || "",
    })).setMimeType(ContentService.MimeType.JSON);
  }
  return renderHtml_(r.title || (r.ok === false ? "エラー" : "受信完了"), r.html || "", r.ok === false);
}

// GET はセットアップ状態の確認用。
function doGet() {
  var props = PropertiesService.getScriptProperties();
  var ready = props.getProperty(CHO_PROP_TEMPLATE_) && props.getProperty(CHO_PROP_FOLDER_);
  return renderHtml_(
    "鳥獣保護管理法様式 生成 Web App",
    "<p>この URL は Nested Form Builder の 外部アクション ボタンから POST 送信を受け取り、" +
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
  return actual === expected ? "" : "アクセスキーが一致しません。外部アクション URL の ?k= パラメータを確認してください。";
}

// レコード payload → 様式生成 → 結果記述子 { ok, title, message, html, openUrl } を返す。
// HTML / JSON 出力の振り分けは呼び出し側（Cho_render_）が行う。
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
    var em = String(err && err.message ? err.message : err);
    return {
      ok: false,
      title: "エラー",
      message: "書き込み中にエラーが発生しました: " + em,
      openUrl: ss.getUrl(),
      html: "<p>書き込み中にエラーが発生しました: " + escapeHtml_(em) + "</p>" +
        "<p>部分的に生成されたファイル: <a href=\"" + escapeHtml_(ss.getUrl()) + "\" target=\"_blank\" rel=\"noopener\">" +
        escapeHtml_(file.getName()) + "</a></p>",
    };
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
  var warnText = "";
  if (model.warnings && model.warnings.length > 0) {
    html += '<div class="warn"><strong>警告</strong><ul>';
    for (var i = 0; i < model.warnings.length; i++) {
      html += "<li>" + escapeHtml_(model.warnings[i]) + "</li>";
    }
    html += "</ul></div>";
    warnText = "（警告 " + model.warnings.length + " 件あり）";
  }
  return {
    ok: true,
    title: "様式を作成しました",
    message: "様式を作成しました: " + file.getName() + warnText,
    openUrl: ss.getUrl(),
    html: html,
  };
}


// ----- payload 取り出し（gas_for_external_action/template/Code.gs と同じ）---------------
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


// #############################################################################
// ## payload.gs
// #############################################################################

// =============================================================================
// payload.gs — record.items の索引化・パス分解・子レコード（従事者情報）のグルーピング
//
// record.items[].question は「ヘッダー階層を "/" で連結した文字列」。
//   - 通常項目:      "申請者情報/申請者の個人・法人の別/個人/氏名"
//   - 子レコード行:  "従事者情報/#<レコードNo>/<子フォーム内パス>"
// セグメント内の "/" と "\" はバックスラッシュでエスケープされる
// （builder/src/utils/pathCodec.js の joinFieldPath / splitFieldKey と同じ規則）。
// =============================================================================

// エスケープ付き "/" 連結文字列 → セグメント配列（pathCodec.js splitFieldKey の移植）。
function Cho_splitPath_(text) {
  var str = String(text == null ? "" : text);
  var tokens = [];
  var current = "";
  var escaping = false;
  for (var i = 0; i < str.length; i++) {
    var ch = str.charAt(i);
    if (escaping) { current += ch; escaping = false; continue; }
    if (ch === "\\") { escaping = true; continue; }
    if (ch === "/") { tokens.push(current); current = ""; continue; }
    current += ch;
  }
  if (escaping) current += "\\";
  tokens.push(current);
  return tokens;
}

// items 配列 → 簡易索引。get(path) は完全一致した question の値（無ければ ""）。
function Cho_indexItems_(items) {
  var map = {};
  var list = [];
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i] || {};
    var q = String(it.question == null ? "" : it.question);
    if (!(q in map)) map[q] = it.value;
    list.push(it);
  }
  return {
    list: list,
    get: function (path) {
      var v = map[path];
      return v == null ? "" : String(v);
    },
    has: function (path) { return path in map; }
  };
}

// 親レコードの items を「親項目」と「従事者情報の子レコード行」に分ける。
// 戻り値: { parentItems: [...], children: [{ marker, items }] }（children は出現順）。
function Cho_splitParentAndChildren_(items) {
  var parentItems = [];
  var childMap = {};
  var childOrder = [];
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i] || {};
    var segs = Cho_splitPath_(it.question);
    if (segs.length >= 3 && segs[0] === CHO_L_FORMLINK_ && segs[1].charAt(0) === "#") {
      var marker = segs[1];
      if (!childMap[marker]) { childMap[marker] = []; childOrder.push(marker); }
      // 子フォーム内パスに剥がして積む（マーカーより後ろを "/" 連結し直す）
      childMap[marker].push({
        question: segs.slice(2).join("/"),
        value: it.value,
        type: it.type
      });
    } else {
      parentItems.push(it);
    }
  }
  var children = [];
  for (var c = 0; c < childOrder.length; c++) {
    children.push({ marker: childOrder[c], items: childMap[childOrder[c]] });
  }
  return { parentItems: parentItems, children: children };
}

// チェックボックス値（", " 連結）→ ラベル配列。空要素は捨てる。
function Cho_splitChecks_(value) {
  var s = String(value == null ? "" : value);
  if (!s) return [];
  var parts = s.split(", ");
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].replace(/^\s+|\s+$/g, "");
    if (p) out.push(p);
  }
  return out;
}

// "YYYY-MM-DD" / "YYYY/MM/DD" → Date。パースできなければ元の文字列を返す（空は ""）。
function Cho_toDateOrText_(value) {
  var s = String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
  if (!s) return "";
  var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (!m) return s;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// 数値文字列 → Number。数値にならなければ元の文字列（空は ""）。
function Cho_toNumberOrText_(value) {
  var s = String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
  if (!s) return "";
  var n = Number(s);
  return isNaN(n) ? s : n;
}

// Date → 和暦表示（"令和N年M月D日"）。Date 以外は素通し。
// Utilities.formatDate の era 書式は GAS の英語ロケールで和暦にならないため手計算する。
function Cho_formatWareki_(value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) {
    return String(value == null ? "" : value);
  }
  var y = Number(Utilities.formatDate(value, "Asia/Tokyo", "yyyy"));
  var mo = Number(Utilities.formatDate(value, "Asia/Tokyo", "M"));
  var d = Number(Utilities.formatDate(value, "Asia/Tokyo", "d"));
  var era;
  var eraYear;
  if (y >= 2019) { era = "令和"; eraYear = y - 2018; }
  else if (y >= 1989) { era = "平成"; eraYear = y - 1988; }
  else { era = "昭和"; eraYear = y - 1925; }
  var nen = eraYear === 1 ? "元" : String(eraYear);
  return era + nen + "年" + mo + "月" + d + "日";
}


// #############################################################################
// ## domain.gs
// #############################################################################

// =============================================================================
// domain.gs — payload からドメインモデル（mapping.gs の get キー全部入り）を組み立てる
//
// Cho_buildModel_(payload) が返すモデルのうち、シート静的マップが参照するキーは
// すべてフラットな文字列/数値/Date。加えて:
//   speciesList   : [{ name, count, unit, eggCount }]      … 種数テーブル用
//   rosterEntries : [{ certNo, includePersonal, worker, method }] … 名簿ブロック用
//   warnings      : string[]                                … 応答ページに表示
// =============================================================================

function Cho_buildModel_(payload) {
  var record = (payload && payload.record) || {};
  var split = Cho_splitParentAndChildren_(record.items || []);
  var idx = Cho_indexItems_(split.parentItems);
  var warnings = [];

  // ----- 従事者（子レコード） -----
  var workers = [];
  for (var i = 0; i < split.children.length; i++) {
    workers.push(Cho_parseWorker_(Cho_indexItems_(split.children[i].items)));
  }
  if (workers.length === 0) {
    warnings.push("従事者情報の子レコードが届いていません。種数・方法・申請者情報は従事者から導出するため、ほぼ全欄が空になります。従事者を登録してから再実行してください。");
  }
  var repWorker = null;
  for (var r = 0; r < workers.length; r++) {
    if (workers[r].isRep) { repWorker = workers[r]; break; }
  }
  if (!repWorker && workers.length > 0) repWorker = workers[0];
  var workerCount = workers.length;

  // ----- 申請者 -----
  var applicantType = idx.get(CHO_L_APPLICANT_ + "/" + CHO_L_APPLICANT_TYPE_); // 個人 / 法人
  var pBase = CHO_L_APPLICANT_ + "/" + CHO_L_APPLICANT_TYPE_ + "/個人/";
  var cBase = CHO_L_APPLICANT_ + "/" + CHO_L_APPLICANT_TYPE_ + "/法人/";
  var corporateName = idx.get(cBase + "法人名及び代表者名");
  var applicantName;
  var applicantAddress;
  var applicantOccupation = "";
  var applicantBirthDate = "";
  if (applicantType === "法人") {
    applicantName = corporateName;
    applicantAddress = idx.get(cBase + "申請者住所");
  } else {
    // 代表従事者（代表的個人=はい）を正とし、空のときだけ親の置換 item から補完する。
    // 親の substitution は全レコード横断で従事者を拾う不具合があったため信用しない。
    applicantName = (repWorker ? repWorker.name : "") || idx.get(pBase + "氏名");
    applicantAddress = (repWorker ? repWorker.address : "") || idx.get(pBase + "住所");
    applicantOccupation = (repWorker ? repWorker.occupation : "") || idx.get(pBase + "職業");
    applicantBirthDate = (repWorker ? repWorker.birth : "") || Cho_toDateOrText_(idx.get(pBase + "生年月日"));
  }
  var othersSuffix = workerCount > 1 ? "(ほか" + (workerCount - 1) + "名)" : "";
  var applicantNameComposed = applicantType === "法人" ? corporateName : (applicantName + othersSuffix);

  // ----- 種数（従事者ごとの数量を種名単位で合算。親フォームに入力欄は無い） -----
  var speciesList = Cho_aggregateSpecies_(workers);
  var speciesNamesJoined = [];
  for (var sn = 0; sn < speciesList.length; sn++) speciesNamesJoined.push(speciesList[sn].name);
  speciesNamesJoined = speciesNamesJoined.join(" ");

  // ----- 目的・期間・区域 -----
  var purpose = idx.get(CHO_L_PURPOSE_);
  var periodStart = Cho_toDateOrText_(idx.get(CHO_L_PERIOD_ + "/開始"));
  var periodEnd = Cho_toDateOrText_(idx.get(CHO_L_PERIOD_ + "/終了"));
  var periodDaysText = "";
  if (periodStart instanceof Date && periodEnd instanceof Date) {
    periodDaysText = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000 + 1) + "日間";
  }
  var areaLocation = idx.get(CHO_L_AREA_ + "/所在地");
  var area7Path = CHO_L_AREA_ + "/" + CHO_L_AREA7_;
  var area7Selected = Cho_splitChecks_(idx.get(area7Path));
  var area7Flag = area7Selected.length > 0 ? "該当あり" : "該当なし";
  var area7Parts = [];
  for (var a = 0; a < area7Selected.length; a++) {
    var opt = area7Selected[a];
    var detailName = idx.get(area7Path + "/" + opt + "/具体的名称");
    area7Parts.push(detailName ? opt + "（" + detailName + "）" : opt);
  }
  var area7Detail = area7Parts.join("、");

  // ----- 方法（全従事者の捕獲用具の和集合。親フォームに入力欄は無い）・処置 -----
  var methods = Cho_unionTools_(workers);
  var hasTrapMethod = methods.indexOf("はこわな") !== -1 || methods.indexOf("くくりわな") !== -1;
  var disposalsRaw = Cho_splitChecks_(idx.get(CHO_L_DISPOSAL_));
  var disposals = [];
  for (var di = 0; di < disposalsRaw.length; di++) {
    var dv = CHO_DISPOSAL_MAP_[disposalsRaw[di]] || disposalsRaw[di];
    if (disposals.indexOf(dv) === -1) disposals.push(dv); // 廃棄+埋設 → 埋設・廃棄 の重複排除
  }

  // ----- 証明書 / 依頼書 -----
  var certOrRequest = idx.get(CHO_L_CERT_OR_REQ_); // 証明書 / 依頼書
  var certBase = CHO_L_CERT_OR_REQ_ + "/証明書/";
  var reqBase = CHO_L_CERT_OR_REQ_ + "/依頼書/";
  var requesterName = idx.get(reqBase + "依頼者氏名");
  var requestPeriodStart = Cho_toDateOrText_(idx.get(reqBase + CHO_L_PERIOD_ + "/開始"));
  var requestPeriodEnd = Cho_toDateOrText_(idx.get(reqBase + CHO_L_PERIOD_ + "/終了"));
  if (requestPeriodStart === "") requestPeriodStart = periodStart;
  if (requestPeriodEnd === "") requestPeriodEnd = periodEnd;

  // ----- 許可処分情報 -----
  var permitNo = idx.get(CHO_L_PERMIT_GROUP_ + "/許可番号");
  var permitDate = Cho_toDateOrText_(idx.get(CHO_L_PERMIT_GROUP_ + "/許可年月日"));
  var permitConditions = idx.get(CHO_L_PERMIT_GROUP_ + "/処分の種類/条件付き許可/許可条件");
  var permitNoFull = permitNo ? "第" + permitNo + "号" : "";
  var permitDocNo = permitNo ? "札環対許可第" + permitNo + "号" : "";
  var workerCertNo1 = permitNo ? "第" + permitNo + "-1号" : "";
  var permitNoTail = permitNo ? permitNo + "号" : "";
  var certHeaderNo = applicantType === "法人" ? permitNoFull : workerCertNo1; // 許可証 C3

  // ----- 合成テキスト -----
  var applicationDate = Cho_toDateOrText_(String(payload.generatedAt || "").slice(0, 10));
  var notifyBodyText = Cho_formatWareki_(applicationDate) +
    "付けで申請のあった鳥獣の捕獲等又は鳥類の卵の採取等（及び従事者証の交付）について、" +
    "次のとおり許可し、別添許可証（及び従事者証）を交付します。";
  var returnReportText = "";
  if (permitDate !== "" && permitDocNo) {
    returnReportText = Cho_formatWareki_(permitDate) + "付け" + permitDocNo +
      "で許可された鳥獣の捕獲等又は鳥類の卵の採取等に係る許可証（及び従事者証）を別添のとおり返納するとともに、" +
      "捕獲等又は採取等の結果を次のとおり報告します。";
  }
  var certNoRangeText = "";
  if (permitNo && workerCount > 1) {
    var rangePrefix = applicantType === "法人" ? "従事者証番号" : "許可証番号";
    certNoRangeText = "(" + rangePrefix + "　第" + permitNo + "-1号～第" + permitNo + "-" + workerCount + "号)";
  }
  var certNoRangePersonal = applicantType === "個人" ? certNoRangeText : "";
  var certNoRangeCorp = "";
  if (applicantType === "法人" && permitNo) {
    certNoRangeCorp = workerCount > 1
      ? "(従事者証番号　第" + permitNo + "-1号～第" + permitNo + "-" + workerCount + "号)"
      : "(従事者証番号　第" + permitNo + "-1号)";
  }
  var reviewClassText = certOrRequest === "依頼書"
    ? CHO_REVIEW_CLASS_PROXY_
    : (applicantType === "法人" ? CHO_REVIEW_CLASS_CORP_ : CHO_REVIEW_CLASS_VICTIM_);

  // 別添従事者名簿のとおり（該当する従事者がいるときのみ）
  var hasAnyLicense = false;
  var hasAnyRegistration = false;
  var hasAnyGunPermit = false;
  for (var w = 0; w < workers.length; w++) {
    for (var wm = 0; wm < workers[w].methods.length; wm++) {
      var meth = workers[w].methods[wm];
      if (meth.lic) hasAnyLicense = true;
      if (meth.reg) hasAnyRegistration = true;
      if (meth.poss) hasAnyGunPermit = true;
    }
  }

  // ----- 名簿エントリ展開（従事者 × 捕獲方法） -----
  var rosterEntries = Cho_expandRosterEntries_(workers, permitNo);

  var model = {
    warnings: warnings,
    workers: workers,
    rosterEntries: rosterEntries,
    speciesList: speciesList,

    applicationDate: applicationDate,
    applicantType: applicantType,
    certOrRequest: certOrRequest,
    applicantAddress: applicantAddress,
    applicantName: applicantName,
    applicantNameComposed: applicantNameComposed,
    applicantNameSama: applicantName ? applicantName + "　様" : "",
    applicantOccupation: applicantType === "法人" ? "" : applicantOccupation,
    applicantBirthDate: applicantType === "法人" ? "" : applicantBirthDate,
    corporateName: corporateName,
    workerCount: workerCount,
    othersSuffix: othersSuffix,
    othersSuffixCorp: applicantType === "法人" ? othersSuffix : "",

    repWorkerName: repWorker ? repWorker.name : "",
    repWorkerNameCorp: applicantType === "法人" && repWorker ? repWorker.name : "",
    repWorkerNameWithOthers: repWorker ? repWorker.name + othersSuffix : "",
    repWorkerAddress: repWorker ? repWorker.address : "",
    repWorkerOccupation: repWorker ? repWorker.occupation : "",
    repWorkerBirthDate: repWorker ? repWorker.birth : "",

    speciesCount: speciesList.length > 0 ? speciesList.length : "",
    speciesNamesJoined: speciesNamesJoined,
    speciesDamageText: speciesNamesJoined ? speciesNamesJoined + "による被害等" : "",

    purpose: purpose,
    periodStart: periodStart,
    periodEnd: periodEnd,
    periodDaysText: periodDaysText,
    areaLocation: areaLocation,
    area7Flag: area7Flag,
    area7Detail: area7Detail,
    area7CheckText: area7Selected.length > 0 ? CHO_AREA7_CHECKED_ : CHO_AREA7_UNCHECKED_,

    method1: methods[0] || "",
    method2: methods[1] || "",
    method3: methods[2] || "",
    method3Rest: methods.slice(2).join("、"),
    method4Rest: methods.slice(3).join("、"),
    disposal1: disposals[0] || "",
    disposal2: disposals[1] || "",
    disposal3: disposals[2] || "",
    disposal3Rest: disposals.slice(2).join("、"),
    disposal4: disposals[3] || "",
    hasTrapMethod: hasTrapMethod,
    trapNoticeText: hasTrapMethod ? CHO_TRAP_NOTICE_ : "",

    licenseNote: hasAnyLicense ? CHO_NOTE_SEE_ROSTER_ : "",
    registrationNote: hasAnyRegistration ? CHO_NOTE_SEE_ROSTER_ : "",
    gunPermitNote: hasAnyGunPermit ? CHO_NOTE_SEE_ROSTER_ : "",

    certDamageTime: idx.get(certBase + "被害発生の時期"),
    certDamageArea: idx.get(certBase + "被害発生区域（場所）"),
    certDamageContent: idx.get(certBase + "被害の内容"),
    certCountermeasure: idx.get(certBase + "被害防除対策の実施内容及び実施効果"),
    certPastResults: idx.get(certBase + "過去数年間の捕獲実績"),

    requesterAddress: idx.get(reqBase + "依頼者住所"),
    requesterName: requesterName,
    requesterNameLabel: requesterName ? "依頼者氏名：" : "",
    damageStatus: idx.get(reqBase + "被害状況"),
    requestReason: idx.get(reqBase + "依頼した理由"),
    requestPeriodStart: requestPeriodStart,
    requestPeriodEnd: requestPeriodEnd,

    permitNo: permitNo,
    permitNoFull: permitNoFull,
    permitNoTail: permitNoTail,
    permitDocNo: permitDocNo,
    certHeaderNo: certHeaderNo,
    permitDate: permitDate,
    permitConditions: permitConditions,
    workerCertNo1: workerCertNo1,
    certNoRangeText: certNoRangeText,
    certNoRangePersonal: certNoRangePersonal,
    certNoRangeCorp: certNoRangeCorp,
    notifyBodyText: notifyBodyText,
    returnReportText: returnReportText,
    reviewClassText: reviewClassText,

    remarks: idx.get(CHO_L_REMARKS_)
  };
  return model;
}

// ----- 従事者 1 名のモデル化 -----
// idx は子フォーム内パスで索引化済みの items 索引。
function Cho_parseWorker_(idx) {
  var M = CHO_L_CHILD_METHOD_;
  var worker = {
    name: idx.get("氏名"),
    address: idx.get("住所"),
    occupation: idx.get("職業"),
    birth: Cho_toDateOrText_(idx.get("生年月日")),
    isRep: idx.get(CHO_L_REP_) === "はい",
    species: [],
    methods: []
  };

  // 従事者ごとの種数（子フォームは鳥類でも「捕獲頭数」ラベル）
  var spNames = Cho_splitChecks_(idx.get(CHO_L_CHILD_SPECIES_));
  for (var s = 0; s < spNames.length; s++) {
    var sp = spNames[s];
    var base = CHO_L_CHILD_SPECIES_ + "/" + sp + "/";
    var name = CHO_SPECIES_NAME_MAP_[sp] || sp;
    worker.species.push({
      name: name,
      count: Cho_toNumberOrText_(idx.get(base + "捕獲頭数")),
      unit: CHO_SPECIES_UNIT_[sp] || CHO_SPECIES_UNIT_[name] || "頭",
      eggCount: Cho_toNumberOrText_(idx.get(base + "採取卵数"))
    });
  }

  // 狩猟者登録（各方法分岐の配下に同型で存在）
  function parseReg(branchBase, licType) {
    if (idx.get(branchBase + "/狩猟者登録/登録の有無") !== "あり") return null;
    return {
      type: licType,
      no: idx.get(branchBase + "/狩猟者登録/登録の有無/あり/番号"),
      date: Cho_toDateOrText_(idx.get(branchBase + "/狩猟者登録/登録の有無/あり/交付年月日"))
    };
  }

  var selected = Cho_splitChecks_(idx.get(M));
  for (var i = 0; i < selected.length; i++) {
    var kind = selected[i];
    var b = M + "/" + kind;
    if (kind === "手捕り") {
      worker.methods.push({ kind: kind, tools: ["手捕り"], lic: null, reg: null, poss: null, gunKind: "" });
    } else if (kind === "わな猟") {
      var trapTools = Cho_splitChecks_(idx.get(b + "/わなの種類"));
      var tools = [];
      for (var t = 0; t < trapTools.length; t++) tools.push(CHO_TOOL_NAME_[trapTools[t]] || trapTools[t]);
      var lic = null;
      if (idx.get(b + "/免許の必要性") === "必要") {
        var lb = b + "/免許の必要性/必要/免許情報";
        lic = {
          type: CHO_LICENSE_TYPE_[kind],
          authority: idx.get(lb + "/許可権者"),
          no: idx.get(lb + "/許可番号"),
          date: Cho_toDateOrText_(idx.get(lb + "/交付年月日"))
        };
      }
      worker.methods.push({
        kind: kind, tools: tools.length ? tools : ["わな"],
        lic: lic, reg: parseReg(b, CHO_LICENSE_TYPE_[kind]), poss: null, gunKind: ""
      });
    } else if (kind === "網猟") {
      worker.methods.push({
        kind: kind, tools: [CHO_TOOL_NAME_["網猟"]],
        lic: {
          type: CHO_LICENSE_TYPE_[kind],
          authority: idx.get(b + "/免許情報/許可権者"),
          no: idx.get(b + "/免許情報/許可番号"),
          date: Cho_toDateOrText_(idx.get(b + "/免許情報/交付年月日"))
        },
        reg: parseReg(b, CHO_LICENSE_TYPE_[kind]), poss: null, gunKind: ""
      });
    } else if (kind === "空気銃") {
      worker.methods.push({
        kind: kind, tools: [CHO_TOOL_NAME_["空気銃"]],
        lic: {
          type: CHO_LICENSE_TYPE_[kind],
          authority: idx.get(b + "/第二種銃猟免許/許可権者"),
          no: idx.get(b + "/第二種銃猟免許/許可番号"),
          date: Cho_toDateOrText_(idx.get(b + "/第二種銃猟免許/交付年月日"))
        },
        reg: parseReg(b, CHO_LICENSE_TYPE_[kind]),
        poss: {
          no: idx.get(b + "/所持許可/所持許可証番号"),
          date: Cho_toDateOrText_(idx.get(b + "/所持許可/交付年月日"))
        },
        gunKind: "空気銃"
      });
    } else if (kind === "散弾銃・ライフル銃") {
      // 銃 1 丁 = 1 エントリ（所持許可は銃ごとに別番号・別交付年月日のため）。
      // 第一種銃猟免許・狩猟者登録は同値を各エントリへ持たせ、Z 列（鉄砲の種類）で区別する。
      var firstLic = {
        type: CHO_LICENSE_TYPE_[kind],
        authority: idx.get(b + "/第一種銃猟免許/許可権者"),
        no: idx.get(b + "/第一種銃猟免許/許可番号"),
        date: Cho_toDateOrText_(idx.get(b + "/第一種銃猟免許/交付年月日"))
      };
      var firstReg = parseReg(b, CHO_LICENSE_TYPE_[kind]);
      var guns = Cho_splitChecks_(idx.get(b + "/鉄砲の種類"));
      if (guns.length === 0) guns = [""];
      for (var g = 0; g < guns.length; g++) {
        var gun = guns[g];
        var possBase = b + "/鉄砲の種類/" + gun + "/所持許可";
        worker.methods.push({
          kind: kind,
          tools: [gun ? (CHO_TOOL_NAME_[gun] || gun) : "銃"],
          lic: firstLic,
          reg: firstReg,
          poss: gun ? {
            no: idx.get(possBase + "/所持許可証番号"),
            date: Cho_toDateOrText_(idx.get(possBase + "/交付年月日"))
          } : null,
          gunKind: gun
        });
      }
    } else {
      worker.methods.push({ kind: kind, tools: [kind], lic: null, reg: null, poss: null, gunKind: "" });
    }
  }
  return worker;
}

// ----- 種数の集計（従事者ごとの種数を種名単位で合算） -----
// 順序は CHO_SPECIES_ORDER_（フォーム選択肢順・表示名）。未知種は出現順で末尾。
// 合計が 0 の数量は ""（fill.gs が書き込みをスキップして空欄のままにする）。
function Cho_aggregateSpecies_(workers) {
  var totals = {};
  var appeared = [];
  for (var w = 0; w < workers.length; w++) {
    var species = workers[w].species || [];
    for (var s = 0; s < species.length; s++) {
      var sp = species[s];
      if (!totals[sp.name]) {
        totals[sp.name] = { name: sp.name, unit: sp.unit, count: 0, eggCount: 0 };
        appeared.push(sp.name);
      }
      if (typeof sp.count === "number") totals[sp.name].count += sp.count;
      if (typeof sp.eggCount === "number") totals[sp.name].eggCount += sp.eggCount;
    }
  }
  var ordered = [];
  for (var o = 0; o < CHO_SPECIES_ORDER_.length; o++) {
    if (totals[CHO_SPECIES_ORDER_[o]]) ordered.push(CHO_SPECIES_ORDER_[o]);
  }
  for (var a = 0; a < appeared.length; a++) {
    if (ordered.indexOf(appeared[a]) === -1) ordered.push(appeared[a]);
  }
  var list = [];
  for (var i = 0; i < ordered.length; i++) {
    var t = totals[ordered[i]];
    list.push({
      name: t.name,
      count: t.count > 0 ? t.count : "",
      unit: t.unit,
      eggCount: t.eggCount > 0 ? t.eggCount : ""
    });
  }
  return list;
}

// ----- 捕獲用具の和集合（全従事者 × 全方法の tools を重複排除） -----
// 順序は CHO_TOOL_ORDER_。未知用具は出現順で末尾。
function Cho_unionTools_(workers) {
  var seen = [];
  for (var w = 0; w < workers.length; w++) {
    var methods = workers[w].methods || [];
    for (var m = 0; m < methods.length; m++) {
      var tools = methods[m].tools || [];
      for (var t = 0; t < tools.length; t++) {
        if (tools[t] && seen.indexOf(tools[t]) === -1) seen.push(tools[t]);
      }
    }
  }
  var ordered = [];
  for (var o = 0; o < CHO_TOOL_ORDER_.length; o++) {
    if (seen.indexOf(CHO_TOOL_ORDER_[o]) !== -1) ordered.push(CHO_TOOL_ORDER_[o]);
  }
  for (var s2 = 0; s2 < seen.length; s2++) {
    if (ordered.indexOf(seen[s2]) === -1) ordered.push(seen[s2]);
  }
  return ordered;
}

// ----- 名簿エントリ展開（従事者 × 捕獲方法 → 1 エントリ = 名簿 1 ブロック） -----
// 2 エントリ目以降は個人欄（住所/氏名/職業/生年月日/従事者証番号）と種数欄を空欄にする
// （数量の二重計上防止。捕獲方法に関係ない欄は空白でよい、というユーザー方針）。
function Cho_expandRosterEntries_(workers, permitNo) {
  var entries = [];
  for (var w = 0; w < workers.length; w++) {
    var worker = workers[w];
    var methods = worker.methods.length > 0
      ? worker.methods
      : [{ kind: "", tools: [], lic: null, reg: null, poss: null, gunKind: "" }];
    for (var m = 0; m < methods.length; m++) {
      entries.push({
        includePersonal: m === 0,
        certNo: m === 0 && permitNo ? "第" + permitNo + "-" + (w + 1) + "号" : "",
        worker: worker,
        method: methods[m]
      });
    }
  }
  return entries;
}


// #############################################################################
// ## mapping.gs
// #############################################################################

// =============================================================================
// mapping.gs — 様式セルマップ + 値変換テーブル（全部データ。ロジックは fill.gs / domain.gs）
//
// セル番地の典拠は form_data/鳥獣保護管理法様式.xlsx の旧数式
// （scripts/extract_formula_map.py で抽出した formulas.tsv）。
// セル番地を直したいときはこのファイルだけ編集すればよい。
//
// 規約:
//   - cell は必ず結合セルの左上番地で書く（merges.tsv で検証済み）
//   - get はドメインモデル（domain.gs の Cho_buildModel_）のフラットなキー名
//   - 値が "" / null のセルは書き込まない（fill.gs 側でスキップ）
// =============================================================================

// ----- ラベル定数（フォーム定義の正確な文字列。半角/全角括弧の罠を 1 箇所に隔離）-----
// 親フォーム「鳥獣保護管理法許可申請」
// ※ 種数・方法は親フォームの入力欄を廃止（従事者の合計量・和集合から導出）したためラベル定数も無い
var CHO_L_FORMLINK_ = "従事者情報";
var CHO_L_DISPOSAL_ = "捕獲等又は採取等をしたあとの処置";
var CHO_L_PURPOSE_ = "捕獲等又は採取等の目的";
var CHO_L_PERIOD_ = "捕獲等又は採取等の期間";
var CHO_L_AREA_ = "捕獲等又は採取等の区域";
var CHO_L_AREA7_ = "規則第７条第１項第７号に係る場所等の位置、名称及び理由";
var CHO_L_CERT_OR_REQ_ = "証明書又は依頼書の別";
var CHO_L_APPLICANT_ = "申請者情報";
var CHO_L_APPLICANT_TYPE_ = "申請者の個人・法人の別";
var CHO_L_PERMIT_GROUP_ = "許可処分情報";
var CHO_L_REMARKS_ = "備考";
// 子フォーム「従事者情報」
var CHO_L_CHILD_METHOD_ = "捕獲等又は採取等の方法（使用する捕獲用具の名称)"; // 閉じ括弧が半角!
var CHO_L_CHILD_SPECIES_ = "捕獲等をする鳥獣又は採取等をする鳥類の卵の種類及び数量";
var CHO_L_REP_ = "代表的個人";

// ----- 値変換テーブル -----
// フォームの種名 → 様式の種名（様式の入力規則: ハシブトガラス,ハシボソガラス,ドバト,スズメ,アライグマ,キツネ,キジバト）
var CHO_SPECIES_NAME_MAP_ = { "カワラバト": "ドバト" }; // 他は素通し（ノイヌ/ノネコ/ねずみ は as-is）
// 種ごとの数量単位（フォーム定義の 捕獲羽数/捕獲頭数 と一致させる）
var CHO_SPECIES_UNIT_ = {
  "キジバト": "羽", "カワラバト": "羽", "ドバト": "羽", "スズメ": "羽",
  "ハシボソガラス": "羽", "ハシブトガラス": "羽",
  "キツネ": "頭", "ノイヌ": "頭", "ノネコ": "頭", "アライグマ": "頭", "ねずみ": "頭"
};
// 処置（様式の入力規則: 放鳥,放獣,放鳥・放獣,焼却,埋設・廃棄）
var CHO_DISPOSAL_MAP_ = { "焼却": "焼却", "廃棄": "埋設・廃棄", "埋設": "埋設・廃棄" };
// 捕獲用具の正規表記（様式の入力規則: 手捕り,はこわな,くくりわな,網(つき網),銃(散弾銃),銃(空気銃),…）
var CHO_TOOL_NAME_ = {
  "手捕り": "手捕り", "はこわな": "はこわな", "くくりわな": "くくりわな",
  "網猟": "網(つき網)", "空気銃": "銃(空気銃)", "散弾銃": "銃(散弾銃)", "ライフル銃": "銃(ライフル銃)"
};
// 子フォームの方法 → 狩猟免許の種類
var CHO_LICENSE_TYPE_ = {
  "わな猟": "わな猟", "網猟": "網猟", "空気銃": "第二種銃猟", "散弾銃・ライフル銃": "第一種銃猟"
};
// 種数の表示順（CHO_SPECIES_NAME_MAP_ 適用後の表示名。フォーム選択肢順）
var CHO_SPECIES_ORDER_ = [
  "キジバト", "ドバト", "スズメ", "ハシボソガラス", "ハシブトガラス",
  "キツネ", "ノイヌ", "ノネコ", "アライグマ", "ねずみ"
];
// 捕獲用具の表示順（CHO_TOOL_NAME_ 適用後の正規表記）
var CHO_TOOL_ORDER_ = [
  "手捕り", "はこわな", "くくりわな", "網(つき網)", "銃(空気銃)", "銃(散弾銃)", "銃(ライフル銃)"
];

// ----- 静的セルマップ（シート名 → [{cell, get}]）-----
var CHO_SHEET_MAPS_ = {
  "申請書": [
    { cell: "I2", get: "applicationDate" },
    { cell: "G6", get: "applicantAddress" },
    { cell: "G8", get: "applicantNameComposed" },
    { cell: "G9", get: "applicantOccupation" },
    { cell: "G10", get: "applicantBirthDate" },
    { cell: "E23", get: "purpose" },
    { cell: "E24", get: "periodStart" },
    { cell: "I24", get: "periodEnd" },
    { cell: "E25", get: "areaLocation" },
    { cell: "E26", get: "method1" },
    { cell: "E27", get: "method2" },
    { cell: "E28", get: "method3Rest" }, // 4 つ以上は 3 枠目に連結
    { cell: "E29", get: "disposal1" },
    { cell: "E30", get: "disposal2" },
    { cell: "E31", get: "disposal3" },
    { cell: "E32", get: "disposal4" },
    { cell: "E33", get: "area7Flag" },
    { cell: "E34", get: "area7Detail" },
    { cell: "E35", get: "licenseNote" },      // 狩猟免許あり → 別添従事者名簿のとおり
    { cell: "E39", get: "registrationNote" }, // 狩猟者登録あり → 〃
    { cell: "E42", get: "gunPermitNote" },    // 銃器使用あり → 〃
    { cell: "E45", get: "remarks" }
  ],
  "証明書": [
    { cell: "I2", get: "applicationDate" },
    { cell: "H5", get: "applicantNameComposed" },
    { cell: "E19", get: "certDamageTime" },
    { cell: "E20", get: "certDamageArea" },
    { cell: "E21", get: "certDamageContent" },
    { cell: "E22", get: "certCountermeasure" },
    { cell: "E23", get: "certPastResults" }
    // E24（証明者氏名）はフォームから項目廃止に伴い書き込みも廃止（証明者が手書き押印する欄）
  ],
  "依頼書": [
    { cell: "I2", get: "applicationDate" },
    { cell: "H6", get: "requesterAddress" },
    { cell: "H8", get: "requesterName" },
    { cell: "E15", get: "repWorkerAddress" }, // 被依頼者 = 代表従事者
    { cell: "E16", get: "repWorkerName" },
    { cell: "E17", get: "repWorkerOccupation" },
    { cell: "E18", get: "repWorkerBirthDate" },
    { cell: "E25", get: "requestPeriodStart" },
    { cell: "I25", get: "requestPeriodEnd" },
    { cell: "E26", get: "areaLocation" },
    { cell: "E27", get: "damageStatus" },
    { cell: "E28", get: "requestReason" }
  ],
  "許可伺書": [
    { cell: "D3", get: "applicantAddress" },
    { cell: "D4", get: "applicantNameComposed" },
    { cell: "D5", get: "permitNoFull" },
    { cell: "D12", get: "purpose" },
    { cell: "D13", get: "periodStart" },
    { cell: "G13", get: "periodEnd" },
    { cell: "D14", get: "areaLocation" },
    { cell: "D15", get: "method1" },
    { cell: "E15", get: "method2" },
    { cell: "G15", get: "method3Rest" },
    { cell: "D18", get: "requesterName" }
  ],
  "交付通知書": [
    { cell: "B3", get: "permitDocNo" },      // 札環対許可第N号
    { cell: "B4", get: "permitDate" },
    { cell: "B7", get: "applicantNameSama" }, // 氏名 + 様
    { cell: "B13", get: "notifyBodyText" },   // {申請日和暦}付けで申請のあった…交付します。
    { cell: "C16", get: "repWorkerName" },
    { cell: "D16", get: "othersSuffix" },     // (ほかN名)
    { cell: "C17", get: "permitNoFull" },
    { cell: "D17", get: "certNoRangeText" },  // (許可証番号/従事者証番号 第N-1号～第N-M号)
    { cell: "C24", get: "purpose" },
    { cell: "C25", get: "periodStart" },
    { cell: "F25", get: "periodEnd" },
    { cell: "C26", get: "areaLocation" },
    { cell: "C27", get: "method1" },
    { cell: "D27", get: "method2" },
    { cell: "F27", get: "method3Rest" },
    { cell: "C28", get: "permitConditions" },
    { cell: "B30", get: "trapNoticeText" }    // わな使用時の標識掲示の注意書き
  ],
  "従事者証": [
    { cell: "C4", get: "workerCertNo1" },     // 第N-1号
    { cell: "F4", get: "periodStart" },
    { cell: "F5", get: "periodEnd" },
    { cell: "K14", get: "permitNoFull" },
    { cell: "K17", get: "corporateName" },    // 法人の名称（法人時のみ）
    { cell: "D18", get: "repWorkerAddress" },
    { cell: "D23", get: "repWorkerNameWithOthers" },
    { cell: "D29", get: "repWorkerBirthDate" },
    { cell: "K26", get: "purpose" },
    { cell: "K29", get: "areaLocation" },
    { cell: "K33", get: "method1" },
    { cell: "L33", get: "method2" },
    { cell: "N33", get: "method3Rest" },
    { cell: "K36", get: "permitConditions" }
  ],
  "許可審査表": [
    { cell: "D5", get: "applicantAddress" },
    { cell: "G5", get: "reviewClassText" },   // 1 被害者 / 2 法人等 / 3 依頼を受けた者
    { cell: "D8", get: "applicantName" },
    { cell: "G8", get: "requesterNameLabel" }, // 依頼者あり時 "依頼者氏名："
    { cell: "I8", get: "requesterName" },
    { cell: "D11", get: "repWorkerName" },
    { cell: "E12", get: "othersSuffix" },
    { cell: "D15", get: "speciesNamesJoined" },
    { cell: "G23", get: "speciesDamageText" }, // {種名…}による被害等
    { cell: "D26", get: "periodStart" },
    { cell: "D28", get: "periodEnd" },
    { cell: "E29", get: "periodDaysText" },    // N日間
    { cell: "D30", get: "areaLocation" },
    { cell: "G31", get: "area7CheckText" },    // ☑/□次の区域を含む。【施行規則第7条第1項第7号】
    { cell: "D43", get: "method1" },
    { cell: "D44", get: "method2" },
    { cell: "D45", get: "method3" },
    { cell: "D46", get: "method4Rest" }
  ],
  // 旧「許可証個人」「許可証法人」は様式がほぼ同一のため単一シート「許可証」に統一
  // （セットアップで 許可証個人 → 許可証 にリネームし、許可証法人 を削除する）
  "許可証": [
    { cell: "C3", get: "certHeaderNo" },          // 個人=第N-1号 / 法人=第N号
    { cell: "H4", get: "periodStart" },
    { cell: "H5", get: "periodEnd" },
    { cell: "G12", get: "applicantAddress" },
    { cell: "G13", get: "applicantNameComposed" }, // 法人時は法人名
    { cell: "G14", get: "applicantBirthDate" },    // 法人時は ""（空欄のまま）
    { cell: "G23", get: "purpose" },
    { cell: "G25", get: "areaLocation" },
    { cell: "G28", get: "method1" },
    { cell: "H28", get: "method2" },
    { cell: "J28", get: "method3Rest" },
    { cell: "G30", get: "disposal1" },
    { cell: "H30", get: "disposal2" },
    { cell: "J30", get: "disposal3Rest" },
    { cell: "G32", get: "permitConditions" }
  ],
  "振興局宛通知": [
    { cell: "H3", get: "permitDocNo" },
    { cell: "H4", get: "permitDate" },
    { cell: "C13", get: "applicantAddress" },
    { cell: "C14", get: "applicantNameComposed" },
    { cell: "C15", get: "permitNoFull" },
    { cell: "D15", get: "certNoRangePersonal" }, // 個人かつ複数名のとき (許可証番号 第N-1号～…)
    { cell: "C16", get: "repWorkerNameCorp" },   // 法人時のみ代表従事者名
    { cell: "D17", get: "othersSuffixCorp" },
    { cell: "D18", get: "certNoRangeCorp" },     // 法人時 (従事者証番号 第N-1号～…)
    { cell: "C25", get: "purpose" },
    { cell: "C28", get: "periodStart" },
    { cell: "F28", get: "periodEnd" },
    { cell: "C31", get: "areaLocation" },
    { cell: "C34", get: "method1" },
    { cell: "D34", get: "method2" },
    { cell: "F34", get: "method3Rest" }
  ],
  "警察宛通知": [
    { cell: "H3", get: "permitDocNo" },
    { cell: "H4", get: "permitDate" },
    { cell: "C13", get: "applicantAddress" },
    { cell: "C14", get: "applicantNameComposed" },
    { cell: "C15", get: "permitNoFull" },
    { cell: "D15", get: "certNoRangePersonal" },
    { cell: "C16", get: "repWorkerNameCorp" },
    { cell: "D17", get: "othersSuffixCorp" },
    { cell: "D18", get: "certNoRangeCorp" },
    { cell: "C25", get: "purpose" },
    { cell: "C28", get: "periodStart" },
    { cell: "F28", get: "periodEnd" },
    { cell: "C31", get: "areaLocation" },
    { cell: "C34", get: "method1" },
    { cell: "D34", get: "method2" },
    { cell: "F34", get: "method3Rest" }
  ],
  "報告書添付": [
    { cell: "A2", get: "speciesCount" },
    { cell: "O3", get: "permitDate" },
    { cell: "D10", get: "returnReportText" }, // {許可日和暦}付け札環対許可第N号で許可された…報告します。
    { cell: "J16", get: "areaLocation" }
    // G 列以降の捕獲実績は事後入力のため空欄
  ],
  "結果報告書": [
    { cell: "A2", get: "speciesCount" },
    { cell: "O3", get: "permitDate" },
    { cell: "O4", get: "permitNoTail" },  // {許可番号}号
    { cell: "P4", get: "permitNo" },
    { cell: "D10", get: "returnReportText" },
    { cell: "J16", get: "areaLocation" }
    // K3（報告日）・捕獲実績・P 列集計は事後入力のため空欄
  ],
  "わな": [
    { cell: "C2", get: "applicantNameComposed" },
    { cell: "C3", get: "applicantAddress" },
    { cell: "C5", get: "permitDate" },
    { cell: "C6", get: "periodStart" },
    { cell: "E6", get: "periodEnd" }
  ]
};

// シートごとの記入条件（無いシートは常時記入）。m = ドメインモデル。
var CHO_SHEET_CONDITIONS_ = {
  "証明書": function (m) { return m.certOrRequest === "証明書"; },
  "依頼書": function (m) { return m.certOrRequest === "依頼書"; },
  "わな": function (m) { return m.hasTrapMethod; }
};

// ----- 種数テーブル（捕獲しようとする鳥獣の種類及び数量の繰り返し行）-----
// cols のキー: name / count / unit / eggLabel("卵") / eggCount / eggUnit("個")
//             name2 / quotaCount / quotaEgg（許可審査表の 1 人あたり数量）
var CHO_SPECIES_TABLES_ = {
  "申請書":     { startRow: 17, maxRows: 6, cols: { name: "E", count: "G", unit: "H", eggLabel: "I", eggCount: "J", eggUnit: "K" } },
  "証明書":     { startRow: 13, maxRows: 6, cols: { name: "E", count: "G", unit: "H", eggLabel: "I", eggCount: "J", eggUnit: "K" } },
  "依頼書":     { startRow: 19, maxRows: 6, cols: { name: "E", count: "G", unit: "H", eggLabel: "I", eggCount: "J", eggUnit: "K" } },
  "許可伺書":   { startRow: 6,  maxRows: 6, cols: { name: "D", count: "E", unit: "F", eggLabel: "G", eggCount: "H", eggUnit: "I" } },
  "交付通知書": { startRow: 18, maxRows: 6, cols: { name: "C", count: "D", unit: "E", eggLabel: "F", eggCount: "G", eggUnit: "H" } },
  "振興局宛通知": { startRow: 19, maxRows: 6, cols: { name: "C", count: "D", unit: "E", eggLabel: "F", eggCount: "G", eggUnit: "H" } },
  "警察宛通知": { startRow: 19, maxRows: 6, cols: { name: "C", count: "D", unit: "E", eggLabel: "F", eggCount: "G", eggUnit: "H" } },
  "従事者証":   { startRow: 20, maxRows: 6, cols: { name: "K", count: "L", unit: "M", eggLabel: "N", eggCount: "O", eggUnit: "P" } },
  "許可証":     { startRow: 17, maxRows: 6, cols: { name: "G", count: "H", unit: "I", eggLabel: "J", eggCount: "K", eggUnit: "L" } },
  "許可審査表": { startRow: 17, maxRows: 6, cols: { name: "D", count: "E", eggCount: "F", name2: "G", quotaCount: "H", quotaEgg: "I" } }
};

// ----- 従事者名簿のブロック幾何 -----
// 1 ブロック = 6 行 × 8 ブロック（行 5〜52）。個人・法人共通で「従事者名簿」1 シートに書く。
// 個人情報・免許列も P 列（捕獲用具）もブロック全体の縦結合（左上 = ブロック先頭行）。
var CHO_ROSTER_COLS_ = {
  certNo: "E", address: "F", name: "G", occupation: "H", birth: "I",
  speciesName: "J", speciesCount: "K", speciesUnit: "L",
  eggLabel: "M", eggCount: "N", eggUnit: "O",
  toolCol: "P",
  licType: "Q", licAuthority: "R", licNo: "S", licDate: "T",
  regType: "U", regNo: "V", regDate: "W",
  gunPermitNo: "X", gunPermitDate: "Y", gunKind: "Z",
  remarks: "AA"
};
var CHO_ROSTER_LAYOUT_ = {
  sheetName: "従事者名簿", firstRow: 5, blockHeight: 6, blockCount: 8, cols: CHO_ROSTER_COLS_
};

// テンプレートから削除するシート（入力専用 + 統一で不要になった様式）
var CHO_SHEETS_TO_DELETE_ = ["Sheet1", "申請内容", "従事者名簿 (法人)", "許可証法人"];

// 固定文言
var CHO_NOTE_SEE_ROSTER_ = "別添従事者名簿のとおり";
var CHO_TRAP_NOTICE_ = "※　わなを使用する場合は、標識の掲示を必ず行ってください。";
var CHO_AREA7_CHECKED_ = "☑次の区域を含む。【施行規則第7条第1項第7号】";
var CHO_AREA7_UNCHECKED_ = "□次の区域を含む。【施行規則第7条第1項第7号】";
var CHO_REVIEW_CLASS_VICTIM_ = "1　被害者（国・地方公共団体・農協以外の法人・個人）";
var CHO_REVIEW_CLASS_CORP_ = "2　法人等(国・地方公共団体・農協)";
var CHO_REVIEW_CLASS_PROXY_ = "3　被害者又は法人等から依頼を受けた者";


// #############################################################################
// ## fill.gs
// #############################################################################

// =============================================================================
// fill.gs — テンプレート複製とシート書き込み（静的マップ / 種数テーブル / 従事者名簿）
//
// 書き込み規約:
//   - 値が "" / null のセルは触らない（テンプレートの空欄をそのまま残す）
//   - 結合セルは左上番地に setValue（mapping.gs の番地は merges.tsv で左上を確認済み）
//   - Date はそのまま setValue し、テンプレート側に残る表示形式（和暦等）に委ねる
// =============================================================================

// Script Properties のキー
var CHO_PROP_TEMPLATE_ = "CHO_TEMPLATE_FILE_ID";
var CHO_PROP_FOLDER_ = "CHO_OUTPUT_FOLDER_ID";
var CHO_PROP_KEY_ = "CHO_ACCESS_KEY";

// テンプレートを出力フォルダへ複製し、ファイル（DriveApp File）を返す。
function Cho_createOutputCopy_(recordNo) {
  var props = PropertiesService.getScriptProperties();
  var templateId = props.getProperty(CHO_PROP_TEMPLATE_);
  var folderId = props.getProperty(CHO_PROP_FOLDER_);
  if (!templateId || !folderId) {
    throw new Error("テンプレート未設定です。setup.gs の Cho_registerSettings を実行してください。");
  }
  var stamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd_HHmmss");
  var noPart = String(recordNo == null || recordNo === "" ? "record" : recordNo);
  var name = "鳥獣保護管理法様式_" + noPart + "_" + stamp;
  return DriveApp.getFileById(templateId).makeCopy(name, DriveApp.getFolderById(folderId));
}

function Cho_setCell_(sheet, a1, value) {
  if (value === "" || value === null || value === undefined) return;
  sheet.getRange(a1).setValue(value);
}

// ----- 全シート書き込み -----
function Cho_fillAll_(ss, model) {
  var sheetNames = Object.keys(CHO_SHEET_MAPS_);
  for (var i = 0; i < sheetNames.length; i++) {
    var name = sheetNames[i];
    var cond = CHO_SHEET_CONDITIONS_[name];
    if (cond && !cond(model)) continue;
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      model.warnings.push("シート「" + name + "」がテンプレートに見つかりません。");
      continue;
    }
    Cho_writeStaticMap_(sheet, CHO_SHEET_MAPS_[name], model);
    if (CHO_SPECIES_TABLES_[name]) {
      Cho_writeSpeciesTable_(sheet, name, CHO_SPECIES_TABLES_[name], model);
    }
  }
  Cho_writeRosterBlocks_(ss, model);
}

// ----- 静的セルマップ -----
function Cho_writeStaticMap_(sheet, map, model) {
  for (var i = 0; i < map.length; i++) {
    Cho_setCell_(sheet, map[i].cell, model[map[i].get]);
  }
}

// ----- 種数テーブル -----
// cols: name / count / unit / eggLabel / eggCount / eggUnit / name2 / quotaCount / quotaEgg
function Cho_writeSpeciesTable_(sheet, sheetName, cfg, model) {
  var list = model.speciesList || [];
  if (list.length > cfg.maxRows) {
    model.warnings.push("シート「" + sheetName + "」の種数欄(" + cfg.maxRows + "行)を超えたため、" +
      (list.length - cfg.maxRows) + " 種を出力できませんでした。");
  }
  var cols = cfg.cols;
  var n = Math.min(list.length, cfg.maxRows);
  for (var i = 0; i < n; i++) {
    var sp = list[i];
    var row = cfg.startRow + i;
    if (cols.name) Cho_setCell_(sheet, cols.name + row, sp.name);
    if (cols.count) Cho_setCell_(sheet, cols.count + row, sp.count);
    if (cols.unit && sp.name) Cho_setCell_(sheet, cols.unit + row, sp.unit);
    if (cols.eggLabel && sp.eggCount !== "") Cho_setCell_(sheet, cols.eggLabel + row, "卵");
    if (cols.eggCount) Cho_setCell_(sheet, cols.eggCount + row, sp.eggCount);
    if (cols.eggUnit && sp.eggCount !== "") Cho_setCell_(sheet, cols.eggUnit + row, "個");
    if (cols.name2) Cho_setCell_(sheet, cols.name2 + row, sp.name);
    if (cols.quotaCount) Cho_setCell_(sheet, cols.quotaCount + row, Cho_perPerson_(sp.count, model.workerCount));
    if (cols.quotaEgg) Cho_setCell_(sheet, cols.quotaEgg + row, Cho_perPerson_(sp.eggCount, model.workerCount));
  }
}

// 1 人あたり数量（許可審査表 G-I 列。旧数式 = 数量 / 従事者数）。
function Cho_perPerson_(total, workerCount) {
  if (typeof total !== "number" || !workerCount) return "";
  return total / workerCount;
}

// ----- 従事者名簿（従事者 × 捕獲方法 で 1 ブロック。個人・法人共通） -----
function Cho_writeRosterBlocks_(ss, model) {
  var layout = CHO_ROSTER_LAYOUT_;
  var sheet = ss.getSheetByName(layout.sheetName);
  if (!sheet) {
    model.warnings.push("シート「" + layout.sheetName + "」がテンプレートに見つかりません。");
    return;
  }
  var entries = model.rosterEntries || [];
  if (entries.length > layout.blockCount) {
    model.warnings.push("従事者名簿の枠(" + layout.blockCount + "ブロック)を超えたため、" +
      (entries.length - layout.blockCount) + " 件を出力できませんでした。");
  }
  var cols = layout.cols;
  var n = Math.min(entries.length, layout.blockCount);
  for (var e = 0; e < n; e++) {
    var entry = entries[e];
    var top = layout.firstRow + e * layout.blockHeight;
    var worker = entry.worker;
    var method = entry.method;

    Cho_setCell_(sheet, cols.certNo + top, entry.certNo);
    if (entry.includePersonal) {
      Cho_setCell_(sheet, cols.address + top, worker.address);
      Cho_setCell_(sheet, cols.name + top, worker.name);
      Cho_setCell_(sheet, cols.occupation + top, worker.occupation);
      Cho_setCell_(sheet, cols.birth + top, worker.birth);
      // 種数（ブロック内 6 行 = 最大 6 種。2 ブロック目以降は二重計上防止のため空欄）
      var species = worker.species || [];
      if (species.length > layout.blockHeight) {
        model.warnings.push("従事者「" + worker.name + "」の種数が " + layout.blockHeight +
          " 行を超えたため、" + (species.length - layout.blockHeight) + " 種を出力できませんでした。");
      }
      for (var s = 0; s < Math.min(species.length, layout.blockHeight); s++) {
        var sp = species[s];
        var row = top + s;
        Cho_setCell_(sheet, cols.speciesName + row, sp.name);
        Cho_setCell_(sheet, cols.speciesCount + row, sp.count);
        if (sp.name) Cho_setCell_(sheet, cols.speciesUnit + row, sp.unit);
        if (sp.eggCount !== "") {
          Cho_setCell_(sheet, cols.eggLabel + row, "卵");
          Cho_setCell_(sheet, cols.eggCount + row, sp.eggCount);
          Cho_setCell_(sheet, cols.eggUnit + row, "個");
        }
      }
    }

    // 捕獲用具（P 列はブロック全体の 1 結合セル。複数用具は改行で並べる）
    var tools = method.tools || [];
    if (tools.length > 0) {
      Cho_setCell_(sheet, cols.toolCol + top, tools.join("\n"));
    }

    if (method.lic) {
      Cho_setCell_(sheet, cols.licType + top, method.lic.type);
      Cho_setCell_(sheet, cols.licAuthority + top, method.lic.authority);
      Cho_setCell_(sheet, cols.licNo + top, method.lic.no);
      Cho_setCell_(sheet, cols.licDate + top, method.lic.date);
    }
    if (method.reg) {
      Cho_setCell_(sheet, cols.regType + top, method.reg.type);
      Cho_setCell_(sheet, cols.regNo + top, method.reg.no);
      Cho_setCell_(sheet, cols.regDate + top, method.reg.date);
    }
    if (method.poss) {
      Cho_setCell_(sheet, cols.gunPermitNo + top, method.poss.no);
      Cho_setCell_(sheet, cols.gunPermitDate + top, method.poss.date);
      Cho_setCell_(sheet, cols.gunKind + top, method.gunKind);
    }
  }
}


// #############################################################################
// ## setup.gs
// #############################################################################

// =============================================================================
// setup.gs — 一次セットアップ（GAS エディタから手動実行する）
//
// 手順:
//   1. form_data/鳥獣保護管理法様式_1_20260611_120316.xlsx を Drive にアップロード →
//      「ファイル > Google スプレッドシートとして保存」で変換し、ファイル ID を控える
//   2. 出力先フォルダを Drive に作成し、フォルダ ID を控える
//   3. 下の Cho_registerSettings の引数を書き換えて実行（Script Properties に保存）
//   4. Cho_setupCleanTemplate を実行（不要シート削除・許可証リネーム・数式消去・
//      マッピング対象セルの残留値クリア・名簿 P 列の結合正規化。冪等）
// =============================================================================

// 引数を直接書き換えて GAS エディタから実行する（実行後は引数を消してよい）。
// accessKey は 外部アクション URL の ?k= と照合する任意の合言葉（空文字ならゲート無効）。
function Cho_registerSettings(templateFileId, outputFolderId, accessKey) {
  if (!templateFileId || !outputFolderId) {
    throw new Error("templateFileId と outputFolderId を指定してください。");
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty(CHO_PROP_TEMPLATE_, String(templateFileId));
  props.setProperty(CHO_PROP_FOLDER_, String(outputFolderId));
  props.setProperty(CHO_PROP_KEY_, String(accessKey || ""));
  Logger.log("登録しました: template=%s / folder=%s / accessKey=%s",
    templateFileId, outputFolderId, accessKey ? "(設定あり)" : "(なし)");
}

// テンプレートの清掃。すべて冪等で、何度実行してもよい。
//   1. 不要シートの削除（Sheet1・申請内容・従事者名簿 (法人)・許可証法人）
//   2. 許可証個人 → 許可証 へのリネーム（個人/法人の様式統一）
//   3. 全シートの数式セルを clearContent（書式・結合・罫線・表示形式は保持）
//   4. マッピング対象セルの値クリア（生成済みファイルをテンプレに昇格させたときの残留値対策）
//   5. 従事者名簿 P 列の結合をブロック単位 1 セルへ正規化
function Cho_setupCleanTemplate() {
  var templateId = PropertiesService.getScriptProperties().getProperty(CHO_PROP_TEMPLATE_);
  if (!templateId) {
    throw new Error("先に Cho_registerSettings を実行してください。");
  }
  var ss = SpreadsheetApp.openById(templateId);

  for (var d = 0; d < CHO_SHEETS_TO_DELETE_.length; d++) {
    var doomed = ss.getSheetByName(CHO_SHEETS_TO_DELETE_[d]);
    if (doomed) {
      ss.deleteSheet(doomed);
      Logger.log("シート削除: %s", CHO_SHEETS_TO_DELETE_[d]);
    }
  }

  if (!ss.getSheetByName("許可証")) {
    var oldCertSheet = ss.getSheetByName("許可証個人");
    if (oldCertSheet) {
      oldCertSheet.setName("許可証");
      Logger.log("シート名変更: 許可証個人 → 許可証");
    }
  }

  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var range = sheet.getDataRange();
    var formulas = range.getFormulas();
    var cleared = 0;
    for (var r = 0; r < formulas.length; r++) {
      // 連続する数式セルをまとめて clearContent する（行ごとの run-length）
      var c = 0;
      while (c < formulas[r].length) {
        if (formulas[r][c]) {
          var start = c;
          while (c < formulas[r].length && formulas[r][c]) c++;
          sheet.getRange(r + 1, start + 1, 1, c - start).clearContent();
          cleared += c - start;
        } else {
          c++;
        }
      }
    }
    Logger.log("数式消去: %s … %s セル", sheet.getName(), cleared);
  }

  Cho_clearMappedCells_(ss);
  Cho_normalizeRosterToolMerges_(ss);

  SpreadsheetApp.flush();
  Logger.log("テンプレート清掃が完了しました。");
}

// マッピング対象セル（静的マップ・種数テーブル・名簿ブロック）の値を一括クリアする。
// 生成済みファイルを手直ししてテンプレートに昇格させたとき、レコード由来の値が
// 残っていると以降の全出力に混入するため、書き込み先を機械的に空にする。
// ラベル・固定文言はマッピング対象外なので残る。冪等。
function Cho_clearMappedCells_(ss) {
  var names = Object.keys(CHO_SHEET_MAPS_);
  for (var i = 0; i < names.length; i++) {
    var sheet = ss.getSheetByName(names[i]);
    if (!sheet) {
      Logger.log("値クリア: シート「%s」が見つかりません（スキップ）", names[i]);
      continue;
    }
    var cleared = 0;
    var map = CHO_SHEET_MAPS_[names[i]];
    for (var c = 0; c < map.length; c++) {
      sheet.getRange(map[c].cell).clearContent();
      cleared++;
    }
    var table = CHO_SPECIES_TABLES_[names[i]];
    if (table) {
      var colKeys = Object.keys(table.cols);
      for (var k = 0; k < colKeys.length; k++) {
        var col = table.cols[colKeys[k]];
        sheet.getRange(col + table.startRow + ":" + col + (table.startRow + table.maxRows - 1)).clearContent();
        cleared += table.maxRows;
      }
    }
    Logger.log("値クリア: %s … %s セル", names[i], cleared);
  }
  var roster = ss.getSheetByName(CHO_ROSTER_LAYOUT_.sheetName);
  if (roster) {
    var cols = CHO_ROSTER_LAYOUT_.cols;
    var firstRow = CHO_ROSTER_LAYOUT_.firstRow;
    var lastRow = firstRow + CHO_ROSTER_LAYOUT_.blockHeight * CHO_ROSTER_LAYOUT_.blockCount - 1;
    roster.getRange(cols.certNo + firstRow + ":" + cols.remarks + lastRow).clearContent();
    Logger.log("値クリア: %s … %s%s:%s%s", CHO_ROSTER_LAYOUT_.sheetName,
      cols.certNo, firstRow, cols.remarks, lastRow);
  }
}

// 従事者名簿 P 列（捕獲用具）の結合をブロック単位の 1 セルへ正規化する。
// 旧テンプレは 2 行 × 3 サブスロット結合だったため、breakApart してから
// ブロック全体（6 行）を merge し直す。冪等。
function Cho_normalizeRosterToolMerges_(ss) {
  var sheet = ss.getSheetByName(CHO_ROSTER_LAYOUT_.sheetName);
  if (!sheet) return;
  var cols = CHO_ROSTER_LAYOUT_.cols;
  for (var b = 0; b < CHO_ROSTER_LAYOUT_.blockCount; b++) {
    var top = CHO_ROSTER_LAYOUT_.firstRow + b * CHO_ROSTER_LAYOUT_.blockHeight;
    var range = sheet.getRange(cols.toolCol + top + ":" + cols.toolCol + (top + CHO_ROSTER_LAYOUT_.blockHeight - 1));
    range.breakApart();
    range.merge();
  }
  Logger.log("P 列結合正規化: %s … %s ブロック", CHO_ROSTER_LAYOUT_.sheetName, CHO_ROSTER_LAYOUT_.blockCount);
}


// #############################################################################
// ## Test.gs
// #############################################################################

// =============================================================================
// Test.gs — デプロイ不要の動作確認（GAS エディタから testAll を実行してログを見る）
//
//   testModel_golden      … ゴールデン payload のモデル組み立て（純ロジックのみ）
//   testModel_multiMethod … 従事者×捕獲方法の展開（4 ブロック・2 番目以降個人欄空白）
//   testFill_golden       … doPost を通して実際に様式を生成（テンプレ設定済みのときのみ）
//   testDoPost_missingPayload / testDoPost_badJson … 異常系
// =============================================================================

function testAll() {
  var results = [];
  results.push(testModel_golden());
  results.push(testModel_multiMethod());
  results.push(testDoPost_missingPayload());
  results.push(testDoPost_badJson());
  results.push(testFill_golden());

  var passed = 0;
  for (var i = 0; i < results.length; i++) if (results[i]) passed++;
  Logger.log("==================================================");
  Logger.log("テスト結果: %s / %s PASS", passed, results.length);
  return passed === results.length;
}

// ----- モデル組み立て（ゴールデン） -----------------------------------------
function testModel_golden() {
  var model = Cho_buildModel_(Cho_buildGoldenPayload_());
  var errors = [];
  function expect(label, actual, expected) {
    var a = actual instanceof Date ? Utilities.formatDate(actual, "Asia/Tokyo", "yyyy-MM-dd") : actual;
    if (a !== expected) errors.push(label + ": got=" + a + " want=" + expected);
  }
  expect("applicantType", model.applicantType, "個人");
  expect("certOrRequest", model.certOrRequest, "依頼書");
  expect("workerCount", model.workerCount, 2);
  expect("applicantNameComposed", model.applicantNameComposed, "秋　はじめ(ほか1名)");
  expect("applicantAddress", model.applicantAddress, "札幌市北区あいの里X条X丁目X-X");
  // 親 substitution（別人の値）より代表従事者を優先すること
  expect("applicantOccupation", model.applicantOccupation, "会社役員");
  expect("applicantBirthDate", model.applicantBirthDate, "1999-06-26");
  expect("speciesList.length", model.speciesList.length, 1);
  expect("species name", model.speciesList[0].name, "キツネ");
  expect("species count", model.speciesList[0].count, 10);
  expect("species unit", model.speciesList[0].unit, "頭");
  expect("method1", model.method1, "くくりわな");
  expect("disposal1", model.disposal1, "焼却");
  expect("hasTrapMethod", model.hasTrapMethod, true);
  expect("area7Flag", model.area7Flag, "該当あり");
  expect("area7Detail", model.area7Detail, "公道");
  expect("periodStart", model.periodStart, "2026-06-01");
  expect("periodEnd", model.periodEnd, "2026-06-30");
  expect("periodDaysText", model.periodDaysText, "30日間");
  expect("requesterName", model.requesterName, "札幌市長　秋元　克広");
  expect("damageStatus", model.damageStatus, "住民へのつきまとい等");
  expect("permitNoFull", model.permitNoFull, "第8-81号");
  expect("permitDocNo", model.permitDocNo, "札環対許可第8-81号");
  expect("workerCertNo1", model.workerCertNo1, "第8-81-1号");
  expect("certHeaderNo (個人=従事者証1号)", model.certHeaderNo, "第8-81-1号");
  expect("certNoRangeText", model.certNoRangeText, "(許可証番号　第8-81-1号～第8-81-2号)");
  expect("licenseNote", model.licenseNote, CHO_NOTE_SEE_ROSTER_);
  expect("registrationNote", model.registrationNote, "");
  expect("gunPermitNote", model.gunPermitNote, "");
  expect("reviewClassText", model.reviewClassText, CHO_REVIEW_CLASS_PROXY_);

  // 名簿展開: 2 名 × 各 1 方法 = 2 ブロック
  expect("rosterEntries.length", model.rosterEntries.length, 2);
  var e1 = model.rosterEntries[0];
  expect("e1.certNo", e1.certNo, "第8-81-1号");
  expect("e1.includePersonal", e1.includePersonal, true);
  expect("e1.worker.name", e1.worker.name, "秋　はじめ");
  expect("e1.method.lic.type", e1.method.lic.type, "わな猟");
  expect("e1.method.lic.authority", e1.method.lic.authority, "北海道知事");
  expect("e1.method.lic.no", e1.method.lic.no, "石狩第0000号");
  expect("e1.method.tools", e1.method.tools.join(","), "くくりわな");
  expect("e1.worker.species[0].count", e1.worker.species[0].count, 5);
  var e2 = model.rosterEntries[1];
  expect("e2.certNo", e2.certNo, "第8-81-2号");
  expect("e2.method.lic.no", e2.method.lic.no, "石狩第0001号");

  logResult_("model_golden", errors.length === 0, errors.join(" / "));
  return errors.length === 0;
}

// ----- 従事者 × 捕獲方法の展開 ----------------------------------------------
function testModel_multiMethod() {
  var payload = Cho_buildGoldenPayload_();
  // 3 人目（わな猟 + 空気銃 + 銃 2 丁）を追加
  var extra = Cho_buildMultiMethodWorkerItems_("従事者情報/#3/");
  payload.record.items = payload.record.items.concat(extra);

  var model = Cho_buildModel_(payload);
  var errors = [];
  function expect(label, actual, expected) {
    if (actual !== expected) errors.push(label + ": got=" + actual + " want=" + expected);
  }
  expect("workerCount", model.workerCount, 3);
  // 1 + 1 + (1 + 1 + 2) = 6 ブロック
  expect("rosterEntries.length", model.rosterEntries.length, 6);

  // 方法 = 全従事者の捕獲用具の和集合（CHO_TOOL_ORDER_ 順）
  expect("method1 (和集合)", model.method1, "はこわな");
  expect("method2 (和集合)", model.method2, "くくりわな");
  expect("method3Rest (和集合)", model.method3Rest, "銃(空気銃)、銃(散弾銃)、銃(ライフル銃)");
  expect("hasTrapMethod", model.hasTrapMethod, true);
  // 種数 = 従事者合算（キツネ 5+5+3 / アライグマ 2。CHO_SPECIES_ORDER_ 順）
  expect("speciesList.length", model.speciesList.length, 2);
  expect("species[0] 合算", model.speciesList[0].name + model.speciesList[0].count, "キツネ13");
  expect("species[1] 合算", model.speciesList[1].name + model.speciesList[1].count, "アライグマ2");

  var w3entries = [];
  for (var i = 0; i < model.rosterEntries.length; i++) {
    if (model.rosterEntries[i].worker.name === "冬村　多才") w3entries.push(model.rosterEntries[i]);
  }
  expect("w3 entries", w3entries.length, 4);
  expect("w3[0].includePersonal", w3entries[0].includePersonal, true);
  expect("w3[1].includePersonal", w3entries[1].includePersonal, false);
  expect("w3[1].certNo (空欄)", w3entries[1].certNo, "");
  // わな猟ブロック: 用具 2 つ・わな猟免許・狩猟者登録あり
  expect("w3 trap tools", w3entries[0].method.tools.join(","), "はこわな,くくりわな");
  expect("w3 trap reg.no", w3entries[0].method.reg.no, "わ第222号");
  // 空気銃ブロック: 第二種銃猟 + 所持許可
  expect("w3 air lic.type", w3entries[1].method.lic.type, "第二種銃猟");
  expect("w3 air poss.no", w3entries[1].method.poss.no, "空第333号");
  expect("w3 air gunKind", w3entries[1].method.gunKind, "空気銃");
  // 銃 2 丁 → 2 ブロック（所持許可が別番号、免許は同一）
  expect("w3 gun1 poss.no", w3entries[2].method.poss.no, "散第555号");
  expect("w3 gun2 poss.no", w3entries[3].method.poss.no, "ラ第666号");
  expect("w3 gun1 lic.no", w3entries[2].method.lic.no, "石狩第7777号");
  expect("w3 gun2 lic.no", w3entries[3].method.lic.no, "石狩第7777号");
  expect("w3 gun1 tools", w3entries[2].method.tools.join(","), "銃(散弾銃)");
  expect("w3 gun2 gunKind", w3entries[3].method.gunKind, "ライフル銃");
  // 銃器使用ありなので申請書 E42 が立つ
  expect("gunPermitNote", model.gunPermitNote, CHO_NOTE_SEE_ROSTER_);
  expect("registrationNote", model.registrationNote, CHO_NOTE_SEE_ROSTER_);

  logResult_("model_multiMethod", errors.length === 0, errors.join(" / "));
  return errors.length === 0;
}

// ----- 実際に様式を生成（テンプレ設定済み環境のみ。未設定なら SKIP=PASS） -----
function testFill_golden() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(CHO_PROP_TEMPLATE_) || !props.getProperty(CHO_PROP_FOLDER_)) {
    Logger.log("[SKIP] fill_golden: テンプレート未設定のためスキップ（Cho_registerSettings 実行後に再実行）");
    return true;
  }
  var html = doPost(buildMockPostEvent_(Cho_buildGoldenPayload_())).getContent();
  var ok = html.indexOf("様式を作成しました") !== -1;
  logResult_("fill_golden", ok, html);
  if (ok) {
    var m = html.match(/href="([^"]+)"/);
    Logger.log("生成された様式: %s", m ? m[1].replace(/&amp;/g, "&") : "(リンク抽出失敗)");
  }
  return ok;
}

// ----- 異常系（gas_for_external_action/template/Test.gs と同じ） ---------------------
function testDoPost_missingPayload() {
  var html = doPost({ parameter: {} }).getContent();
  var ok = html.indexOf("payload パラメータがありません") !== -1;
  logResult_("missingPayload", ok, html);
  return ok;
}

function testDoPost_badJson() {
  var html = doPost({ parameter: { payload: "{ this is not json " } }).getContent();
  var ok = html.indexOf("JSON 解析に失敗") !== -1;
  logResult_("badJson", ok, html);
  return ok;
}

// ----- ヘルパ（template/Test.gs より） ---------------------------------------
function buildMockPostEvent_(payload) {
  var json = JSON.stringify(payload);
  return {
    parameter: { payload: json },
    parameters: { payload: [json] },
    postData: {
      type: "application/x-www-form-urlencoded",
      length: json.length,
      contents: "payload=" + encodeURIComponent(json)
    },
    contentLength: json.length
  };
}

function logResult_(name, ok, detail) {
  Logger.log("--------------------------------------------------");
  Logger.log("[%s] %s", ok ? "PASS" : "FAIL", name);
  if (!ok) {
    Logger.log("詳細 (先頭 600 文字): %s", String(detail).substring(0, 600));
  }
}


// #############################################################################
// ## TestPayload.gs
// #############################################################################

// =============================================================================
// TestPayload.gs — テスト用ゴールデン payload
//
// xlsx 原本の作例（秋はじめ / 春元負比呂・キツネ 10 頭・くくりわな・依頼書）を
// builder/src/features/preview/printDocument.js の buildRecordItems の出力形式に
// 合わせて手組みしたもの。
//
// ※ 本番投入前に Playground（管理者 > Playground > 外部アクション モード）で実レコードの
//    payload を取得し、question パスの実形（特に日付の文字列書式と
//    子フォームの方法ラベル「…名称)」の半角閉じ括弧）と突き合わせること。
//    差異があればこのファイルと mapping.gs のラベル定数を実測に合わせて直す。
// =============================================================================

function Cho_buildGoldenPayload_() {
  var S = CHO_L_CHILD_SPECIES_; // 捕獲等をする鳥獣又は採取等をする鳥類の卵の種類及び数量
  var M = CHO_L_CHILD_METHOD_;  // 捕獲等又は採取等の方法（使用する捕獲用具の名称) ※閉じ半角
  var child1 = "従事者情報/#1/";
  var child2 = "従事者情報/#2/";
  var wanaLic = M + "/わな猟/免許の必要性/必要/免許情報/";

  return {
    context: "record",
    formId: "1_aLScq4lAQA-TgI2rZqyzqXB6SDiENy4",
    formName: "鳥獣保護管理法許可申請",
    generatedAt: "2026-06-01T01:23:45.000Z",
    record: {
      id: "r_01TESTTESTTESTTEST_choju001",
      no: 1,
      items: [
        { question: "許可処分情報", value: "", type: "message" },
        { question: "許可処分情報/処分の種類", value: "許可", type: "radio" },
        { question: "許可処分情報/許可番号", value: "8-81", type: "text" },
        { question: "許可処分情報/許可年月日", value: "2026-06-01", type: "date" },
        { question: "申請者情報", value: "", type: "message" },
        { question: "申請者情報/申請者の個人・法人の別", value: "個人", type: "radio" },
        // 申請者の置換 4 項目は「わざと別人」の値にしてある。モデルは代表従事者（秋　はじめ）を
        // 優先する仕様（親 substitution が全レコード横断で他人を拾った既知バグへの回帰テスト）。
        { question: "申請者情報/申請者の個人・法人の別/個人/氏名", value: "鈴木新之助", type: "substitution" },
        { question: "申請者情報/申請者の個人・法人の別/個人/住所", value: "小樽市", type: "substitution" },
        { question: "申請者情報/申請者の個人・法人の別/個人/生年月日", value: "2026-05-31", type: "substitution" },
        { question: "申請者情報/申請者の個人・法人の別/個人/職業", value: "無味無臭", type: "substitution" },
        { question: "申請者情報/損害賠償能力", value: "狩猟登録者", type: "radio" },
        // 種数・方法の親入力欄は廃止（従事者の子レコードから集計する）。
        // 置換フィールド化した表示値が届いても無視されることを確認するため表示文字列を 1 件入れておく。
        { question: "捕獲しようとする鳥獣の種類及び数量", value: "キツネ 10頭", type: "substitution" },

        // ----- 従事者 #1（代表・わな猟） -----
        { question: child1 + "代表的個人", value: "はい", type: "radio" },
        { question: child1 + "氏名", value: "秋　はじめ", type: "text" },
        { question: child1 + "住所", value: "札幌市北区あいの里X条X丁目X-X", type: "text" },
        { question: child1 + "職業", value: "会社役員", type: "text" },
        { question: child1 + "生年月日", value: "1999-06-26", type: "date" },
        { question: child1 + S, value: "キツネ", type: "checkboxes" },
        { question: child1 + S + "/キツネ/捕獲頭数", value: "5", type: "number" },
        { question: child1 + M, value: "わな猟", type: "checkboxes" },
        { question: child1 + M + "/わな猟/わなの種類", value: "くくりわな", type: "checkboxes" },
        { question: child1 + M + "/わな猟/免許の必要性", value: "必要", type: "radio" },
        { question: child1 + wanaLic.slice(0, -1), value: "", type: "message" },
        { question: child1 + wanaLic + "許可権者", value: "北海道知事", type: "text" },
        { question: child1 + wanaLic + "交付年月日", value: "2025-04-01", type: "date" },
        { question: child1 + wanaLic + "許可番号", value: "石狩第0000号", type: "text" },
        { question: child1 + M + "/わな猟/狩猟者登録", value: "", type: "message" },
        { question: child1 + M + "/わな猟/狩猟者登録/登録の有無", value: "なし", type: "radio" },

        // ----- 従事者 #2（わな猟） -----
        { question: child2 + "代表的個人", value: "いいえ", type: "radio" },
        { question: child2 + "氏名", value: "春元　負比呂", type: "text" },
        { question: child2 + "住所", value: "札幌市北区あいの里X条X丁目X-X", type: "text" },
        { question: child2 + "職業", value: "会社員", type: "text" },
        { question: child2 + "生年月日", value: "1999-06-27", type: "date" },
        { question: child2 + S, value: "キツネ", type: "checkboxes" },
        { question: child2 + S + "/キツネ/捕獲頭数", value: "5", type: "number" },
        { question: child2 + M, value: "わな猟", type: "checkboxes" },
        { question: child2 + M + "/わな猟/わなの種類", value: "くくりわな", type: "checkboxes" },
        { question: child2 + M + "/わな猟/免許の必要性", value: "必要", type: "radio" },
        { question: child2 + wanaLic.slice(0, -1), value: "", type: "message" },
        { question: child2 + wanaLic + "許可権者", value: "北海道知事", type: "text" },
        { question: child2 + wanaLic + "交付年月日", value: "2025-04-01", type: "date" },
        { question: child2 + wanaLic + "許可番号", value: "石狩第0001号", type: "text" },
        { question: child2 + M + "/わな猟/狩猟者登録", value: "", type: "message" },
        { question: child2 + M + "/わな猟/狩猟者登録/登録の有無", value: "なし", type: "radio" },

        { question: "捕獲等又は採取等の目的", value: "管理（被害防止)", type: "text" },
        { question: "捕獲等又は採取等の期間", value: "", type: "message" },
        { question: "捕獲等又は採取等の期間/開始", value: "2026-06-01", type: "date" },
        { question: "捕獲等又は採取等の期間/終了", value: "2026-06-30", type: "date" },
        { question: "捕獲等又は採取等の区域", value: "", type: "message" },
        { question: "捕獲等又は採取等の区域/所在地", value: "札幌市白石区小坂９丁目９番9号", type: "text" },
        { question: "捕獲等又は採取等の区域/" + CHO_L_AREA7_, value: "公道", type: "checkboxes" },
        { question: CHO_L_DISPOSAL_, value: "焼却", type: "checkboxes" },
        { question: CHO_L_CERT_OR_REQ_, value: "依頼書", type: "radio" },
        { question: CHO_L_CERT_OR_REQ_ + "/依頼書/依頼者住所", value: "札幌市中央区北１条西２丁目", type: "text" },
        { question: CHO_L_CERT_OR_REQ_ + "/依頼書/依頼者氏名", value: "札幌市長　秋元　克広", type: "text" },
        { question: CHO_L_CERT_OR_REQ_ + "/依頼書/" + CHO_L_PERIOD_, value: "", type: "message" },
        { question: CHO_L_CERT_OR_REQ_ + "/依頼書/" + CHO_L_PERIOD_ + "/開始", value: "2026-06-01", type: "date" },
        { question: CHO_L_CERT_OR_REQ_ + "/依頼書/" + CHO_L_PERIOD_ + "/終了", value: "2026-06-30", type: "date" },
        { question: CHO_L_CERT_OR_REQ_ + "/依頼書/被害状況", value: "住民へのつきまとい等", type: "text" },
        { question: CHO_L_CERT_OR_REQ_ + "/依頼書/依頼した理由", value: "つきまとい等の生活環境被害防止のため", type: "text" },
        { question: CHO_L_REMARKS_, value: "", type: "text" }
      ]
    }
  };
}

// 方法 3 種（わな猟 2 用具 + 空気銃 + 散弾銃・ライフル銃 2 丁）を持つ従事者の items。
// 名簿展開（1 + 1 + 2 = 4 ブロック、2 ブロック目以降の個人欄空白）の検証用。
function Cho_buildMultiMethodWorkerItems_(childPrefix) {
  var S = CHO_L_CHILD_SPECIES_;
  var M = CHO_L_CHILD_METHOD_;
  var p = childPrefix; // 例: "従事者情報/#3/"
  var guns = p + M + "/散弾銃・ライフル銃/";
  return [
    { question: p + "代表的個人", value: "いいえ", type: "radio" },
    { question: p + "氏名", value: "冬村　多才", type: "text" },
    { question: p + "住所", value: "札幌市南区真駒内9条9丁目", type: "text" },
    { question: p + "職業", value: "猟師", type: "text" },
    { question: p + "生年月日", value: "1980-01-15", type: "date" },
    { question: p + S, value: "キツネ, アライグマ", type: "checkboxes" },
    { question: p + S + "/キツネ/捕獲頭数", value: "3", type: "number" },
    { question: p + S + "/アライグマ/捕獲頭数", value: "2", type: "number" },
    { question: p + M, value: "わな猟, 空気銃, 散弾銃・ライフル銃", type: "checkboxes" },
    // わな猟（はこわな + くくりわな = 1 ブロックに用具 2 つ）
    { question: p + M + "/わな猟/わなの種類", value: "はこわな, くくりわな", type: "checkboxes" },
    { question: p + M + "/わな猟/免許の必要性", value: "必要", type: "radio" },
    { question: p + M + "/わな猟/免許の必要性/必要/免許情報/許可権者", value: "北海道知事", type: "text" },
    { question: p + M + "/わな猟/免許の必要性/必要/免許情報/交付年月日", value: "2024-04-01", type: "date" },
    { question: p + M + "/わな猟/免許の必要性/必要/免許情報/許可番号", value: "石狩第1111号", type: "text" },
    { question: p + M + "/わな猟/狩猟者登録/登録の有無", value: "あり", type: "radio" },
    { question: p + M + "/わな猟/狩猟者登録/登録の有無/あり/交付年月日", value: "2025-10-01", type: "date" },
    { question: p + M + "/わな猟/狩猟者登録/登録の有無/あり/番号", value: "わ第222号", type: "text" },
    // 空気銃
    { question: p + M + "/空気銃/所持許可/所持許可証番号", value: "空第333号", type: "text" },
    { question: p + M + "/空気銃/所持許可/交付年月日", value: "2023-07-01", type: "date" },
    { question: p + M + "/空気銃/第二種銃猟免許/許可権者", value: "北海道知事", type: "text" },
    { question: p + M + "/空気銃/第二種銃猟免許/許可番号", value: "石狩第4444号", type: "text" },
    { question: p + M + "/空気銃/第二種銃猟免許/交付年月日", value: "2023-06-01", type: "date" },
    { question: p + M + "/空気銃/狩猟者登録/登録の有無", value: "なし", type: "radio" },
    // 散弾銃・ライフル銃（2 丁 → 所持許可が別 → 2 ブロック）
    { question: guns + "鉄砲の種類", value: "散弾銃, ライフル銃", type: "checkboxes" },
    { question: guns + "鉄砲の種類/散弾銃/所持許可/所持許可証番号", value: "散第555号", type: "text" },
    { question: guns + "鉄砲の種類/散弾銃/所持許可/交付年月日", value: "2022-05-01", type: "date" },
    { question: guns + "鉄砲の種類/ライフル銃/所持許可/所持許可証番号", value: "ラ第666号", type: "text" },
    { question: guns + "鉄砲の種類/ライフル銃/所持許可/交付年月日", value: "2022-05-02", type: "date" },
    { question: guns + "第一種銃猟免許/許可権者", value: "北海道知事", type: "text" },
    { question: guns + "第一種銃猟免許/許可番号", value: "石狩第7777号", type: "text" },
    { question: guns + "第一種銃猟免許/交付年月日", value: "2022-04-01", type: "date" },
    { question: guns + "狩猟者登録/登録の有無", value: "あり", type: "radio" },
    { question: guns + "狩猟者登録/登録の有無/あり/交付年月日", value: "2025-10-15", type: "date" },
    { question: guns + "狩猟者登録/登録の有無/あり/番号", value: "銃第888号", type: "text" }
  ];
}
//
function Do_Settings_() {
    Cho_registerSettings("<templateFileID>", "outputFolderId",
  "keyward");
  }


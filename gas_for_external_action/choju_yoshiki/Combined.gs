// #############################################################################
// ## Code.gs
// #############################################################################

// =============================================================================
// 鳥獣保護管理法様式 ↔ フォーム 双方向ブリッジ Web App (Nested Form Builder 連携)
//
// 2 つの役割を 1 デプロイで担う:
//   (1) 書き出し（フォーム→Excel）: レコード詳細の 外部アクション ボタンが
//       payload(JSON) を POST → 新 7 シート様式を複製し全シートに値を書き込む。
//   (2) 取り込み（Excel→フォーム）: doGet のアップロードUIで様式 xlsx を Drive に
//       上げ、mode=import の POST で解析 → uploadRecords(JSON) を返す。
//       ユーザーは本体アプリ側（Playground/取り込みUI）で sync_records に流す。
//
// 設計の核（様式 申請書 L6/L7/L8 の凡例）:
//   黄 FFFFFF00 = 正として吸い取る（取り込みで権威・書き出しでリテラル）
//   桃 FFEAD1DC = 確認用に吸い取る（名簿の集計。取り込みは照合のみ）
//   緑 FF00B050 = 掃き出し場所（出力専用。取り込みは無視）
// 数式は一切使わず全部リテラル値を書く（雛形の数式は「どこへ何を書くか」の仕様書）。
// =============================================================================

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
    if (payload.data && String(payload.data.nfbProbe) === "1") {
      var probeSecret = PropertiesService.getScriptProperties().getProperty("NFB_EXT_ACTION_SECRET") || "";
      var probeNonce = String(payload.data.nonce || "");
      var probeResp = (probeSecret === "" || probeNonce === "")
        ? { ok: true, nfbExternalAction: false }
        : { ok: true, nfbExternalAction: true, signature: Recv_hmacHex_(probeNonce, probeSecret) };
      return ContentService.createTextOutput(JSON.stringify(probeResp)).setMimeType(ContentService.MimeType.JSON);
    }
    var data = payload.data;
    // 取り込み（Excel→フォーム）: JSON で uploadRecords を返す（常に JSON）。
    if (String(data.mode || (e && e.parameter && e.parameter.mode) || "") === "import") {
      return Cho_renderImport_(Cho_handleImport_(data, e));
    }
    // 書き出し（フォーム→Excel）: レコード単位の 外部アクション 専用。
    if (String(data.context || "") !== "record") {
      var ctxMsg = "このウェブアプリはレコード単位の 外部アクション（context=record）または mode=import 専用です。受信 context: " + String(data.context || "(なし)");
      return Cho_render_(relay, { ok: false, title: "エラー", message: ctxMsg, html: "<p>" + escapeHtml_(ctxMsg) + "</p>" });
    }
    return Cho_render_(relay, Cho_handleRecord_(data));
  } catch (err) {
    var em = String(err && err.message ? err.message : err);
    return Cho_render_(relay, { ok: false, title: "予期せぬエラー", message: em, html: "<p>" + escapeHtml_(em) + "</p>" });
  }
}

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

// 取り込み結果は常に JSON（uploadRecords をブラウザ側 JS が拾って本体へ渡す）。
function Cho_renderImport_(result) {
  return ContentService.createTextOutput(JSON.stringify(result || { ok: false })).setMimeType(ContentService.MimeType.JSON);
}

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

// GET: セットアップ状態の確認 ＋ 取り込み用アップロードUI。
// 構造 HTML タグはリテラルで書くが、これは doGet の自前ページ（本体フロントの単一HTML
// 配信経路とは別物）なので問題ない。
function doGet(e) {
  var props = PropertiesService.getScriptProperties();
  var ready = props.getProperty(CHO_PROP_TEMPLATE_) && props.getProperty(CHO_PROP_FOLDER_);
  var page = (e && e.parameter && e.parameter.page) || "";
  if (page === "import") {
    return Cho_renderUploadPage_();
  }
  return renderHtml_(
    "鳥獣保護管理法様式 生成 / 取り込み",
    "<p>この URL は Nested Form Builder と連携します。</p>" +
    "<ul>" +
    "<li><strong>書き出し</strong>: レコード詳細の 外部アクション ボタンから POST されると様式を生成します。</li>" +
    "<li><strong>取り込み</strong>: <a href=\"?page=import\">様式アップロードページ</a> から xlsx を解析してフォーム用レコードに変換します。</li>" +
    "</ul>" +
    "<p>セットアップ状態: " + (ready ? "テンプレート設定済み" : "<strong>未設定</strong>（Cho_registerSettings を実行）") + "</p>",
    false
  );
}

function Cho_checkAccessKey_(e) {
  var expected = PropertiesService.getScriptProperties().getProperty(CHO_PROP_KEY_);
  if (!expected) return "";
  var actual = e && e.parameter ? String(e.parameter.k || "") : "";
  return actual === expected ? "" : "アクセスキーが一致しません。URL の ?k= パラメータを確認してください。";
}

// ----- 書き出し（フォーム→Excel）-----
function Cho_handleRecord_(data) {
  var record = (data && data.record) || {};
  var model = Cho_buildModel_(data);
  var file = Cho_createOutputCopy_(record.no);
  var ss = SpreadsheetApp.openById(file.getId());
  try {
    Cho_fillAll_(ss, model);
    SpreadsheetApp.flush();
  } catch (err) {
    var em = String(err && err.message ? err.message : err);
    return {
      ok: false, title: "エラー",
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
  html += "<tr><th>従事者数</th><td>" + escapeHtml_(String(model.workerCount)) + " 名</td></tr>";
  html += "</tbody></table>";
  var warnText = "";
  if (model.warnings && model.warnings.length > 0) {
    html += '<div class="warn"><strong>警告</strong><ul>';
    for (var i = 0; i < model.warnings.length; i++) html += "<li>" + escapeHtml_(model.warnings[i]) + "</li>";
    html += "</ul></div>";
    warnText = "（警告 " + model.warnings.length + " 件あり）";
  }
  return { ok: true, title: "様式を作成しました", message: "様式を作成しました: " + file.getName() + warnText, openUrl: ss.getUrl(), html: html };
}

function parsePayload_(e) {
  var params = (e && e.parameter) || {};
  var raw = params.payload;
  if (raw == null || String(raw) === "") return { ok: false, error: "payload パラメータがありません。" };
  var data;
  try { data = JSON.parse(String(raw)); }
  catch (parseErr) { return { ok: false, error: "payload の JSON 解析に失敗しました: " + (parseErr && parseErr.message ? parseErr.message : parseErr) }; }
  if (!data || typeof data !== "object") return { ok: false, error: "payload がオブジェクトではありません。" };
  return { ok: true, data: data };
}

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
    'p,li{font-size:14px;line-height:1.6;margin:8px 0;}' +
    '.small{font-size:12px;color:#5f6368;margin-top:16px;}' +
    '.warn{background:#FEF7E0;border:1px solid #F9AB00;border-radius:6px;padding:8px 12px;margin:12px 0;font-size:13px;}' +
    '.warn ul{margin:6px 0 0;padding-left:20px;}' +
    'table{border-collapse:collapse;font-size:13px;background:#fff;}table.kv{margin:8px 0;}' +
    'th,td{border:1px solid #dadce0;padding:6px 10px;text-align:left;vertical-align:top;}' +
    'table.kv th{background:#f1f3f4;white-space:nowrap;width:1%;}a{color:#1a73e8;}' +
    '</style></head><body><div class="card"><h1>' + escapeHtml_(title) + '</h1>' + bodyHtml +
    '<p class="small">このタブは閉じて差し支えありません。</p></div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function escapeHtml_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}


// #############################################################################
// ## payload.gs
// #############################################################################

function Cho_splitPath_(text) {
  var str = String(text == null ? "" : text);
  var tokens = [], current = "", escaping = false;
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

function Cho_indexItems_(items) {
  var map = {}, list = [];
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i] || {};
    var q = String(it.question == null ? "" : it.question);
    if (!(q in map)) map[q] = it.value;
    list.push(it);
  }
  return {
    list: list,
    get: function (path) { var v = map[path]; return v == null ? "" : String(v); },
    has: function (path) { return path in map; }
  };
}

function Cho_splitParentAndChildren_(items) {
  var parentItems = [], childMap = {}, childOrder = [];
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i] || {};
    var segs = Cho_splitPath_(it.question);
    if (segs.length >= 3 && segs[0] === CHO_L_FORMLINK_ && segs[1].charAt(0) === "#") {
      var marker = segs[1];
      if (!childMap[marker]) { childMap[marker] = []; childOrder.push(marker); }
      childMap[marker].push({ question: segs.slice(2).join("/"), value: it.value, type: it.type });
    } else {
      parentItems.push(it);
    }
  }
  var children = [];
  for (var c = 0; c < childOrder.length; c++) children.push({ marker: childOrder[c], items: childMap[childOrder[c]] });
  return { parentItems: parentItems, children: children };
}

function Cho_splitChecks_(value) {
  var s = String(value == null ? "" : value);
  if (!s) return [];
  var parts = s.split(", "), out = [];
  for (var i = 0; i < parts.length; i++) { var p = parts[i].replace(/^\s+|\s+$/g, ""); if (p) out.push(p); }
  return out;
}

// "YYYY-MM-DD" / "YYYY/MM/DD" → Date。パース不可なら元文字列（空は ""）。
function Cho_toDateOrText_(value) {
  if (value instanceof Date) return value;
  var s = String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
  if (!s) return "";
  var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (!m) return s;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// Date → "YYYY-MM-DD"（payload 用の canonical 文字列）。Date 以外は素通し。
function Cho_dateToCanonical_(value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) return String(value == null ? "" : value);
  var y = value.getFullYear(), mo = value.getMonth() + 1, d = value.getDate();
  return y + "-" + (mo < 10 ? "0" + mo : mo) + "-" + (d < 10 ? "0" + d : d);
}

// Sheets のシリアル値（1899-12-30 起点）→ Date。Date はそのまま。数字でなければ ""/元値。
function Cho_serialOrDateToDate_(value) {
  if (value instanceof Date) return value;
  if (typeof value === "number" && isFinite(value)) {
    var ms = Math.round((value - 25569) * 86400000); // 25569 = 1970-01-01 のシリアル
    return new Date(ms);
  }
  return Cho_toDateOrText_(value);
}

function Cho_toNumberOrText_(value) {
  if (typeof value === "number") return value;
  var s = String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
  if (!s) return "";
  var n = Number(s);
  return isNaN(n) ? s : n;
}

function Cho_formatWareki_(value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) return String(value == null ? "" : value);
  var y = value.getFullYear(), mo = value.getMonth() + 1, d = value.getDate();
  var era, eraYear;
  if (y >= 2019) { era = "令和"; eraYear = y - 2018; }
  else if (y >= 1989) { era = "平成"; eraYear = y - 1988; }
  else { era = "昭和"; eraYear = y - 1925; }
  return era + (eraYear === 1 ? "元" : String(eraYear)) + "年" + mo + "月" + d + "日";
}


// #############################################################################
// ## cellmap.gs — 新 7 シート様式の単一セルマップ（取り込み・書き出し両用の契約）
// #############################################################################
//
// 典拠: form_test/鳥獣保護管理法様式_個人想定.xlsx / _法人想定.xlsx
//       （scripts/extract_cellmap.py → scripts/out/cellmap_seed.tsv）。
// 色は設計時の注釈。実行時は固定番地を引く。番地を直すときはこのセクションだけ編集する。

// ----- フォームのラベル定数（ライブ JSON が正。半角/全角括弧の罠を 1 箇所に隔離）-----
// 親フォーム「鳥獣保護管理法許可申請」
var CHO_FORM_PARENT_ID_ = "1_aLScq4lAQA-TgI2rZqyzqXB6SDiENy4";
var CHO_FORM_CHILD_ID_ = "1Eh5p3Q5IMQEfi-7TiUV8ZZ8z_4HKW0Zj";
var CHO_L_FORMLINK_ = "従事者情報";
var CHO_L_DISPOSAL_ = "捕獲等又は採取等をしたあとの処置";
var CHO_L_PURPOSE_ = "捕獲等又は採取等の目的";
var CHO_L_PERIOD_ = "捕獲等又は採取等の期間";
var CHO_L_AREA_ = "捕獲等又は採取等の区域";
var CHO_L_AREA7_ = "規則第７条第１項第７号に係る場所等の位置、名称及び理由";
var CHO_L_APPLICANT_ = "申請者情報";
var CHO_L_APPLICANT_TYPE_ = "申請者の個人・法人の別";
var CHO_L_PERMIT_GROUP_ = "許可処分情報";
var CHO_L_REMARKS_ = "備考";
// 親フォームのこの message の「ラベル」は現在 "証明書"（Excel の対応シート名は "事由書"。両者は別名前空間）。
var CHO_L_JIYU_ = "証明書"; // 子: 被害原因の鳥獣 / 被害者 / 被害発生の時期 / 被害発生区域（場所）/ 被害の内容 / 捕獲等又は採取等を行う理由 / 備考
var CHO_L_JIYU_CAUSE_ = "被害原因の鳥獣";
var CHO_L_JIYU_VICTIM_ = "被害者";
var CHO_L_JIYU_TIME_ = "被害発生の時期";
var CHO_L_JIYU_AREA_ = "被害発生区域（場所）";
var CHO_L_JIYU_CONTENT_ = "被害の内容";
var CHO_L_JIYU_REASON_ = "捕獲等又は採取等を行う理由";
// 子フォーム「従事者情報」
var CHO_L_CHILD_METHOD_ = "捕獲等又は採取等の方法（使用する捕獲用具の名称)"; // 閉じ括弧が半角!
var CHO_L_CHILD_SPECIES_ = "捕獲等をする鳥獣又は採取等をする鳥類の卵の種類及び数量";
var CHO_L_REP_ = "代表的個人";

// ----- 種ごとの数量単位（鳥類=羽 / 獣類=頭）と「卵」を採る鳥 -----
var CHO_SPECIES_UNIT_ = {
  "キジバト": "羽", "カワラバト": "羽", "スズメ": "羽", "ニュウナイスズメ": "羽",
  "ハシボソガラス": "羽", "ハシブトガラス": "羽",
  "キツネ": "頭", "ノイヌ": "頭", "ノネコ": "頭", "アライグマ": "頭", "トガリネズミ科・ネズミ科": "頭"
};
// 申請書 種数欄の固定レイアウト（行 18〜26）。count=捕獲頭数の書込先, egg=採取卵数の書込先。
// 鳥(bird)は count/egg 両方、獣は count のみ。キツネ/ノイヌ・ノネコ/アライグマ は左右 2 種を 1 行に置く。
var CHO_APP_SPECIES_ = [
  { sp: "キジバト",            nameCell: "E18", count: "F18", eggLabelCell: "H18", egg: "I18", bird: true },
  { sp: "カワラバト",          nameCell: "E19", count: "F19", eggLabelCell: "H19", egg: "I19", bird: true },
  { sp: "スズメ",              nameCell: "E20", count: "F20", eggLabelCell: "H20", egg: "I20", bird: true },
  { sp: "ニュウナイスズメ",     nameCell: "E21", count: "F21", eggLabelCell: "H21", egg: "I21", bird: true },
  { sp: "ハシボソガラス",       nameCell: "E22", count: "F22", eggLabelCell: "H22", egg: "I22", bird: true },
  { sp: "ハシブトガラス",       nameCell: "E23", count: "F23", eggLabelCell: "H23", egg: "I23", bird: true },
  { sp: "キツネ",              nameCell: "E24", count: "F24" },
  { sp: "ノイヌ",              nameCell: "H24", count: "I24" },
  { sp: "ノネコ",              nameCell: "E25", count: "F25" },
  { sp: "アライグマ",          nameCell: "H25", count: "I25" },
  { sp: "トガリネズミ科・ネズミ科", nameCell: "E26", count: "F26" }
];
// 種の表示順（フォーム選択肢順）
var CHO_SPECIES_ORDER_ = [
  "キジバト", "カワラバト", "スズメ", "ニュウナイスズメ", "ハシボソガラス", "ハシブトガラス",
  "キツネ", "ノイヌ", "ノネコ", "アライグマ", "トガリネズミ科・ネズミ科"
];

// ----- 捕獲用具（名簿 P 列・申請書 E30 方法）。新様式は生ラベルをそのまま使う -----
// （旧 "銃(空気銃)" 等の正規化は廃止。子フォーム道具/銃の種類のラベルが正）
var CHO_TOOL_ORDER_ = [
  "手捕り", "くくりわな", "はこわな", "はこおとし", "囲いわな",
  "むそう網", "はり網", "つき網", "なげ網", "空気銃", "散弾銃", "ライフル銃"
];

// ----- 処置（フォーム: 焼却/廃棄/埋設、複数可）→ 申請書 E31 はリテラル結合 -----
var CHO_DISPOSAL_JOIN_ = "・";

// ----- 名簿（従事者名簿）の幾何。1 ブロック = 1 従事者。9 行 × 10 ブロック（行 5〜94）-----
var CHO_ROSTER_ = {
  sheetName: "従事者名簿",
  firstRow: 5, blockHeight: 9, blockCount: 10,
  cols: {
    certNo: "E",                                  // 緑（許可番号。出力時は空のまま）
    address: "F", name: "G", occupation: "H", birth: "I", // 黄（9 行結合・先頭セル）
    speciesName: "J", speciesCount: "K", speciesUnit: "L",
    species2Name: "M", species2Count: "N", species2Unit: "O",
    tool: "P",                                    // 行ごとに積層（結合しない）
    licType: "Q", licPref: "R", licNo: "S", licDate: "T",   // 狩猟免許
    regType: "U", regNo: "V", regDate: "W",                 // 狩猟者登録
    gunPermitNo: "X", gunPermitDate: "Y", gunKind: "Z",     // 銃器
    remarks: "AA"
  }
};

// ----- 事由書 被害原因の鳥獣（○ を打つセル）。左列=F / 右列(ノイヌ・アライグマ)=I -----
var CHO_JIYU_SPECIES_MARK_ = {
  "キジバト": "F13", "カワラバト": "F14", "スズメ": "F15", "ニュウナイスズメ": "F16",
  "ハシボソガラス": "F17", "ハシブトガラス": "F18", "キツネ": "F19",
  "ノイヌ": "I19", "ノネコ": "F20", "アライグマ": "I20", "トガリネズミ科・ネズミ科": "F21"
};
// 事由書 被害者 区分（フォーム値 ↔ 様式表記）
var CHO_VICTIM_TO_SHEET_ = { "申請者": "1.申請者自身", "申請者以外": "2.申請者以外" };
var CHO_VICTIM_FROM_SHEET_ = { "1.申請者自身": "申請者", "1": "申請者", "2.申請者以外": "申請者以外", "2": "申請者以外" };

// ----- 申請書 規則第7条 区分の ○ グリッド（フォーム選択肢 → ○ を打つセル）-----
// フォーム側を様式の区分ラベルに合わせたので 1:1（ロッシーなし）。
var CHO_AREA7_MARK_ = {
  "鳥獣保護区": "G32",
  "社寺境内": "J32",
  "休猟区": "G33",
  "墓地": "J33",
  "公道": "G34",
  "特定猟具使用禁止区域": "J34",
  "自然公園法特別保護地区": "G35",
  "特定猟具使用制限区域": "J35",
  "都市計画法都市計画施設である公共空地等": "G36",
  "猟区": "J36",
  "自然環境保全法原生自然環境保全地域": "G37"
};

// ----- 7 シート（テンプレ清掃で残すべきシート）。旧 13 枚から刷新 -----
var CHO_SHEETS_ = ["申請書", "従事者名簿", "事由書", "許可証", "振興局宛通知", "警察宛通知", "従事者証"];
// 旧テンプレ由来で削除すべきシート
var CHO_SHEETS_TO_DELETE_ = ["Sheet1", "申請内容", "従事者名簿 (法人)", "許可証個人", "許可証法人",
  "証明書", "依頼書", "許可伺書", "交付通知書", "許可審査表", "報告書添付", "結果報告書", "わな"];

// 申請書のスカラー書込先（model キー → セル）。緑シートはこの値を投影する。
var CHO_APP_SCALARS_ = [
  { cell: "H2", key: "applicationDate" },
  { cell: "F6", key: "applicantAddress" },
  { cell: "F8", key: "applicantName" },        // 個人=氏名 / 法人=法人名
  { cell: "F10", key: "applicantOccupation" }, // 個人=職業 / 法人=代表者名
  { cell: "F11", key: "applicantBirth" },      // 個人=生年月日 / 法人=空
  { cell: "J9", key: "othersCountText" },      // ほかN名 の N（個人複数時）
  { cell: "E27", key: "purpose" },
  { cell: "E28", key: "periodStart" },
  { cell: "H28", key: "periodEnd" },
  { cell: "E29", key: "areaLocation" },
  { cell: "E30", key: "methodText" },
  { cell: "E31", key: "disposalText" }
];

// 緑シートへの投影（申請書セル → 出力先セル）。office 割当（許可番号等）は空のまま。
// 許可証は申請書を 1:1 参照（種数 9 行は行平行）。
function Cho_kyokashoRefs_() {
  var refs = [
    { dst: "H4", src: "E28" }, { dst: "H5", src: "H28" },
    { dst: "G12", src: "F6" }, { dst: "G13", src: "applicantNameComposed" },
    { dst: "G14", src: "F11" },
    { dst: "G26", src: "E27" }, { dst: "G28", src: "E29" }, { dst: "G31", src: "E30" }, { dst: "G33", src: "E31" },
    { dst: "G35", src: "permitConditions" }
  ];
  for (var i = 0; i < 9; i++) { // 種数 G17:K25 ← 申請書 E18:E26
    refs.push({ dst: "G" + (17 + i), src: "E" + (18 + i) });
    refs.push({ dst: "H" + (17 + i), src: "F" + (18 + i) });
    refs.push({ dst: "J" + (17 + i), src: "H" + (18 + i) });
    refs.push({ dst: "K" + (17 + i), src: "I" + (18 + i) });
  }
  return refs;
}
// 通知（振興局・警察 共通レイアウト）への投影。
function Cho_tsuchiRefs_() {
  var refs = [
    { dst: "C13", src: "F6" }, { dst: "C14", src: "applicantNameComposed" },
    { dst: "C28", src: "E27" }, { dst: "C31", src: "E28" }, { dst: "F31", src: "H28" },
    { dst: "C34", src: "E29" }, { dst: "C37", src: "E30" }
  ];
  for (var i = 0; i < 9; i++) { // 種数 C19:G27 ← 申請書 E18:E26
    refs.push({ dst: "C" + (19 + i), src: "E" + (18 + i) });
    refs.push({ dst: "D" + (19 + i), src: "F" + (18 + i) });
    refs.push({ dst: "F" + (19 + i), src: "H" + (18 + i) });
    refs.push({ dst: "G" + (19 + i), src: "I" + (18 + i) });
  }
  return refs;
}
// 従事者証（代表従事者 1 名分。雛形に数式が無いためラベルから手対応）。
var CHO_JUJISHA_REFS_ = [
  { dst: "F4", src: "E28" }, { dst: "F5", src: "H28" },
  { dst: "D18", src: "F6" }, { dst: "D25", src: "applicantNameComposed" }, { dst: "D32", src: "F11" },
  { dst: "K29", src: "E27" }, { dst: "K32", src: "E29" }, { dst: "K36", src: "E30" }, { dst: "K39", src: "permitConditions" }
  // K14(許可証番号)/K17(法人名) は office/法人時。種数 K20:P28 は事後で空のまま。
];

// 空気銃の免許種類(select) → 狩猟免許の種類（名簿 Q 列）
var CHO_GUN_LIC_ = { "第一種銃猟免許": "第一種銃猟", "第二種銃猟免許": "第二種銃猟" };

// 免許/登録番号はフォーム側を「〇〇第xxxx号」一本（番号接頭語フィールド廃止）にしたので、
// Excel 名簿 S/V 列の値とそのまま一致する（接頭語の分解/結合は不要）。

// #############################################################################
// ## domain.gs — payload → 書き出し用モデル（新 7 シート様式）
// #############################################################################

function Cho_buildModel_(payload) {
  var record = (payload && payload.record) || {};
  var split = Cho_splitParentAndChildren_(record.items || []);
  var idx = Cho_indexItems_(split.parentItems);
  var warnings = [];

  var workers = [];
  for (var i = 0; i < split.children.length; i++) {
    workers.push(Cho_parseWorker_(Cho_indexItems_(split.children[i].items)));
  }
  if (workers.length === 0) {
    warnings.push("従事者情報の子レコードが届いていません。種数・方法・申請者（個人）はほぼ空になります。");
  }
  var repWorker = null;
  for (var r = 0; r < workers.length; r++) { if (workers[r].isRep) { repWorker = workers[r]; break; } }
  if (!repWorker && workers.length > 0) repWorker = workers[0];
  var workerCount = workers.length;

  // 申請者（個人=代表従事者から導出 / 法人=フォーム直接入力）
  var applicantType = idx.get(CHO_L_APPLICANT_ + "/" + CHO_L_APPLICANT_TYPE_) || "個人";
  var pBase = CHO_L_APPLICANT_ + "/" + CHO_L_APPLICANT_TYPE_ + "/個人/";
  var cBase = CHO_L_APPLICANT_ + "/" + CHO_L_APPLICANT_TYPE_ + "/法人/";
  var applicantName, applicantAddress, applicantOccupation = "", applicantBirth = "";
  if (applicantType === "法人") {
    applicantName = idx.get(cBase + "法人名");
    applicantAddress = idx.get(cBase + "住所");
    applicantOccupation = idx.get(cBase + "代表者名"); // 申請書 F10 = 代表者名
  } else {
    applicantName = (repWorker ? repWorker.name : "") || idx.get(pBase + "氏名");
    applicantAddress = (repWorker ? repWorker.address : "") || idx.get(pBase + "住所");
    applicantOccupation = (repWorker ? repWorker.occupation : "") || idx.get(pBase + "職業");
    applicantBirth = (repWorker ? repWorker.birth : "") || Cho_toDateOrText_(idx.get(pBase + "生年月日"));
  }
  var othersCount = workerCount > 1 ? workerCount - 1 : "";
  var applicantNameComposed = (applicantType === "法人")
    ? applicantName
    : (applicantName + (workerCount > 1 ? "（ほか" + (workerCount - 1) + "名）" : ""));

  // 種数（従事者ごとを種名単位で合算）
  var totals = Cho_aggregateSpecies_(workers);

  // 方法（全従事者の用具の和集合。CHO_TOOL_ORDER_ 順、生ラベル）
  var methodText = Cho_unionTools_(workers).join(",");

  // 処置
  var disposals = Cho_splitChecks_(idx.get(CHO_L_DISPOSAL_));
  var disposalText = disposals.join(CHO_DISPOSAL_JOIN_);

  // 区域・規則7条
  var areaLocation = idx.get(CHO_L_AREA_ + "/所在地");
  var area7Path = CHO_L_AREA_ + "/" + CHO_L_AREA7_;
  var area7Selected = Cho_splitChecks_(idx.get(area7Path));

  // 事由書
  var jBase = CHO_L_JIYU_ + "/";
  var jiyuVictim = idx.get(jBase + CHO_L_JIYU_VICTIM_);

  var permitConditions = idx.get(CHO_L_PERMIT_GROUP_ + "/処分の種類/条件付き許可/許可条件");
  var applicationDate = Cho_toDateOrText_(String(payload.generatedAt || "").slice(0, 10));

  return {
    warnings: warnings,
    workers: workers,
    workerCount: workerCount,
    totals: totals,

    applicationDate: applicationDate,
    applicantType: applicantType,
    applicantAddress: applicantAddress,
    applicantName: applicantName,
    applicantOccupation: applicantType === "法人" ? applicantOccupation : applicantOccupation,
    applicantBirth: applicantType === "法人" ? "" : applicantBirth,
    othersCountText: othersCount,
    applicantNameComposed: applicantNameComposed,

    purpose: idx.get(CHO_L_PURPOSE_),
    periodStart: Cho_toDateOrText_(idx.get(CHO_L_PERIOD_ + "/開始")),
    periodEnd: Cho_toDateOrText_(idx.get(CHO_L_PERIOD_ + "/終了")),
    areaLocation: areaLocation,
    area7Selected: area7Selected,
    methodText: methodText,
    disposalText: disposalText,
    permitConditions: permitConditions,

    jiyuCause: Cho_splitChecks_(idx.get(jBase + CHO_L_JIYU_CAUSE_)),
    jiyuVictim: jiyuVictim,
    jiyuVictimAddr: idx.get(jBase + CHO_L_JIYU_VICTIM_ + "/申請者以外/住所"),
    jiyuVictimName: idx.get(jBase + CHO_L_JIYU_VICTIM_ + "/申請者以外/氏名"),
    jiyuTime: idx.get(jBase + CHO_L_JIYU_TIME_),
    jiyuArea: idx.get(jBase + CHO_L_JIYU_AREA_),
    jiyuContent: idx.get(jBase + CHO_L_JIYU_CONTENT_),
    jiyuReason: idx.get(jBase + CHO_L_JIYU_REASON_),
    jiyuRemarks: idx.get(jBase + CHO_L_REMARKS_)
  };
}

// 従事者 1 名 → { name, address, occupation, birth, isRep, species[], methods[] }
// methods[] は「名簿 1 行分」= { tool, licType, licPref, licNo, licDate, regType, regNo, regDate, gunPermitNo, gunPermitDate, gunKind }
function Cho_parseWorker_(idx) {
  var M = CHO_L_CHILD_METHOD_;
  var worker = {
    name: idx.get("氏名"), address: idx.get("住所"), occupation: idx.get("職業"),
    birth: Cho_toDateOrText_(idx.get("生年月日")), isRep: idx.get(CHO_L_REP_) === "はい",
    species: [], methods: []
  };

  var spNames = Cho_splitChecks_(idx.get(CHO_L_CHILD_SPECIES_));
  for (var s = 0; s < spNames.length; s++) {
    var sp = spNames[s], base = CHO_L_CHILD_SPECIES_ + "/" + sp + "/";
    worker.species.push({
      name: sp,
      count: Cho_toNumberOrText_(idx.get(base + "捕獲頭数")),
      eggCount: Cho_toNumberOrText_(idx.get(base + "採取卵数")),
      unit: CHO_SPECIES_UNIT_[sp] || "頭"
    });
  }

  function reg(branchBase, type) {
    if (idx.get(branchBase + "/狩猟者登録/登録の有無") !== "あり") return null;
    var rb = branchBase + "/狩猟者登録/登録の有無/あり/";
    return { type: type, no: idx.get(rb + "番号"), date: Cho_toDateOrText_(idx.get(rb + "交付年月日")) };
  }
  function lic(licBase, type) {
    return { type: type, pref: idx.get(licBase + "/都道府県"), no: idx.get(licBase + "/番号"), date: Cho_toDateOrText_(idx.get(licBase + "/交付年月日")) };
  }
  function row(tool, l, rg, poss, gunKind) {
    return {
      tool: tool,
      licType: l ? l.type : "", licPref: l ? l.pref : "", licNo: l ? l.no : "", licDate: l ? l.date : "",
      regType: rg ? rg.type : "", regNo: rg ? rg.no : "", regDate: rg ? rg.date : "",
      gunPermitNo: poss ? poss.no : "", gunPermitDate: poss ? poss.date : "", gunKind: gunKind || ""
    };
  }

  var selected = Cho_splitChecks_(idx.get(M));
  for (var i = 0; i < selected.length; i++) {
    var kind = selected[i], b = M + "/" + kind;
    if (kind === "手捕り") {
      worker.methods.push(row("手捕り", null, null, null, ""));
    } else if (kind === "わな") {
      var tools = Cho_splitChecks_(idx.get(b + "/道具の種類"));
      var wl = (idx.get(b + "/免許の必要性") === "必要") ? lic(b + "/免許の必要性/必要/免許情報", "わな猟") : null;
      var wr = reg(b, "わな猟");
      if (tools.length === 0) tools = ["わな"];
      for (var t = 0; t < tools.length; t++) worker.methods.push(row(tools[t], wl, wr, null, ""));
    } else if (kind === "網") {
      var ntools = Cho_splitChecks_(idx.get(b + "/道具の種類"));
      var nl = null, nr = null;
      if (idx.get(b + "/免許の必要性") === "必要") {
        var nb = b + "/免許の必要性/必要";
        nl = lic(nb + "/免許情報", "網猟"); nr = reg(nb, "網猟");
      }
      if (ntools.length === 0) ntools = ["網"];
      for (var n = 0; n < ntools.length; n++) worker.methods.push(row(ntools[n], nl, nr, null, ""));
    } else if (kind === "銃器") {
      var guns = Cho_splitChecks_(idx.get(b + "/銃の種類"));
      for (var g = 0; g < guns.length; g++) {
        var gk = guns[g], gb = b + "/銃の種類/" + gk;
        var poss = { no: idx.get(gb + "/所持許可/所持許可証番号"), date: Cho_toDateOrText_(idx.get(gb + "/所持許可/交付年月日")) };
        var gl = null, gr;
        if (gk === "空気銃") {
          var airSel = idx.get(gb + "/免許種類");
          if (airSel) gl = lic(gb + "/免許種類/" + airSel, CHO_GUN_LIC_[airSel] || airSel);
          gr = reg(gb, gl ? gl.type : "");
        } else { // 散弾銃 / ライフル銃
          gl = lic(gb + "/第一種銃猟免許", "第一種銃猟");
          gr = reg(gb, "第一種銃猟");
        }
        worker.methods.push(row(gk, gl, gr, poss, gk));
      }
    } else {
      worker.methods.push(row(kind, null, null, null, ""));
    }
  }
  return worker;
}

// 種数の合算。{ species: {count, eggCount} } を CHO_SPECIES_ORDER_ 順で。
function Cho_aggregateSpecies_(workers) {
  var totals = {};
  for (var w = 0; w < workers.length; w++) {
    var sps = workers[w].species || [];
    for (var s = 0; s < sps.length; s++) {
      var sp = sps[s];
      if (!totals[sp.name]) totals[sp.name] = { count: 0, eggCount: 0 };
      if (typeof sp.count === "number") totals[sp.name].count += sp.count;
      if (typeof sp.eggCount === "number") totals[sp.name].eggCount += sp.eggCount;
    }
  }
  return totals;
}

// 用具の和集合（CHO_TOOL_ORDER_ 順、未知は末尾、生ラベル）
function Cho_unionTools_(workers) {
  var seen = [];
  for (var w = 0; w < workers.length; w++) {
    var ms = workers[w].methods || [];
    for (var m = 0; m < ms.length; m++) { var tl = ms[m].tool; if (tl && seen.indexOf(tl) === -1) seen.push(tl); }
  }
  var ordered = [];
  for (var o = 0; o < CHO_TOOL_ORDER_.length; o++) if (seen.indexOf(CHO_TOOL_ORDER_[o]) !== -1) ordered.push(CHO_TOOL_ORDER_[o]);
  for (var s2 = 0; s2 < seen.length; s2++) if (ordered.indexOf(seen[s2]) === -1) ordered.push(seen[s2]);
  return ordered;
}

// 名簿の種数行レイアウト（申請書と同じ固定配置。off=ブロック内行オフセット、side=L(J/K)/R(M/N)）
var CHO_ROSTER_SPECIES_ = [
  { sp: "キジバト", off: 0, side: "L", bird: true }, { sp: "カワラバト", off: 1, side: "L", bird: true },
  { sp: "スズメ", off: 2, side: "L", bird: true }, { sp: "ニュウナイスズメ", off: 3, side: "L", bird: true },
  { sp: "ハシボソガラス", off: 4, side: "L", bird: true }, { sp: "ハシブトガラス", off: 5, side: "L", bird: true },
  { sp: "キツネ", off: 6, side: "L" }, { sp: "ノイヌ", off: 6, side: "R" },
  { sp: "ノネコ", off: 7, side: "L" }, { sp: "アライグマ", off: 7, side: "R" },
  { sp: "トガリネズミ科・ネズミ科", off: 8, side: "L" }
];


// #############################################################################
// ## fillExport.gs — 書き出し（フォーム→Excel）。リテラルのみ・空はスキップ
// #############################################################################

var CHO_PROP_TEMPLATE_ = "CHO_TEMPLATE_FILE_ID";
var CHO_PROP_FOLDER_ = "CHO_OUTPUT_FOLDER_ID";
var CHO_PROP_KEY_ = "CHO_ACCESS_KEY";

function Cho_createOutputCopy_(recordNo) {
  var props = PropertiesService.getScriptProperties();
  var templateId = props.getProperty(CHO_PROP_TEMPLATE_), folderId = props.getProperty(CHO_PROP_FOLDER_);
  if (!templateId || !folderId) throw new Error("テンプレート未設定です。Cho_registerSettings を実行してください。");
  var stamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd_HHmmss");
  var noPart = String(recordNo == null || recordNo === "" ? "record" : recordNo);
  return DriveApp.getFileById(templateId).makeCopy("鳥獣保護管理法様式_" + noPart + "_" + stamp, DriveApp.getFolderById(folderId));
}

function Cho_setCell_(sheet, a1, value) {
  if (value === "" || value === null || value === undefined) return;
  sheet.getRange(a1).setValue(value);
}

// 申請書セル（番地→値）の正準グリッドを組む。緑シートはこれを投影する。
function Cho_appCells_(model) {
  var c = {};
  c["H2"] = model.applicationDate;
  c["F6"] = model.applicantAddress;
  c["F8"] = model.applicantName;
  c["F10"] = model.applicantOccupation;
  c["F11"] = model.applicantBirth;
  c["J9"] = model.othersCountText;
  for (var i = 0; i < CHO_APP_SPECIES_.length; i++) {
    var e = CHO_APP_SPECIES_[i], t = model.totals[e.sp] || { count: 0, eggCount: 0 };
    c[e.nameCell] = e.sp;                       // 種名（固定ラベル）
    if (e.bird && e.eggLabelCell) c[e.eggLabelCell] = (t.eggCount > 0 ? "卵" : "");
    c[e.count] = (t.count > 0 ? t.count : "");
    if (e.egg) c[e.egg] = (t.eggCount > 0 ? t.eggCount : "");
  }
  c["E27"] = model.purpose;
  c["E28"] = model.periodStart;
  c["H28"] = model.periodEnd;
  c["E29"] = model.areaLocation;
  c["E30"] = model.methodText;
  c["E31"] = model.disposalText;
  for (var a = 0; a < (model.area7Selected || []).length; a++) {
    var cell = CHO_AREA7_MARK_[model.area7Selected[a]];
    if (cell) c[cell] = "○";
    else model.warnings.push("規則7条 区分「" + model.area7Selected[a] + "」は様式の区分に対応がないため○を打てませんでした。");
  }
  return c;
}

// 緑シート ref の src を解決（"E18" 等の申請書番地 / model キー）
function Cho_resolveRef_(src, appCells, model) {
  if (/^[A-Z]+[0-9]+$/.test(src)) return appCells[src];
  if (src === "applicantNameComposed") return model.applicantNameComposed;
  if (src === "permitConditions") return model.permitConditions;
  return model[src];
}

function Cho_fillAll_(ss, model) {
  var appCells = Cho_appCells_(model);

  // 申請書
  var ap = ss.getSheetByName("申請書");
  if (ap) { for (var k in appCells) if (appCells.hasOwnProperty(k)) Cho_setCell_(ap, k, appCells[k]); }
  else model.warnings.push("シート「申請書」が見つかりません。");

  // 従事者名簿
  Cho_writeRoster_(ss, model);

  // 事由書
  Cho_writeJiyu_(ss, model);

  // 緑シート（許可証・振興局宛通知・警察宛通知）に投影
  Cho_projectRefs_(ss, "許可証", Cho_kyokashoRefs_(), appCells, model);
  Cho_projectRefs_(ss, "振興局宛通知", Cho_tsuchiRefs_(), appCells, model);
  Cho_projectRefs_(ss, "警察宛通知", Cho_tsuchiRefs_(), appCells, model);
  Cho_projectRefs_(ss, "従事者証", CHO_JUJISHA_REFS_, appCells, model);
}

function Cho_projectRefs_(ss, sheetName, refs, appCells, model) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) { model.warnings.push("シート「" + sheetName + "」が見つかりません。"); return; }
  for (var i = 0; i < refs.length; i++) Cho_setCell_(sheet, refs[i].dst, Cho_resolveRef_(refs[i].src, appCells, model));
}

function Cho_writeJiyu_(ss, model) {
  var sheet = ss.getSheetByName("事由書");
  if (!sheet) { model.warnings.push("シート「事由書」が見つかりません。"); return; }
  Cho_setCell_(sheet, "H2", model.applicationDate);
  Cho_setCell_(sheet, "H4", model.applicantAddress);
  Cho_setCell_(sheet, "H5", model.applicantName);
  if (model.applicantType === "法人") Cho_setCell_(sheet, "H6", model.applicantOccupation); // 代表者名
  for (var i = 0; i < (model.jiyuCause || []).length; i++) {
    var cell = CHO_JIYU_SPECIES_MARK_[model.jiyuCause[i]];
    if (cell) Cho_setCell_(sheet, cell, "○");
  }
  Cho_setCell_(sheet, "E22", CHO_VICTIM_TO_SHEET_[model.jiyuVictim] || "");
  Cho_setCell_(sheet, "G22", model.jiyuVictimAddr);
  Cho_setCell_(sheet, "G23", model.jiyuVictimName);
  Cho_setCell_(sheet, "E24", model.jiyuTime);
  Cho_setCell_(sheet, "E25", model.jiyuArea);
  Cho_setCell_(sheet, "E26", model.jiyuContent);
  Cho_setCell_(sheet, "E27", model.jiyuReason);
  Cho_setCell_(sheet, "E28", model.jiyuRemarks);
}

function Cho_writeRoster_(ss, model) {
  var L = CHO_ROSTER_, cols = L.cols;
  var sheet = ss.getSheetByName(L.sheetName);
  if (!sheet) { model.warnings.push("シート「" + L.sheetName + "」が見つかりません。"); return; }
  var workers = model.workers || [];
  if (workers.length > L.blockCount) {
    model.warnings.push("従事者名簿の枠(" + L.blockCount + "ブロック)を超えたため " + (workers.length - L.blockCount) + " 名を出力できませんでした。");
  }
  var n = Math.min(workers.length, L.blockCount);
  for (var w = 0; w < n; w++) {
    var worker = workers[w], top = L.firstRow + w * L.blockHeight;
    // certNo(E列)=緑/office → 空のまま
    Cho_setCell_(sheet, cols.address + top, worker.address);
    Cho_setCell_(sheet, cols.name + top, worker.name);
    Cho_setCell_(sheet, cols.occupation + top, worker.occupation);
    Cho_setCell_(sheet, cols.birth + top, worker.birth);
    // 種数（固定オフセット配置）
    var byName = {};
    for (var s = 0; s < worker.species.length; s++) byName[worker.species[s].name] = worker.species[s];
    for (var r = 0; r < CHO_ROSTER_SPECIES_.length; r++) {
      var slot = CHO_ROSTER_SPECIES_[r], sp = byName[slot.sp];
      if (!sp) continue;
      var row = top + slot.off;
      if (slot.side === "L") {
        Cho_setCell_(sheet, cols.speciesName + row, slot.sp);
        if (typeof sp.count === "number" && sp.count > 0) Cho_setCell_(sheet, cols.speciesCount + row, sp.count);
        if (slot.bird && typeof sp.eggCount === "number" && sp.eggCount > 0) {
          Cho_setCell_(sheet, cols.species2Name + row, "卵");
          Cho_setCell_(sheet, cols.species2Count + row, sp.eggCount);
        }
      } else { // R: ノイヌ/アライグマ を M/N に
        Cho_setCell_(sheet, cols.species2Name + row, slot.sp);
        if (typeof sp.count === "number" && sp.count > 0) Cho_setCell_(sheet, cols.species2Count + row, sp.count);
      }
    }
    // 捕獲方法（P 列に積層）+ 免許/登録/銃器
    var methods = worker.methods || [];
    if (methods.length > L.blockHeight) {
      model.warnings.push("従事者「" + worker.name + "」の方法行が " + L.blockHeight + " を超えたため一部を出力できませんでした。");
    }
    for (var m = 0; m < Math.min(methods.length, L.blockHeight); m++) {
      var meth = methods[m], mrow = top + m;
      Cho_setCell_(sheet, cols.tool + mrow, meth.tool);
      Cho_setCell_(sheet, cols.licType + mrow, meth.licType);
      Cho_setCell_(sheet, cols.licPref + mrow, meth.licPref);
      Cho_setCell_(sheet, cols.licNo + mrow, meth.licNo);
      Cho_setCell_(sheet, cols.licDate + mrow, meth.licDate);
      Cho_setCell_(sheet, cols.regType + mrow, meth.regType);
      Cho_setCell_(sheet, cols.regNo + mrow, meth.regNo);
      Cho_setCell_(sheet, cols.regDate + mrow, meth.regDate);
      Cho_setCell_(sheet, cols.gunPermitNo + mrow, meth.gunPermitNo);
      Cho_setCell_(sheet, cols.gunPermitDate + mrow, meth.gunPermitDate);
      Cho_setCell_(sheet, cols.gunKind + mrow, meth.gunKind);
    }
  }
}


// #############################################################################
// ## parseImport.gs — 取り込み（Excel→フォーム）。リーダ抽象でロジックは純粋
// #############################################################################

// 用具 → 方法 kind
var CHO_TOOL_KIND_ = {
  "手捕り": "手捕り",
  "くくりわな": "わな", "はこわな": "わな", "はこおとし": "わな", "囲いわな": "わな",
  "むそう網": "網", "はり網": "網", "つき網": "網", "なげ網": "網",
  "空気銃": "銃器", "散弾銃": "銃器", "ライフル銃": "銃器"
};

// A1 → { row, col }（1 始まり）
function Cho_a1ToRC_(a1) {
  var m = String(a1).match(/^([A-Z]+)([0-9]+)$/);
  if (!m) throw new Error("不正なセル番地: " + a1);
  var col = 0, letters = m[1];
  for (var i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64);
  return { row: Number(m[2]), col: col };
}

// valuesBySheet = { sheetName: 2D配列(行優先, [0]=1行目) } からセル読みリーダを作る
function Cho_makeReader_(valuesBySheet) {
  return {
    cell: function (sheetName, a1) {
      var grid = valuesBySheet[sheetName];
      if (!grid) return "";
      var rc = Cho_a1ToRC_(a1);
      var row = grid[rc.row - 1];
      if (!row) return "";
      var v = row[rc.col - 1];
      return v == null ? "" : v;
    }
  };
}

function Cho_isChecked_(v) {
  var s = String(v == null ? "" : v).replace(/^\s+|\s+$/g, "");
  return s !== "" && s !== "0" && s.toLowerCase() !== "false";
}
function Cho_str_(v) { return String(v == null ? "" : v).replace(/^\s+|\s+$/g, ""); }
function Cho_dateCanon_(v) { var d = Cho_serialOrDateToDate_(v); return d instanceof Date ? Cho_dateToCanonical_(d) : Cho_str_(v); }

// 名簿 1 ブロック → 子レコードのフォームフィールド（"/"連結パス → 値）。空ブロックは null。
function Cho_importRosterBlock_(reader, top, isRep) {
  var S = "従事者名簿", C = CHO_ROSTER_.cols;
  function cell(col, off) { return reader.cell(S, col + (top + off)); }
  var name = Cho_str_(cell(C.name, 0)), address = Cho_str_(cell(C.address, 0));
  // 種数（固定オフセット配置を読む）
  var species = [];
  for (var r = 0; r < CHO_ROSTER_SPECIES_.length; r++) {
    var slot = CHO_ROSTER_SPECIES_[r];
    if (slot.side === "L") {
      var nm = Cho_str_(cell(C.speciesName, slot.off));
      var cnt = Cho_toNumberOrText_(cell(C.speciesCount, slot.off));
      var egg = slot.bird ? Cho_toNumberOrText_(cell(C.species2Count, slot.off)) : "";
      if (nm === slot.sp && (cnt !== "" || egg !== "")) species.push({ sp: slot.sp, count: cnt, egg: egg });
    } else {
      var nm2 = Cho_str_(cell(C.species2Name, slot.off));
      var cnt2 = Cho_toNumberOrText_(cell(C.species2Count, slot.off));
      if (nm2 === slot.sp && cnt2 !== "") species.push({ sp: slot.sp, count: cnt2, egg: "" });
    }
  }
  // 方法（P 列 + 免許/登録/銃器 を行ごとに読む）
  var rows = [];
  for (var off = 0; off < CHO_ROSTER_.blockHeight; off++) {
    var tool = Cho_str_(cell(C.tool, off));
    if (!tool) continue;
    rows.push({
      tool: tool, kind: CHO_TOOL_KIND_[tool] || "",
      licPref: Cho_str_(cell(C.licPref, off)), licNo: Cho_str_(cell(C.licNo, off)), licDate: Cho_dateCanon_(cell(C.licDate, off)), licType: Cho_str_(cell(C.licType, off)),
      regNo: Cho_str_(cell(C.regNo, off)), regDate: Cho_dateCanon_(cell(C.regDate, off)),
      gunNo: Cho_str_(cell(C.gunPermitNo, off)), gunDate: Cho_dateCanon_(cell(C.gunPermitDate, off))
    });
  }
  if (!name && species.length === 0 && rows.length === 0) return null; // 空ブロック

  var f = {};
  var M = CHO_L_CHILD_METHOD_, SP = CHO_L_CHILD_SPECIES_;
  f["代表的個人"] = isRep ? "はい" : "いいえ";
  f["氏名"] = name; f["住所"] = address;
  f["職業"] = Cho_str_(cell(C.occupation, 0));
  var birth = Cho_dateCanon_(cell(C.birth, 0)); if (birth) f["生年月日"] = birth;

  // 種数 → チェック + 子
  var spChecked = [];
  for (var s = 0; s < species.length; s++) {
    var sp = species[s]; spChecked.push(sp.sp);
    if (sp.count !== "") f[SP + "/" + sp.sp + "/捕獲頭数"] = sp.count;
    if (sp.egg !== "") f[SP + "/" + sp.sp + "/採取卵数"] = sp.egg;
  }
  if (spChecked.length) f[SP] = spChecked.join(", ");

  // 方法 → kind ごとに再構成
  var byKind = { "手捕り": [], "わな": [], "網": [], "銃器": [] };
  for (var i = 0; i < rows.length; i++) { if (byKind[rows[i].kind]) byKind[rows[i].kind].push(rows[i]); }
  var methodChecks = [];
  if (byKind["手捕り"].length) methodChecks.push("手捕り");
  if (byKind["わな"].length) {
    methodChecks.push("わな");
    var wb = M + "/わな";
    f[wb + "/道具の種類"] = byKind["わな"].map(function (x) { return x.tool; }).join(", ");
    var wl = Cho_firstWithLicense_(byKind["わな"]);
    if (wl) {
      f[wb + "/免許の必要性"] = "必要";
      var lb = wb + "/免許の必要性/必要/免許情報/";
      if (wl.licPref) f[lb + "都道府県"] = wl.licPref;
      if (wl.licNo) f[lb + "番号"] = wl.licNo;
      if (wl.licDate) f[lb + "交付年月日"] = wl.licDate;
    }
    Cho_importReg_(f, wb, byKind["わな"]); // わな直下の狩猟者登録
  }
  if (byKind["網"].length) {
    methodChecks.push("網");
    var nb = M + "/網";
    f[nb + "/道具の種類"] = byKind["網"].map(function (x) { return x.tool; }).join(", ");
    var nl = Cho_firstWithLicense_(byKind["網"]);
    if (nl) {
      f[nb + "/免許の必要性"] = "必要";
      var nlb = nb + "/免許の必要性/必要/免許情報/";
      if (nl.licPref) f[nlb + "都道府県"] = nl.licPref;
      if (nl.licNo) f[nlb + "番号"] = nl.licNo;
      if (nl.licDate) f[nlb + "交付年月日"] = nl.licDate;
      Cho_importReg_(f, nb + "/免許の必要性/必要", byKind["網"]); // 網は 必要 配下に登録
    }
  }
  if (byKind["銃器"].length) {
    methodChecks.push("銃器");
    var gb = M + "/銃器";
    var gunKinds = [];
    for (var gi = 0; gi < byKind["銃器"].length; gi++) {
      var gr = byKind["銃器"][gi], gk = gr.tool, gbk = gb + "/銃の種類/" + gk;
      if (gunKinds.indexOf(gk) === -1) gunKinds.push(gk);
      if (gr.gunNo) f[gbk + "/所持許可/所持許可証番号"] = gr.gunNo;
      if (gr.gunDate) f[gbk + "/所持許可/交付年月日"] = gr.gunDate;
      if (gk === "空気銃") {
        var airSel = Cho_reverseGunLic_(gr.licType); // 第一種銃猟→第一種銃猟免許
        if (airSel) {
          f[gbk + "/免許種類"] = airSel;
          var ab = gbk + "/免許種類/" + airSel + "/";
          if (gr.licPref) f[ab + "都道府県"] = gr.licPref;
          if (gr.licNo) f[ab + "番号"] = gr.licNo;
          if (gr.licDate) f[ab + "交付年月日"] = gr.licDate;
        }
        Cho_importReg_(f, gbk, [gr]);
      } else { // 散弾銃 / ライフル銃
        var fb = gbk + "/第一種銃猟免許/";
        if (gr.licPref) f[fb + "都道府県"] = gr.licPref;
        if (gr.licNo) f[fb + "番号"] = gr.licNo;
        if (gr.licDate) f[fb + "交付年月日"] = gr.licDate;
        Cho_importReg_(f, gbk, [gr]);
      }
    }
    f[gb + "/銃の種類"] = gunKinds.join(", ");
  }
  if (methodChecks.length) f[M] = methodChecks.join(", ");
  return f;
}

function Cho_firstWithLicense_(rows) {
  for (var i = 0; i < rows.length; i++) if (rows[i].licNo || rows[i].licPref || rows[i].licDate) return rows[i];
  return null;
}
function Cho_reverseGunLic_(licType) {
  for (var k in CHO_GUN_LIC_) if (CHO_GUN_LIC_.hasOwnProperty(k) && CHO_GUN_LIC_[k] === licType) return k;
  return licType === "第一種銃猟免許" || licType === "第二種銃猟免許" ? licType : "";
}
// 狩猟者登録（branchBase 配下）を rows から復元
function Cho_importReg_(f, branchBase, rows) {
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.regNo || r.regDate) {
      f[branchBase + "/狩猟者登録/登録の有無"] = "あり";
      var rb = branchBase + "/狩猟者登録/登録の有無/あり/";
      if (r.regNo) f[rb + "番号"] = r.regNo;
      if (r.regDate) f[rb + "交付年月日"] = r.regDate;
      return;
    }
  }
}

// 申請書/事由書 → 親レコードのフォームフィールド（"/"連結パス → 値）
function Cho_importParent_(reader, workers, warnings) {
  var f = {};
  var APP = "申請書", JIYU = "事由書";
  function app(a1) { return reader.cell(APP, a1); }
  function jiyu(a1) { return reader.cell(JIYU, a1); }

  // 個人/法人 判定: 申請書 F11(生年月日) が日付なら個人。
  var f11 = app("F11");
  var birthDate = Cho_serialOrDateToDate_(f11);
  var isIndividual = (birthDate instanceof Date && !isNaN(birthDate.getTime()) && Cho_str_(f11) !== "");
  var applicantType = isIndividual ? "個人" : "法人";
  var TBASE = CHO_L_APPLICANT_ + "/" + CHO_L_APPLICANT_TYPE_;
  f[TBASE] = applicantType;
  if (applicantType === "法人") {
    f[TBASE + "/法人/住所"] = Cho_str_(app("F6"));
    f[TBASE + "/法人/法人名"] = Cho_str_(app("F8"));
    f[TBASE + "/法人/代表者名"] = Cho_str_(app("F10"));
  } else {
    // 個人は名簿から導出（substitution 任せ）。申請書ピンクと代表従事者を照合。
    var rep = workers[0];
    if (rep) {
      if (Cho_str_(app("F6")) && rep["住所"] && Cho_str_(app("F6")) !== rep["住所"]) warnings.push("申請書 住所(確認用)が代表従事者と不一致: " + app("F6") + " ≠ " + rep["住所"]);
      if (Cho_str_(app("F8")) && rep["氏名"] && Cho_str_(app("F8")) !== rep["氏名"]) warnings.push("申請書 氏名(確認用)が代表従事者と不一致: " + app("F8") + " ≠ " + rep["氏名"]);
    }
  }

  f[CHO_L_PURPOSE_] = Cho_str_(app("E27"));
  var ps = Cho_dateCanon_(app("E28")), pe = Cho_dateCanon_(app("H28"));
  if (ps) f[CHO_L_PERIOD_ + "/開始"] = ps;
  if (pe) f[CHO_L_PERIOD_ + "/終了"] = pe;
  f[CHO_L_AREA_ + "/所在地"] = Cho_str_(app("E29"));

  // 規則7条 区分: ○ セルを逆引き
  var area7 = [];
  var seenCell = {};
  for (var opt in CHO_AREA7_MARK_) {
    if (!CHO_AREA7_MARK_.hasOwnProperty(opt)) continue;
    var cell = CHO_AREA7_MARK_[opt];
    if (seenCell[cell]) continue; // 同一セルに複数選択肢が割当（あり/なし）→ 先頭のみ採用
    if (Cho_isChecked_(app(cell))) { area7.push(opt); seenCell[cell] = true; }
  }
  if (area7.length) f[CHO_L_AREA_ + "/" + CHO_L_AREA7_] = area7.join(", ");

  // 処置: 申請書 E31 を ・ で分割 → フォーム選択肢
  var disp = Cho_str_(app("E31")).split(/[・,、]/).map(function (x) { return x.replace(/^\s+|\s+$/g, ""); }).filter(function (x) { return x; });
  if (disp.length) f[CHO_L_DISPOSAL_] = disp.join(", ");

  // 事由書
  var jBase = CHO_L_JIYU_ + "/";
  var cause = [];
  for (var sp in CHO_JIYU_SPECIES_MARK_) {
    if (CHO_JIYU_SPECIES_MARK_.hasOwnProperty(sp) && Cho_isChecked_(jiyu(CHO_JIYU_SPECIES_MARK_[sp]))) cause.push(sp);
  }
  if (cause.length) f[jBase + CHO_L_JIYU_CAUSE_] = cause.join(", ");
  var victim = CHO_VICTIM_FROM_SHEET_[Cho_str_(jiyu("E22"))] || "";
  if (victim) {
    f[jBase + CHO_L_JIYU_VICTIM_] = victim;
    if (victim === "申請者以外") {
      f[jBase + CHO_L_JIYU_VICTIM_ + "/申請者以外/住所"] = Cho_str_(jiyu("G22"));
      f[jBase + CHO_L_JIYU_VICTIM_ + "/申請者以外/氏名"] = Cho_str_(jiyu("G23"));
    }
  }
  f[jBase + CHO_L_JIYU_TIME_] = Cho_str_(jiyu("E24"));
  f[jBase + CHO_L_JIYU_AREA_] = Cho_str_(jiyu("E25"));
  f[jBase + CHO_L_JIYU_CONTENT_] = Cho_str_(jiyu("E26"));
  f[jBase + CHO_L_JIYU_REASON_] = Cho_str_(jiyu("E27"));
  f[jBase + CHO_L_REMARKS_] = Cho_str_(jiyu("E28"));

  return { type: applicantType, fields: f };
}

// リーダ → { parent:{fields}, children:[{fields}], warnings }
function Cho_buildImport_(reader) {
  var warnings = [];
  var workers = [];
  for (var b = 0; b < CHO_ROSTER_.blockCount; b++) {
    var top = CHO_ROSTER_.firstRow + b * CHO_ROSTER_.blockHeight;
    var f = Cho_importRosterBlock_(reader, top, b === 0);
    if (f) workers.push(f);
  }
  if (workers.length === 0) warnings.push("従事者名簿に従事者が見つかりませんでした。");
  var parent = Cho_importParent_(reader, workers, warnings);
  return { parent: parent, children: workers, warnings: warnings };
}

// ULID 風レコード ID（本体 Nfb_generateRecordId_ と互換の "r_..." 形）
function Cho_generateRecordId_() {
  var ts = (new Date()).getTime().toString(36);
  var rand = "";
  for (var i = 0; i < 10; i++) rand += "0123456789abcdefghijklmnopqrstuvwxyz".charAt(Math.floor(Math.random() * 36));
  return "r_" + ts + "_" + rand;
}

// import 結果 → sync_records 用 uploadRecords（親 + 子。子は pid=親 ID）
function Cho_buildUploadRecords_(imp, parentRecordId) {
  var now = (new Date()).getTime();
  var parentId = parentRecordId || Cho_generateRecordId_();
  var parentRec = { id: parentId, data: imp.parent.fields, modifiedAtUnixMs: now };
  var children = [];
  for (var i = 0; i < imp.children.length; i++) {
    children.push({ id: parentId + "_c" + (i + 1), data: imp.children[i], modifiedAtUnixMs: now, pid: parentId });
  }
  return {
    parentFormId: CHO_FORM_PARENT_ID_, childFormId: CHO_FORM_CHILD_ID_,
    parentRecordId: parentId,
    parent: { formId: CHO_FORM_PARENT_ID_, uploadRecords: [parentRec] },
    children: { formId: CHO_FORM_CHILD_ID_, uploadRecords: children, pid: parentId }
  };
}

// ----- GAS I/O: Drive xlsx → Google Sheet 変換 → セル読み取り -----
function Cho_handleImport_(data, e) {
  var fileId = data.driveFileId || (e && e.parameter && e.parameter.driveFileId);
  if (!fileId) return { ok: false, error: "driveFileId がありません（様式 xlsx の Drive ファイル ID を渡してください）。" };
  var convertedId = null;
  try {
    var converted = Drive.Files.copy({ title: "_nfb_import_tmp", mimeType: "application/vnd.google-apps.spreadsheet" }, fileId);
    convertedId = converted.id;
    var ss = SpreadsheetApp.openById(convertedId);
    var valuesBySheet = Cho_readSheetValues_(ss);
    var reader = Cho_makeReader_(valuesBySheet);
    var imp = Cho_buildImport_(reader);
    var out = Cho_buildUploadRecords_(imp, data.parentRecordId || "");
    out.ok = true;
    out.warnings = imp.warnings;
    out.summary = { applicantType: imp.parent.type, workerCount: imp.children.length };
    return out;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  } finally {
    if (convertedId) { try { Drive.Files.remove(convertedId); } catch (e2) { /* no-op */ } }
  }
}

function Cho_readSheetValues_(ss) {
  var out = {};
  for (var i = 0; i < CHO_SHEETS_.length; i++) {
    var sheet = ss.getSheetByName(CHO_SHEETS_[i]);
    if (sheet) out[CHO_SHEETS_[i]] = sheet.getDataRange().getValues();
  }
  return out;
}

// アップロードページ（HtmlService）。xlsx を選び google.script.run で取り込み、
// 返ってきた uploadRecords(JSON) をユーザーが本体アプリ（Playground/取り込みUI）へ渡す。
function Cho_renderUploadPage_() {
  var html =
    '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>様式の取り込み</title>' +
    '<style>body{font-family:-apple-system,"Segoe UI",Roboto,"Noto Sans JP",sans-serif;background:#f8f9fa;margin:0;padding:24px;color:#202124;}' +
    '.card{max-width:900px;margin:0 auto;background:#fff;border:1px solid #dadce0;border-radius:8px;padding:20px 24px;}' +
    'h1{font-size:18px;color:#1a73e8;}label{display:block;margin:12px 0 4px;font-size:13px;}' +
    'input[type=text]{width:100%;padding:6px;box-sizing:border-box;}button{margin-top:14px;padding:8px 16px;font-size:14px;cursor:pointer;}' +
    '#status{margin-top:12px;font-size:13px;}#out{width:100%;height:280px;margin-top:12px;font-family:monospace;font-size:12px;}' +
    '.warn{color:#b06000;}.err{color:#c5221f;}</style></head><body><div class="card">' +
    '<h1>鳥獣保護管理法様式の取り込み（Excel → フォーム）</h1>' +
    '<p>記入済みの様式（xlsx）を選んで「取り込む」を押すと、フォーム用レコード(JSON)に変換します。' +
    '出力された JSON を本体アプリの取り込み口（管理者 &gt; Playground 等）で sync_records に渡してください。</p>' +
    '<label>様式ファイル (.xlsx)</label><input type="file" id="file" accept=".xlsx">' +
    '<label>更新する親レコードID（再取り込みで上書きしたいとき。空なら新規）</label><input type="text" id="pid" placeholder="r_...">' +
    '<button id="go">取り込む</button>' +
    '<div id="status"></div><textarea id="out" readonly placeholder="ここに uploadRecords(JSON) が出ます"></textarea>' +
    '<button id="copy">JSON をコピー</button>' +
    '</div><script>' +
    'function $(i){return document.getElementById(i);}' +
    '$("go").onclick=function(){var f=$("file").files[0];if(!f){$("status").textContent="ファイルを選んでください";return;}' +
    '$("status").textContent="読み込み中...";var r=new FileReader();' +
    'r.onload=function(){var b64=r.result.split(",")[1];' +
    'google.script.run.withSuccessHandler(function(res){' +
    'if(res&&res.ok){$("status").innerHTML="取り込み成功: "+res.summary.applicantType+" / 従事者 "+res.summary.workerCount+" 名"+((res.warnings&&res.warnings.length)?(" <span class=\\"warn\\">(警告 "+res.warnings.length+" 件)</span>"):"");}' +
    'else{$("status").innerHTML="<span class=\\"err\\">失敗: "+(res&&res.error||"unknown")+"</span>";}' +
    '$("out").value=JSON.stringify(res,null,2);})' +
    '.withFailureHandler(function(e){$("status").innerHTML="<span class=\\"err\\">エラー: "+e.message+"</span>";})' +
    '.Cho_uploadAndImport_(b64,f.name,$("pid").value);};r.readAsDataURL(f);};' +
    '$("copy").onclick=function(){$("out").select();document.execCommand("copy");$("status").textContent="コピーしました";};' +
    '</script></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle("様式の取り込み").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// アップロードページから呼ばれる: base64 xlsx → Drive 一時ファイル → 取り込み → 一時削除。
function Cho_uploadAndImport_(base64, filename, parentRecordId) {
  var tempFile = null;
  try {
    var bytes = Utilities.base64Decode(base64);
    var blob = Utilities.newBlob(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename || "import.xlsx");
    tempFile = DriveApp.createFile(blob);
    var res = Cho_handleImport_({ driveFileId: tempFile.getId(), parentRecordId: parentRecordId || "" }, null);
    return res;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  } finally {
    if (tempFile) { try { tempFile.setTrashed(true); } catch (e) { /* no-op */ } }
  }
}


// #############################################################################
// ## setup.gs — 一次セットアップ（GAS エディタから手動実行）
// #############################################################################

function Cho_registerSettings(templateFileId, outputFolderId, accessKey) {
  if (!templateFileId || !outputFolderId) throw new Error("templateFileId と outputFolderId を指定してください。");
  var props = PropertiesService.getScriptProperties();
  props.setProperty(CHO_PROP_TEMPLATE_, String(templateFileId));
  props.setProperty(CHO_PROP_FOLDER_, String(outputFolderId));
  props.setProperty(CHO_PROP_KEY_, String(accessKey || ""));
  Logger.log("登録: template=%s folder=%s key=%s", templateFileId, outputFolderId, accessKey ? "(あり)" : "(なし)");
}

// テンプレ清掃（冪等）: 不要シート削除 + 全数式消去 + 色付き(黄/桃/緑)セルの値クリア。
// 黄/桃/緑＝データ/派生/出力なので機械的に空にし、無色のラベル・固定文言は残す。
function Cho_setupCleanTemplate() {
  var templateId = PropertiesService.getScriptProperties().getProperty(CHO_PROP_TEMPLATE_);
  if (!templateId) throw new Error("先に Cho_registerSettings を実行してください。");
  var ss = SpreadsheetApp.openById(templateId);
  for (var d = 0; d < CHO_SHEETS_TO_DELETE_.length; d++) {
    var doomed = ss.getSheetByName(CHO_SHEETS_TO_DELETE_[d]);
    if (doomed) { ss.deleteSheet(doomed); Logger.log("シート削除: %s", CHO_SHEETS_TO_DELETE_[d]); }
  }
  var DATA_BG_ = { "#ffff00": 1, "#ead1dc": 1, "#00b050": 1 };
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i], range = sheet.getDataRange();
    var formulas = range.getFormulas(), bgs = range.getBackgrounds(), cleared = 0;
    for (var r = 0; r < formulas.length; r++) {
      for (var c = 0; c < formulas[r].length; c++) {
        var isFormula = !!formulas[r][c];
        var isData = !!DATA_BG_[String(bgs[r][c]).toLowerCase()];
        if (isFormula || isData) { sheet.getRange(r + 1, c + 1).clearContent(); cleared++; }
      }
    }
    Logger.log("清掃: %s … %s セル", sheet.getName(), cleared);
  }
  SpreadsheetApp.flush();
  Logger.log("テンプレート清掃 完了。");
}


// #############################################################################
// ## Test.gs — デプロイ不要テスト（GAS エディタで testAll を実行しログ確認）
// #############################################################################
// 純ロジック（buildModel / appCells / parseWorker）のみ検証。Drive を使う書き出し・
// 取り込みの結合テストは scripts/test_roundtrip.mjs（node・想定ファイル fixture）で行う。

function Cho_buildGoldenPayload_() {
  var M = CHO_L_CHILD_METHOD_, S = CHO_L_CHILD_SPECIES_, c1 = "従事者情報/#1/", c2 = "従事者情報/#2/";
  return {
    generatedAt: "2026-06-01T00:00:00.000Z",
    record: { no: 1, items: [
      { question: CHO_L_APPLICANT_ + "/" + CHO_L_APPLICANT_TYPE_, value: "個人" },
      { question: CHO_L_PURPOSE_, value: "管理（被害防止）" },
      { question: CHO_L_PERIOD_ + "/開始", value: "2026-06-01" },
      { question: CHO_L_PERIOD_ + "/終了", value: "2026-06-30" },
      { question: CHO_L_AREA_ + "/所在地", value: "札幌市南区定山渓405" },
      { question: CHO_L_DISPOSAL_, value: "埋設" },
      { question: c1 + "代表的個人", value: "はい" },
      { question: c1 + "氏名", value: "秋　はじめ" },
      { question: c1 + "住所", value: "札幌市北区" },
      { question: c1 + "職業", value: "会社役員" },
      { question: c1 + "生年月日", value: "1980-01-15" },
      { question: c1 + S, value: "キツネ" },
      { question: c1 + S + "/キツネ/捕獲頭数", value: "5" },
      { question: c1 + M, value: "わな" },
      { question: c1 + M + "/わな/道具の種類", value: "くくりわな" },
      { question: c1 + M + "/わな/免許の必要性", value: "必要" },
      { question: c1 + M + "/わな/免許の必要性/必要/免許情報/都道府県", value: "北海道" },
      { question: c1 + M + "/わな/免許の必要性/必要/免許情報/番号", value: "石狩第1234号" },
      { question: c1 + M + "/わな/免許の必要性/必要/免許情報/交付年月日", value: "2025-04-01" },
      { question: c2 + "代表的個人", value: "いいえ" },
      { question: c2 + "氏名", value: "冬村　多才" },
      { question: c2 + S, value: "キツネ" },
      { question: c2 + S + "/キツネ/捕獲頭数", value: "3" },
      { question: c2 + M, value: "手捕り" }
    ] }
  };
}

function testAll() {
  var results = [testModel_golden(), testRosterParse_()];
  var passed = 0; for (var i = 0; i < results.length; i++) if (results[i]) passed++;
  Logger.log("==================================================");
  Logger.log("テスト結果: %s / %s PASS", passed, results.length);
  return passed === results.length;
}

function testModel_golden() {
  var model = Cho_buildModel_(Cho_buildGoldenPayload_());
  var ap = Cho_appCells_(model);
  var errs = [];
  function exp(l, a, e) { if (String(a) !== String(e)) errs.push(l + ": got=" + a + " want=" + e); }
  exp("workerCount", model.workerCount, 2);
  exp("applicantType", model.applicantType, "個人");
  exp("キツネ合算", model.totals["キツネ"].count, 8);
  exp("methodText", model.methodText, "手捕り,くくりわな");
  exp("appCells.F24", ap["F24"], 8);
  exp("appCells.E24", ap["E24"], "キツネ");
  exp("appCells.J9", ap["J9"], 1);
  Cho_logResult_("model_golden", errs.length === 0, errs.join(" / "));
  return errs.length === 0;
}

function testRosterParse_() {
  var w = Cho_parseWorker_(Cho_indexItems_([
    { question: "氏名", value: "田中聡" },
    { question: CHO_L_CHILD_METHOD_, value: "銃器" },
    { question: CHO_L_CHILD_METHOD_ + "/銃器/銃の種類", value: "空気銃" },
    { question: CHO_L_CHILD_METHOD_ + "/銃器/銃の種類/空気銃/所持許可/所持許可証番号", value: "12345678901" },
    { question: CHO_L_CHILD_METHOD_ + "/銃器/銃の種類/空気銃/免許種類", value: "第二種銃猟免許" },
    { question: CHO_L_CHILD_METHOD_ + "/銃器/銃の種類/空気銃/免許種類/第二種銃猟免許/都道府県", value: "北海道" },
    { question: CHO_L_CHILD_METHOD_ + "/銃器/銃の種類/空気銃/免許種類/第二種銃猟免許/番号", value: "石狩第1235号" }
  ]));
  var errs = [];
  if (w.methods.length !== 1) errs.push("methods.length=" + w.methods.length);
  else {
    if (w.methods[0].tool !== "空気銃") errs.push("tool=" + w.methods[0].tool);
    if (w.methods[0].licType !== "第二種銃猟") errs.push("licType=" + w.methods[0].licType);
    if (w.methods[0].licNo !== "石狩第1235号") errs.push("licNo=" + w.methods[0].licNo);
    if (w.methods[0].gunPermitNo !== "12345678901") errs.push("gunNo=" + w.methods[0].gunPermitNo);
  }
  Cho_logResult_("roster_parse", errs.length === 0, errs.join(" / "));
  return errs.length === 0;
}

function Cho_logResult_(name, ok, detail) {
  Logger.log("[%s] %s%s", ok ? "PASS" : "FAIL", name, ok ? "" : " — " + detail);
}


// #############################################################################
// ## node エクスポート（GAS では module 未定義なので無視される）
// #############################################################################
if (typeof module === "object" && module.exports) {
  module.exports = {
    Cho_buildModel_: Cho_buildModel_, Cho_parseWorker_: Cho_parseWorker_,
    Cho_aggregateSpecies_: Cho_aggregateSpecies_, Cho_unionTools_: Cho_unionTools_,
    Cho_appCells_: Cho_appCells_, Cho_resolveRef_: Cho_resolveRef_,
    Cho_kyokashoRefs_: Cho_kyokashoRefs_, Cho_tsuchiRefs_: Cho_tsuchiRefs_,
    Cho_buildImport_: Cho_buildImport_, Cho_makeReader_: Cho_makeReader_,
    Cho_buildUploadRecords_: Cho_buildUploadRecords_,
    Cho_a1ToRC_: Cho_a1ToRC_, Cho_dateToCanonical_: Cho_dateToCanonical_,
    Cho_serialOrDateToDate_: Cho_serialOrDateToDate_,
    CHO_APP_SPECIES_: CHO_APP_SPECIES_, CHO_ROSTER_: CHO_ROSTER_
  };
}

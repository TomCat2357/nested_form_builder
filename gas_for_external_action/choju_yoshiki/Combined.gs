// #############################################################################
// ## Code.gs
// #############################################################################

// =============================================================================
// 鳥獣保護管理法様式 取り込み Web App (Nested Form Builder 連携)
//
// 取り込み（Excel→フォーム）: 検索画面の外部アクションボタン（管理者用）から
// 起動する。本体 GAS がサーバ間リレーでこの doPost を叩き、取り込み画面の URL
// （openUrl）を返してもらって新しいタブで開く。取り込み画面で様式 xlsx を選ぶと
// 解析結果を「分かりやすい表＋チェックボックス」で確認でき、選んだ分だけ親フォーム
// （申請書）と子フォーム（従事者名簿）のデータ保存用スプレッドシートへ直接書き込む。
// あわせて取り込んだ Excel を親レコードのアップロード欄へ添付する。
//
// 設計の核（様式 申請書 L6/L7/L8 の凡例）:
//   黄 FFFFFF00 = 正として吸い取る（取り込みで権威）
//   桃 FFEAD1DC = 確認用（名簿の集計）。取り込みは照合＋プレビュー表示のみ（保存しない）
//   緑 FF00B050 = 掃き出し場所（出力専用。取り込みは無視）
// =============================================================================

function doPost(e) {
  try {
    var params = (e && e.parameter) || {};
    // 1) 誤送信防止プローブ（本体にシークレットが設定されているとき、本送信の前に来る）。
    //    共有シークレットで HMAC(nonce) に署名して返すと、本体が正規受信アプリと認める。
    if (String(params.nfbProbe || "") === "1") {
      return Cho_renderImport_(Cho_buildProbeResponse_(params.nonce));
    }
    var payload = parsePayload_(e);
    if (!payload.ok) return Cho_renderImport_({ ok: false, error: payload.error });
    var data = payload.data;
    // 2) 後方互換: mode=import の直接取り込み（uploadRecords JSON を返す旧フロー）。
    if (String(data.mode || params.mode || "") === "import") {
      return Cho_renderImport_(Cho_handleImport_(data, e));
    }
    // 3) 外部アクションリレー（検索画面ボタン）。親フォームの保存先 storage を一時キャッシュし、
    //    取り込み画面の URL を openUrl で返す。本体がそれを新しいタブで開く。
    var ctxToken = Cho_putCtx_(Cho_extractRelayContext_(data));
    return Cho_renderImport_({
      ok: true,
      nfbExternalAction: true,
      title: "Excel 取り込み",
      message: "Excel 取り込み画面を新しいタブで開きます。",
      openUrl: Cho_buildImportUrl_(ctxToken)
    });
  } catch (err) {
    var em = String(err && err.message ? err.message : err);
    return Cho_renderImport_({ ok: false, error: em });
  }
}

// JSON 応答（取り込み結果・プローブ署名・openUrl いずれも JSON で返す）。
function Cho_renderImport_(result) {
  return ContentService.createTextOutput(JSON.stringify(result || { ok: false })).setMimeType(ContentService.MimeType.JSON);
}

// GET: 取り込み用アップロード/プレビュー UI。?page=import（既定）。?ctx=<token> で保存先を引き継ぐ。
function doGet(e) {
  var params = (e && e.parameter) || {};
  return Cho_renderUploadPage_(String(params.ctx || ""));
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

function escapeHtml_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}


// #############################################################################
// ## payload.gs
// #############################################################################

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


// #############################################################################
// ## cellmap.gs — 新 7 シート様式の単一セルマップ（取り込み用の契約）
// #############################################################################
//
// 典拠: form_test/鳥獣保護管理法様式_個人想定.xlsx / _法人想定.xlsx
//       （scripts/extract_cellmap.py → scripts/out/cellmap_seed.tsv）。
// 色は設計時の注釈。実行時は固定番地を引く。番地を直すときはこのセクションだけ編集する。

// ----- フォームのラベル定数（ライブ JSON が正。半角/全角括弧の罠を 1 箇所に隔離）-----
// 親フォーム「鳥獣保護管理法許可申請」
var CHO_FORM_PARENT_ID_ = "1_aLScq4lAQA-TgI2rZqyzqXB6SDiENy4";
var CHO_FORM_CHILD_ID_ = "1Eh5p3Q5IMQEfi-7TiUV8ZZ8z_4HKW0Zj";
var CHO_L_DISPOSAL_ = "捕獲等又は採取等をしたあとの処置";
var CHO_L_PURPOSE_ = "捕獲等又は採取等の目的";
var CHO_L_PERIOD_ = "捕獲等又は採取等の期間";
var CHO_L_AREA_ = "捕獲等又は採取等の区域";
var CHO_L_AREA7_ = "規則第７条第１項第７号に係る場所等の位置、名称及び理由";
var CHO_L_APPLICANT_ = "申請者情報";
var CHO_L_APPLICANT_TYPE_ = "申請者の個人・法人の別";
var CHO_L_REMARKS_ = "備考";
// フォームの message ラベル・Excel シート名とも "証明書" に統一。
var CHO_L_JIYU_ = "証明書";
var CHO_L_JIYU_CAUSE_ = "被害原因の鳥獣";
var CHO_L_JIYU_VICTIM_ = "被害者";
var CHO_L_JIYU_TIME_ = "被害発生の時期";
var CHO_L_JIYU_AREA_ = "被害発生区域（場所）";
var CHO_L_JIYU_CONTENT_ = "被害の内容";
var CHO_L_JIYU_REASON_ = "捕獲等又は採取等を行う理由";
// 子フォーム「従事者情報」
var CHO_L_CHILD_METHOD_ = "捕獲等又は採取等の方法（使用する捕獲用具の名称)"; // 閉じ括弧が半角!
var CHO_L_CHILD_SPECIES_ = "捕獲等をする鳥獣又は採取等をする鳥類の卵の種類及び数量";
// 確認用（桃セルの値を取り込む親フォームの message。子に種数サブ message）
var CHO_L_CONFIRM_ = "確認用";
var CHO_L_CONFIRM_SPECIES_ = "種類及び数量";

// ----- 種の表示順（フォーム選択肢順）-----
var CHO_SPECIES_ORDER_ = [
  "キジバト", "カワラバト", "スズメ", "ニュウナイスズメ", "ハシボソガラス", "ハシブトガラス",
  "キツネ", "ノイヌ", "ノネコ", "アライグマ", "トガリネズミ科・ネズミ科"
];

// ----- 捕獲用具（名簿 P 列・照合用）-----
var CHO_TOOL_ORDER_ = [
  "手捕り", "くくりわな", "はこわな", "はこおとし", "囲いわな",
  "むそう網", "はり網", "つき網", "なげ網", "空気銃", "散弾銃", "ライフル銃"
];

// ----- 名簿（従事者名簿）の幾何。1 ブロック = 1 従事者。9 行 × 10 ブロック（行 5〜94）-----
var CHO_ROSTER_ = {
  sheetName: "従事者名簿",
  firstRow: 5, blockHeight: 9, blockCount: 10,
  cols: {
    certNo: "E",
    address: "F", name: "G", occupation: "H", birth: "I",
    speciesName: "J", speciesCount: "K", speciesUnit: "L",
    species2Name: "M", species2Count: "N", species2Unit: "O",
    tool: "P",
    licType: "Q", licPref: "R", licNo: "S", licDate: "T",
    regType: "U", regNo: "V", regDate: "W",
    gunPermitNo: "X", gunPermitDate: "Y", gunKind: "Z",
    remarks: "AA"
  }
};

// ----- 証明書 被害原因の鳥獣（○ を打つセル）-----
var CHO_JIYU_SPECIES_MARK_ = {
  "キジバト": "F13", "カワラバト": "F14", "スズメ": "F15", "ニュウナイスズメ": "F16",
  "ハシボソガラス": "F17", "ハシブトガラス": "F18", "キツネ": "F19",
  "ノイヌ": "I19", "ノネコ": "F20", "アライグマ": "I20", "トガリネズミ科・ネズミ科": "F21"
};
// 証明書 被害者 区分（取り込み: 様式表記 → フォーム値）
var CHO_VICTIM_FROM_SHEET_ = { "1.申請者自身": "申請者", "1": "申請者", "2.申請者以外": "申請者以外", "2": "申請者以外" };

// ----- 申請書 規則第7条 区分の ○ グリッド（フォーム選択肢 → ○ を打つセル）-----
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

// ----- 7 シート（取り込みで読むシート）-----
var CHO_SHEETS_ = ["申請書", "従事者名簿", "証明書", "許可証", "振興局宛通知", "警察宛通知", "従事者証"];

// 申請書の種数欄の固定レイアウト（行 18〜26）。取り込みではピンク照合のみ使用。
var CHO_APP_SPECIES_ = [
  { sp: "キジバト",                nameCell: "E18", count: "F18", egg: "I18", bird: true },
  { sp: "カワラバト",              nameCell: "E19", count: "F19", egg: "I19", bird: true },
  { sp: "スズメ",                  nameCell: "E20", count: "F20", egg: "I20", bird: true },
  { sp: "ニュウナイスズメ",         nameCell: "E21", count: "F21", egg: "I21", bird: true },
  { sp: "ハシボソガラス",           nameCell: "E22", count: "F22", egg: "I22", bird: true },
  { sp: "ハシブトガラス",           nameCell: "E23", count: "F23", egg: "I23", bird: true },
  { sp: "キツネ",                  nameCell: "E24", count: "F24" },
  { sp: "ノイヌ",                  nameCell: "H24", count: "I24" },
  { sp: "ノネコ",                  nameCell: "E25", count: "F25" },
  { sp: "アライグマ",              nameCell: "H25", count: "I25" },
  { sp: "トガリネズミ科・ネズミ科", nameCell: "E26", count: "F26" }
];

// 空気銃の免許種類(select) → 狩猟免許の種類（名簿 Q 列）
var CHO_GUN_LIC_ = { "第一種銃猟免許": "第一種銃猟", "第二種銃猟免許": "第二種銃猟" };

// 名簿の種数行レイアウト（off=ブロック内行オフセット、side=L(J/K)/R(M/N)）
var CHO_ROSTER_SPECIES_ = [
  { sp: "キジバト",                off: 0, side: "L", bird: true },
  { sp: "カワラバト",              off: 1, side: "L", bird: true },
  { sp: "スズメ",                  off: 2, side: "L", bird: true },
  { sp: "ニュウナイスズメ",         off: 3, side: "L", bird: true },
  { sp: "ハシボソガラス",           off: 4, side: "L", bird: true },
  { sp: "ハシブトガラス",           off: 5, side: "L", bird: true },
  { sp: "キツネ",                  off: 6, side: "L" },
  { sp: "ノイヌ",                  off: 6, side: "R" },
  { sp: "ノネコ",                  off: 7, side: "L" },
  { sp: "アライグマ",              off: 7, side: "R" },
  { sp: "トガリネズミ科・ネズミ科", off: 8, side: "L" }
];


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

// ----- 取り込み異常の構造化 issue（抽出レポート用）-----
// category: "dropped"(取り込めなかった) | "odd"(おかしい) | "pink_inconsistent"(ピンク不整合)
// severity: "error" | "warn" | "info"
function Cho_issue_(category, severity, sheet, cell, label, value, expected, message) {
  return {
    category: category, severity: severity,
    sheet: sheet || "", cell: cell || "", label: label || "",
    value: (value === undefined || value === null ? "" : value),
    expected: (expected === undefined || expected === null ? "" : expected),
    message: message || ""
  };
}
// issues[] → warnings[]（自由文）。後方互換のため境界で投影する。
function Cho_issuesToWarnings_(issues) {
  var out = [];
  for (var i = 0; i < issues.length; i++) out.push(issues[i].message);
  return out;
}
// issues[] をカテゴリ別に集計（サマリ表示用）。
function Cho_countIssues_(issues) {
  var c = { dropped: 0, odd: 0, pink_inconsistent: 0 };
  for (var i = 0; i < issues.length; i++) { if (c.hasOwnProperty(issues[i].category)) c[issues[i].category]++; }
  return c;
}

// ピンク照合の中核: actual（桃セルの実値）が空なら issue を出さない（誤検知回避の要）。
// 個人様式は桃が数式で fixtures/未再計算時は空。法人様式は数量リテラル=名簿合算。
function Cho_pinkEmpty_(v) { return Cho_str_(v) === ""; }
function Cho_comparePinkNum_(issues, sheet, cell, label, actual, expected) {
  if (Cho_pinkEmpty_(actual)) return;
  var a = Cho_toNumberOrText_(actual);
  var mismatch = (typeof a === "number") ? (a !== expected) : (Cho_str_(a) !== String(expected));
  if (mismatch) issues.push(Cho_issue_("pink_inconsistent", "warn", sheet, cell, label, a, expected,
    sheet + " " + cell + " " + label + " が名簿集計と不一致: " + a + " ≠ " + expected));
}
function Cho_comparePinkText_(issues, sheet, cell, label, actual, expected) {
  if (Cho_pinkEmpty_(actual)) return;
  if (Cho_str_(actual) !== Cho_str_(expected)) issues.push(Cho_issue_("pink_inconsistent", "warn", sheet, cell, label, Cho_str_(actual), Cho_str_(expected),
    sheet + " " + cell + " " + label + " が名簿由来と不一致: " + Cho_str_(actual) + " ≠ " + Cho_str_(expected)));
}
function Cho_comparePinkDate_(issues, sheet, cell, label, actual, expected) {
  if (Cho_pinkEmpty_(actual)) return;
  var a = Cho_dateCanon_(actual), e = Cho_dateCanon_(expected);
  if (a !== e) issues.push(Cho_issue_("pink_inconsistent", "warn", sheet, cell, label, a, e,
    sheet + " " + cell + " " + label + " が名簿由来と不一致: " + a + " ≠ " + e));
}
// 用具集合の照合（E30 はセル並び順、こちらは名簿順なので順不同で比較）。expected は配列。
function Cho_comparePinkSet_(issues, sheet, cell, label, actual, expectedArr) {
  if (Cho_pinkEmpty_(actual)) return;
  var as = Cho_str_(actual).split(/[,、・]/).map(function (x) { return Cho_str_(x); }).filter(function (x) { return x; }).sort();
  var es = expectedArr.slice().sort();
  if (as.join("") !== es.join("")) issues.push(Cho_issue_("pink_inconsistent", "warn", sheet, cell, label, Cho_str_(actual), expectedArr.join(","),
    sheet + " " + cell + " " + label + " が名簿の用具集合と不一致: " + Cho_str_(actual) + " ≠ " + expectedArr.join(",")));
}
// 日付セル: 空でないのに Date 化できなければ odd issue。返り値は canonical/raw。
function Cho_dateCanonChecked_(v, issues, sheet, cell, label) {
  var d = Cho_serialOrDateToDate_(v);
  if (issues && !Cho_pinkEmpty_(v) && !(d instanceof Date)) issues.push(Cho_issue_("odd", "warn", sheet, cell, label, Cho_str_(v), "",
    sheet + " " + cell + " " + label + " の日付が解釈できません: " + Cho_str_(v)));
  return d instanceof Date ? Cho_dateToCanonical_(d) : Cho_str_(v);
}

// 名簿 1 ブロック → 子レコードのフォームフィールド（"/"連結パス → 値）。空ブロックは null。
function Cho_importRosterBlock_(reader, top, isRep, issues) {
  issues = issues || [];
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
      else if (nm !== "" && nm !== slot.sp) issues.push(Cho_issue_("dropped", "warn", S, C.speciesName + (top + slot.off), slot.sp, nm, slot.sp,
        "従事者名簿 " + C.speciesName + (top + slot.off) + " 種名「" + nm + "」が想定の " + slot.sp + " と一致せず取り込めませんでした。"));
    } else {
      var nm2 = Cho_str_(cell(C.species2Name, slot.off));
      var cnt2 = Cho_toNumberOrText_(cell(C.species2Count, slot.off));
      if (nm2 === slot.sp && cnt2 !== "") species.push({ sp: slot.sp, count: cnt2, egg: "" });
      else if (nm2 !== "" && nm2 !== slot.sp) issues.push(Cho_issue_("dropped", "warn", S, C.species2Name + (top + slot.off), slot.sp, nm2, slot.sp,
        "従事者名簿 " + C.species2Name + (top + slot.off) + " 種名「" + nm2 + "」が想定の " + slot.sp + " と一致せず取り込めませんでした。"));
    }
  }
  // 方法（P 列 + 免許/登録/銃器 を行ごとに読む）
  var rows = [];
  for (var off = 0; off < CHO_ROSTER_.blockHeight; off++) {
    var tool = Cho_str_(cell(C.tool, off));
    if (!tool) continue;
    if (!CHO_TOOL_KIND_[tool]) {
      issues.push(Cho_issue_("dropped", "warn", S, C.tool + (top + off), "捕獲用具", tool, "",
        "従事者名簿 " + C.tool + (top + off) + " 用具「" + tool + "」は未知のため免許/登録行が取り込めませんでした。"));
      continue;
    }
    rows.push({
      tool: tool, kind: CHO_TOOL_KIND_[tool] || "",
      licPref: Cho_str_(cell(C.licPref, off)), licNo: Cho_str_(cell(C.licNo, off)),
      licDate: Cho_dateCanonChecked_(cell(C.licDate, off), issues, S, C.licDate + (top + off), "免許交付年月日"),
      licType: Cho_str_(cell(C.licType, off)),
      regNo: Cho_str_(cell(C.regNo, off)),
      regDate: Cho_dateCanonChecked_(cell(C.regDate, off), issues, S, C.regDate + (top + off), "登録交付年月日"),
      gunNo: Cho_str_(cell(C.gunPermitNo, off)),
      gunDate: Cho_dateCanonChecked_(cell(C.gunPermitDate, off), issues, S, C.gunPermitDate + (top + off), "所持許可交付年月日")
    });
  }
  if (!name && species.length === 0 && rows.length === 0) return null; // 空ブロック
  if (!name && (species.length || rows.length)) issues.push(Cho_issue_("odd", "warn", S, C.name + top, "氏名", "", "",
    "従事者名簿 行" + top + " に種数/方法がありますが氏名が空です。"));

  var f = {};
  var M = CHO_L_CHILD_METHOD_, SP = CHO_L_CHILD_SPECIES_;
  f["代表的個人"] = isRep ? "はい" : "いいえ";
  f["氏名"] = name; f["住所"] = address;
  f["職業"] = Cho_str_(cell(C.occupation, 0));
  var birth = Cho_dateCanonChecked_(cell(C.birth, 0), issues, S, C.birth + top, "生年月日"); if (birth) f["生年月日"] = birth;

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
    Cho_importReg_(f, wb, byKind["わな"]);
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
      Cho_importReg_(f, nb + "/免許の必要性/必要", byKind["網"]);
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
        var airSel = Cho_reverseGunLic_(gr.licType);
        if (airSel) {
          f[gbk + "/免許種類"] = airSel;
          var ab = gbk + "/免許種類/" + airSel + "/";
          if (gr.licPref) f[ab + "都道府県"] = gr.licPref;
          if (gr.licNo) f[ab + "番号"] = gr.licNo;
          if (gr.licDate) f[ab + "交付年月日"] = gr.licDate;
        }
        Cho_importReg_(f, gbk, [gr]);
      } else { // 散弾銃 / ライフル銃
        var fbb = gbk + "/第一種銃猟免許/";
        if (gr.licPref) f[fbb + "都道府県"] = gr.licPref;
        if (gr.licNo) f[fbb + "番号"] = gr.licNo;
        if (gr.licDate) f[fbb + "交付年月日"] = gr.licDate;
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

// 申請書/証明書 → 親レコードのフォームフィールド（"/"連結パス → 値）
// forcedType（"個人"/"法人"）が渡されたら判定を上書きする（取り込み画面のラジオ選択が正）。
function Cho_importParent_(reader, workers, issues, forcedType) {
  issues = issues || [];
  var f = {};
  var APP = "申請書", JIYU = "証明書";
  function app(a1) { return reader.cell(APP, a1); }
  function jiyu(a1) { return reader.cell(JIYU, a1); }

  // 個人/法人 判定: ラジオ選択（forcedType）が最優先。未指定時のみヒューリスティック。
  // 法人は申請書 F8 が代表従事者名と異なる固有のリテラル（法人名）。
  // 個人は F8 が名簿の代表従事者から導出される（＝代表者名と一致／式未計算で空）。
  var f8 = Cho_str_(app("F8"));
  var repName = (workers[0] && workers[0]["氏名"]) ? Cho_str_(workers[0]["氏名"]) : "";
  var applicantType = (forcedType === "個人" || forcedType === "法人")
    ? forcedType
    : ((f8 !== "" && f8 !== repName) ? "法人" : "個人");
  var TBASE = CHO_L_APPLICANT_ + "/" + CHO_L_APPLICANT_TYPE_;
  f[TBASE] = applicantType;
  if (applicantType === "法人") {
    f[TBASE + "/法人/住所"] = Cho_str_(app("F6"));
    f[TBASE + "/法人/法人名"] = Cho_str_(app("F8"));
    f[TBASE + "/法人/代表者名"] = Cho_str_(app("F10"));
  } else {
    if (workers.length > 0) {
      var rep0 = workers[0];
      var iBase = TBASE + "/個人";
      if (rep0["氏名"])     f[iBase + "/氏名"]     = rep0["氏名"];
      if (rep0["住所"])     f[iBase + "/住所"]     = rep0["住所"];
      if (rep0["生年月日"]) f[iBase + "/生年月日"] = rep0["生年月日"];
      if (rep0["職業"])     f[iBase + "/職業"]     = rep0["職業"];
    }
  }

  f[CHO_L_PURPOSE_] = Cho_str_(app("E27"));
  var ps = Cho_dateCanonChecked_(app("E28"), issues, APP, "E28", "期間開始");
  var pe = Cho_dateCanonChecked_(app("H28"), issues, APP, "H28", "期間終了");
  if (ps) f[CHO_L_PERIOD_ + "/開始"] = ps;
  if (pe) f[CHO_L_PERIOD_ + "/終了"] = pe;
  f[CHO_L_AREA_ + "/所在地"] = Cho_str_(app("E29"));

  // 規則7条 区分: ○ セルを逆引き
  var area7 = [];
  var seenCell = {};
  for (var opt in CHO_AREA7_MARK_) {
    if (!CHO_AREA7_MARK_.hasOwnProperty(opt)) continue;
    var cell = CHO_AREA7_MARK_[opt];
    if (seenCell[cell]) continue;
    if (Cho_isChecked_(app(cell))) { area7.push(opt); seenCell[cell] = true; }
  }
  if (area7.length) f[CHO_L_AREA_ + "/" + CHO_L_AREA7_] = area7.join(", ");

  // 処置: 申請書 E31 を ・ で分割 → フォーム選択肢
  var disp = Cho_str_(app("E31")).split(/[・,、]/).map(function (x) { return x.replace(/^\s+|\s+$/g, ""); }).filter(function (x) { return x; });
  if (disp.length) f[CHO_L_DISPOSAL_] = disp.join(", ");

  // 証明書 → 親フォームへ保存（f）。フォームに証明書 message と全子項目があり、列が存在する。
  var jBase = CHO_L_JIYU_ + "/";
  function setJ(path, v) { var s = Cho_str_(v); if (s !== "") f[path] = s; }
  var cause = [];
  for (var sp in CHO_JIYU_SPECIES_MARK_) {
    if (CHO_JIYU_SPECIES_MARK_.hasOwnProperty(sp) && Cho_isChecked_(jiyu(CHO_JIYU_SPECIES_MARK_[sp]))) cause.push(sp);
  }
  if (cause.length) f[jBase + CHO_L_JIYU_CAUSE_] = cause.join(", ");
  var victimRaw = Cho_str_(jiyu("E22"));
  var victim = CHO_VICTIM_FROM_SHEET_[victimRaw] || "";
  if (victim) {
    f[jBase + CHO_L_JIYU_VICTIM_] = victim;
    if (victim === "申請者以外") {
      setJ(jBase + CHO_L_JIYU_VICTIM_ + "/申請者以外/住所", jiyu("G22"));
      setJ(jBase + CHO_L_JIYU_VICTIM_ + "/申請者以外/氏名", jiyu("G23"));
    }
  } else if (victimRaw !== "") {
    issues.push(Cho_issue_("odd", "warn", JIYU, "E22", "被害者区分", victimRaw, "",
      "証明書 E22 被害者区分「" + victimRaw + "」は様式の区分に対応がありません。"));
  }
  setJ(jBase + CHO_L_JIYU_TIME_,    jiyu("E24"));
  setJ(jBase + CHO_L_JIYU_AREA_,    jiyu("E25"));
  setJ(jBase + CHO_L_JIYU_CONTENT_, jiyu("E26"));
  setJ(jBase + CHO_L_JIYU_REASON_,  jiyu("E27"));
  setJ(jBase + CHO_L_REMARKS_,      jiyu("E28"));

  // 確認用（桃セル）: 集計値は displayFields へ。プレビューに桃色行で表示するのみで保存はしない
  // （種数・捕獲方法はフォームの substitution が子から自動集計し、桃の不整合は取り込み時に検出済み）。
  var displayFields = {};
  Cho_importConfirm_(app, jiyu, applicantType, displayFields);

  return { type: applicantType, fields: f, displayFields: displayFields };
}

// 桃（確認用）セルの集計値を out["確認用/..."] へ取り込む（非空のみ）。呼び出し側は displayFields を
// 渡し、プレビュー表示専用とする（保存しない）。集計系（ほか名数・捕獲方法・種ごと数量）のみ両モードで
// 取り込む。同定系（住所/氏名/職業/生年月日/証明書住所・氏名）は取り込まず、Cho_checkPinkConsistency_
// で名簿と照合するだけ（不一致は pink_inconsistent）。
function Cho_importConfirm_(app, jiyu, applicantType, out) {
  var CONF = CHO_L_CONFIRM_, CONFSP = CHO_L_CONFIRM_ + "/" + CHO_L_CONFIRM_SPECIES_;
  function setStr(path, v) { var s = Cho_str_(v); if (s !== "") out[path] = s; }
  function setNum(path, v) { var n = Cho_toNumberOrText_(v); if (n !== "") out[path] = n; }

  // 集計系（両モード）
  setNum(CONF + "/ほか従事者数", app("J9"));
  setStr(CONF + "/捕獲方法", app("E30"));
  for (var i = 0; i < CHO_APP_SPECIES_.length; i++) {
    var e = CHO_APP_SPECIES_[i];
    setNum(CONFSP + "/" + e.sp + "捕獲数", app(e.count));
    if (e.bird && e.egg) setNum(CONFSP + "/" + e.sp + "採取卵数", app(e.egg));
  }
}

// 用具リストを CHO_TOOL_ORDER_ 順に並べ替える（未知は末尾。重複は除去済み前提）。
function Cho_orderTools_(seen) {
  var ordered = [];
  for (var o = 0; o < CHO_TOOL_ORDER_.length; o++) if (seen.indexOf(CHO_TOOL_ORDER_[o]) !== -1) ordered.push(CHO_TOOL_ORDER_[o]);
  for (var s = 0; s < seen.length; s++) if (ordered.indexOf(seen[s]) === -1) ordered.push(seen[s]);
  return ordered;
}
// 取り込んだ子 1 人の方法フィールド（カテゴリ＋わな/網/銃器の各葉）から実際の捕獲用具を平坦化。
// 様式 P 列（名簿）に積層された用具と 1:1 で対応する。確認表示・E30 照合の両方で使う。
function Cho_workerTools_(f) {
  var M = CHO_L_CHILD_METHOD_, seen = [];
  function push(t) { if (t && seen.indexOf(t) === -1) seen.push(t); }
  if (Cho_splitChecks_(f[M]).indexOf("手捕り") !== -1) push("手捕り");
  var keys = ["わな/道具の種類", "網/道具の種類", "銃器/銃の種類"];
  for (var k = 0; k < keys.length; k++) {
    var parts = Cho_splitChecks_(f[M + "/" + keys[k]]);
    for (var p = 0; p < parts.length; p++) push(parts[p]);
  }
  return Cho_orderTools_(seen);
}
// 取り込んだ子（名簿）から用具の和集合（CHO_TOOL_ORDER_ 順、未知は末尾）。E30 照合用。
function Cho_unionToolsFromImport_(workers) {
  var seen = [];
  function push(t) { if (t && seen.indexOf(t) === -1) seen.push(t); }
  for (var w = 0; w < workers.length; w++) {
    var ts = Cho_workerTools_(workers[w]);
    for (var i = 0; i < ts.length; i++) push(ts[i]);
  }
  return Cho_orderTools_(seen);
}

// 桃（確認）セルを名簿（=正）から再計算して照合。actual が空なら必ず skip（誤検知回避）。
function Cho_checkPinkConsistency_(reader, workers, applicantType, issues) {
  var APP = "申請書", JIYU = "証明書", SP = CHO_L_CHILD_SPECIES_;
  function app(a1) { return reader.cell(APP, a1); }
  function jiyu(a1) { return reader.cell(JIYU, a1); }

  // 取り込んだ子から種ごとの合算（頭数/卵数）を再構成
  var totals = {};
  for (var w = 0; w < workers.length; w++) {
    for (var s = 0; s < CHO_SPECIES_ORDER_.length; s++) {
      var sp = CHO_SPECIES_ORDER_[s];
      var hk = workers[w][SP + "/" + sp + "/捕獲頭数"], ek = workers[w][SP + "/" + sp + "/採取卵数"];
      if (!totals[sp]) totals[sp] = { count: 0, egg: 0 };
      if (typeof hk === "number") totals[sp].count += hk;
      if (typeof ek === "number") totals[sp].egg += ek;
    }
  }

  // 種数/卵数（両モード）。CHO_APP_SPECIES_ がセル割当の唯一の源（I24=ノイヌ数 等の罠を回避）。
  for (var i = 0; i < CHO_APP_SPECIES_.length; i++) {
    var e = CHO_APP_SPECIES_[i], t = totals[e.sp] || { count: 0, egg: 0 };
    Cho_comparePinkNum_(issues, APP, e.count, e.sp + " 捕獲数", app(e.count), t.count);
    if (e.bird && e.egg) Cho_comparePinkNum_(issues, APP, e.egg, e.sp + " 卵数", app(e.egg), t.egg);
  }

  // ほかN名 J9 = 従事者数 - 1
  if (workers.length > 0) Cho_comparePinkNum_(issues, APP, "J9", "ほかN名", app("J9"), workers.length - 1);

  // 方法 E30 = 名簿用具の和集合（順不同で照合）
  Cho_comparePinkSet_(issues, APP, "E30", "捕獲方法", app("E30"), Cho_unionToolsFromImport_(workers));

  // 申請者同定（個人モードのみ。法人は独立リテラルなので照合しない）。
  // 氏名＋生年月日で従事者一覧から本人を特定し、不在なら pink。見つかれば住所等をその本人と照合。
  // appName/appBirth が空なら丸ごと skip（個人様式の桃セルは数式で未再計算時に空＝誤検知回避の要）。
  if (applicantType !== "法人" && workers.length > 0) {
    var appName = Cho_str_(app("F8")), appBirth = Cho_dateCanon_(app("F10"));
    if (appName !== "" && appBirth !== "") {
      var rep = null;
      for (var m = 0; m < workers.length; m++) {
        if (Cho_str_(workers[m]["氏名"]) === appName && Cho_dateCanon_(workers[m]["生年月日"]) === appBirth) { rep = workers[m]; break; }
      }
      if (!rep) {
        issues.push(Cho_issue_("pink_inconsistent", "warn", APP, "F8", "申請者(確認用)", appName + "(" + appBirth + ")", "",
          APP + " F8 申請者 \"" + appName + "(" + appBirth + ")\" が従事者一覧に見つかりません"));
      } else {
        // 氏名(F8)・生年月日(F10) はマッチ条件で一致確認済み。残りの同定項目を本人と照合。
        Cho_comparePinkText_(issues, APP, "F6", "住所(確認用)", app("F6"), Cho_str_(rep["住所"]));
        Cho_comparePinkText_(issues, APP, "F11", "職業(確認用)", app("F11"), Cho_str_(rep["職業"]));
        Cho_comparePinkText_(issues, JIYU, "H4", "住所(証明書)", jiyu("H4"), Cho_str_(rep["住所"]));
        Cho_comparePinkText_(issues, JIYU, "H5", "氏名(証明書)", jiyu("H5"), Cho_str_(rep["氏名"]));
      }
    }
  }
}

// リーダ → { parent:{fields}, children:[{fields}], issues:[…], warnings:[…] }
// forcedType（"個人"/"法人"）= 取り込み画面のラジオ選択。未指定なら自動判定。
function Cho_buildImport_(reader, forcedType) {
  var issues = [];
  var workers = [];
  for (var b = 0; b < CHO_ROSTER_.blockCount; b++) {
    var top = CHO_ROSTER_.firstRow + b * CHO_ROSTER_.blockHeight;
    var f = Cho_importRosterBlock_(reader, top, b === 0, issues);
    if (f) workers.push(f);
  }
  // 11 人目以降は枠を超える → 取り込めなかったものとして検出
  var overflowTop = CHO_ROSTER_.firstRow + CHO_ROSTER_.blockCount * CHO_ROSTER_.blockHeight;
  if (Cho_importRosterBlock_(reader, overflowTop, false, [])) {
    issues.push(Cho_issue_("dropped", "error", CHO_ROSTER_.sheetName, CHO_ROSTER_.cols.name + overflowTop, "従事者11人目以降", "", "",
      "従事者名簿の枠(" + CHO_ROSTER_.blockCount + "人)を超える従事者があり取り込めませんでした。"));
  }
  if (workers.length === 0) issues.push(Cho_issue_("odd", "warn", CHO_ROSTER_.sheetName, "", "従事者", "", "",
    "従事者名簿に従事者が見つかりませんでした。"));
  var parent = Cho_importParent_(reader, workers, issues, forcedType);
  Cho_checkPinkConsistency_(reader, workers, parent.type, issues);
  return { parent: parent, children: workers, issues: issues, warnings: Cho_issuesToWarnings_(issues) };
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

// ----- GAS I/O: Drive xlsx → Google Sheet 変換 → セル読み取り → import モデル -----
// 様式 xlsx（Drive ファイル ID）を Sheets へ複製して読み取り、import モデルを返す。
// 一時 Sheets は finally で必ず削除する（元の xlsx は呼び出し側の責任）。
function Cho_parseXlsxFile_(fileId, forcedType) {
  if (!fileId) throw new Error("driveFileId がありません（様式 xlsx の Drive ファイル ID を渡してください）。");
  var convertedId = null;
  try {
    var converted = Drive.Files.copy({ title: "_nfb_import_tmp", mimeType: "application/vnd.google-apps.spreadsheet" }, fileId);
    convertedId = converted.id;
    var ss = SpreadsheetApp.openById(convertedId);
    var valuesBySheet = Cho_readSheetValues_(ss);
    var reader = Cho_makeReader_(valuesBySheet);
    return Cho_buildImport_(reader, forcedType);
  } finally {
    if (convertedId) { try { Drive.Files.remove(convertedId); } catch (e2) { /* no-op */ } }
  }
}

// 後方互換（mode=import 直接取り込み）: xlsx → uploadRecords(JSON)。
function Cho_handleImport_(data, e) {
  var fileId = data.driveFileId || (e && e.parameter && e.parameter.driveFileId);
  try {
    var imp = Cho_parseXlsxFile_(fileId, data.applicantType || (e && e.parameter && e.parameter.applicantType) || "");
    var out = Cho_buildUploadRecords_(imp, data.parentRecordId || "");
    out.ok = true;
    out.warnings = imp.warnings;
    out.issues = imp.issues;
    out.summary = { applicantType: imp.parent.type, workerCount: imp.children.length, issueCounts: Cho_countIssues_(imp.issues) };
    return out;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
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

// 取り込み先（親=申請書 / 子=従事者名簿）のスプレッドシートへのリンクブロック。取り込み画面の冒頭に出し、
// 書き込み先を取り込み前に確認できるようにする。id が空（リレー未受信・未登録）なら「未解決」を表示する。
function Cho_buildSheetLinksHtml_(targets) {
  function row(label, id) {
    if (id) {
      var url = "https://docs.google.com/spreadsheets/d/" + id;
      return '<div><b>' + escapeHtml_(label) + '</b>：<a href="' + escapeHtml_(url) + '" target="_blank" rel="noopener">スプレッドシートを開く</a></div>';
    }
    return '<div><b>' + escapeHtml_(label) + '</b>：<span class="warn">未解決（検索画面の管理者ボタンから開くと自動設定されます）</span></div>';
  }
  return '<div class="sec" id="sheetlinks"><div class="info">書き込み先スプレッドシート</div>' +
    row("親フォーム（申請書）", targets && targets.parentSpreadsheetId) +
    row("子フォーム（従事者名簿）", targets && targets.childSpreadsheetId) +
    '</div>';
}

// アップロード/プレビュー画面（HtmlService）。xlsx を選ぶと「分かりやすい表 + チェックボックス」で
// 取り込み内容を確認し、選んだ分だけ親子スプレッドシートへ直接書き込む。HTML はテンプレートリテラルで
// 組み立てる（クライアント JS の二重引用符を素のまま書けるようにし、エスケープ起因のバグを避ける）。
// 構造タグ（<script>/<style>）を含むが、ここは本体バンドルの再パースではなく単一文書の createHtmlOutput
// なので安全（メモリ gas-doget-no-structural-html-literals は本体側の往復を指す）。
function Cho_renderUploadPage_(ctxToken) {
  var token = String(ctxToken == null ? "" : ctxToken);
  var ctxJs = JSON.stringify(token);
  var linksHtml = Cho_buildSheetLinksHtml_(Cho_resolveTargets_(token));
  var html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>様式の取り込み</title>
<style>
body{font-family:-apple-system,"Segoe UI",Roboto,"Noto Sans JP",sans-serif;background:#f8f9fa;margin:0;padding:24px;color:#202124;}
.card{max-width:920px;margin:0 auto;background:#fff;border:1px solid #dadce0;border-radius:8px;padding:20px 24px;}
h1{font-size:18px;color:#1a73e8;}h2{font-size:14px;margin:18px 0 6px;}
label{font-size:13px;}label.blk{display:block;margin:12px 0 4px;}
input[type=text]{width:100%;padding:6px;box-sizing:border-box;}
button{margin-top:14px;padding:8px 16px;font-size:14px;cursor:pointer;}
button#commit{background:#1a73e8;color:#fff;border:none;border-radius:4px;}
#status{margin-top:12px;font-size:13px;}#result{margin-top:12px;font-size:13px;}
.warn{color:#b06000;}.err{color:#c5221f;}.info{color:#5f6368;}.ok{color:#188038;font-weight:bold;}
.sec{border:1px solid #e0e0e0;border-radius:6px;padding:10px 12px;margin:8px 0;}
.chk{display:block;margin-bottom:6px;}
table.kv{border-collapse:collapse;width:100%;font-size:12px;}
table.kv th{text-align:left;color:#5f6368;font-weight:normal;padding:2px 8px 2px 0;vertical-align:top;white-space:nowrap;}
table.kv td{padding:2px 0;word-break:break-all;}
table.kv tr.confirm th,table.kv tr.confirm td{color:#c2185b;}
#issues h3{font-size:13px;margin:12px 0 4px;}#issues ul{margin:0 0 8px;padding-left:18px;font-size:12px;}
#issues li{margin:2px 0;}#issues .none{color:#188038;font-size:12px;}
#commitWrap{display:none;margin-top:16px;border-top:1px solid #dadce0;padding-top:8px;}
</style></head><body><div class="card">
<h1>鳥獣保護管理法様式の取り込み（Excel → スプレッドシート）</h1>
<p>記入済みの様式（xlsx）を選んで「取り込み内容を確認」を押すと、取り込む内容を表で確認できます。
取り込みたい申請・従事者にチェックを入れて「選択分をスプレッドシートへ取り込む」を押すと、親フォーム（申請書）と
子フォーム（従事者名簿）のスプレッドシートへ直接書き込み、Excel を親レコードのアップロード欄へ添付します。</p>
${linksHtml}
<label class="blk">様式ファイル (.xlsx)</label><input type="file" id="file" accept=".xlsx">
<label class="blk">申請者区分（様式に合わせて選択）</label>
<label><input type="radio" name="atype" value="個人" checked> 個人</label>
&nbsp;&nbsp;<label><input type="radio" name="atype" value="法人"> 法人</label>
<label class="blk">親レコードID（同じ申請を上書きしたいときだけ指定。空なら新規）</label><input type="text" id="pid" placeholder="r_...">
<button id="go">取り込み内容を確認</button>
<div id="status"></div>
<div id="issues"></div>
<div id="preview"></div>
<div id="commitWrap"><button id="commit">選択分をスプレッドシートへ取り込む</button><div id="result"></div></div>
</div>
<script>
var CTX=${ctxJs};
var EXCEL="";
function $(i){return document.getElementById(i);}
function atype(){var r=document.querySelector('input[name="atype"]:checked');return r?r.value:"個人";}
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function tbl(rows){if(!rows||!rows.length)return "<div class='info'>（項目なし）</div>";var h="<table class='kv'>";for(var i=0;i<rows.length;i++){var c=rows[i].confirm?" class='confirm'":"";h+="<tr"+c+"><th>"+esc(rows[i].label)+"</th><td>"+esc(rows[i].value)+"</td></tr>";}return h+"</table>";}
function renderIssues(list){var groups={dropped:{t:"取り込めなかったもの",items:[]},pink_inconsistent:{t:"ピンクのセルで整合性がとれないもの",items:[]},odd:{t:"おかしいもの",items:[]}};for(var i=0;i<list.length;i++){var g=groups[list[i].category];if(g)g.items.push(list[i]);}var order=["dropped","pink_inconsistent","odd"],html="";for(var k=0;k<order.length;k++){var g=groups[order[k]];html+="<h3>"+g.t+" ("+g.items.length+")</h3>";if(!g.items.length){html+="<div class='none'>なし</div>";continue;}html+="<ul>";for(var j=0;j<g.items.length;j++){var it=g.items[j],loc=(it.sheet||"")+(it.cell?("!"+it.cell):""),sev=it.severity==="error"?"err":(it.severity==="info"?"info":"warn");html+="<li class='"+sev+"'>"+(loc?("["+esc(loc)+"] "):"")+esc(it.message)+"</li>";}html+="</ul>";}$("issues").innerHTML=html;}
function renderPreview(res){EXCEL=res.excelFileId||"";var f=res.friendly||{};var ap=f.applicant||{};var html="";html+="<div class='sec'><label class='chk'><input type='checkbox' id='chkParent' checked> <b>この申請を取り込む</b>（"+esc(ap.type||"")+(ap.name?(" / "+esc(ap.name)):"")+"）</label>"+tbl(ap.rows||[])+"</div>";var ws=f.workers||[];html+="<h2>従事者（"+ws.length+" 名）</h2>";for(var i=0;i<ws.length;i++){var w=ws[i];html+="<div class='sec'><label class='chk'><input type='checkbox' class='chkChild' data-idx='"+w.index+"' checked> <b>"+esc(w.title)+"</b></label>"+tbl(w.rows||[])+"</div>";}$("preview").innerHTML=html;$("commitWrap").style.display="block";}
$("go").onclick=function(){var f=$("file").files[0];if(!f){$("status").textContent="ファイルを選んでください";return;}$("status").textContent="読み込み中...";$("issues").innerHTML="";$("preview").innerHTML="";$("result").innerHTML="";$("commitWrap").style.display="none";var r=new FileReader();r.onload=function(){var b64=r.result.split(",")[1];google.script.run.withSuccessHandler(function(res){if(res&&res.ok){var ic=(res.summary&&res.summary.issueCounts)||{};$("status").innerHTML="取り込み確認: "+esc(res.summary.applicantType)+" / 従事者 "+res.summary.workerCount+" 名 　<span class='err'>取込不可 "+(ic.dropped||0)+"</span> / <span class='warn'>要確認 "+(ic.odd||0)+"</span> / <span class='warn'>ピンク不整合 "+(ic.pink_inconsistent||0)+"</span>";renderIssues(res.issues||[]);renderPreview(res);}else{$("status").innerHTML="<span class='err'>失敗: "+esc(res&&res.error||"unknown")+"</span>";renderIssues([]);}}).withFailureHandler(function(e){$("status").innerHTML="<span class='err'>エラー: "+esc(e.message)+"</span>";}).Cho_uploadAndImport(b64,f.name,CTX,atype());};r.readAsDataURL(f);};
$("commit").onclick=function(){if(!EXCEL){$("status").textContent="先に Excel を取り込んでください";return;}var sel={parent:$("chkParent")?$("chkParent").checked:true,childIndexes:[],parentRecordId:$("pid").value||""};var cc=document.querySelectorAll(".chkChild");for(var i=0;i<cc.length;i++){if(cc[i].checked)sel.childIndexes.push(Number(cc[i].getAttribute("data-idx")));}$("status").textContent="スプレッドシートへ書き込み中...";$("commit").disabled=true;google.script.run.withSuccessHandler(function(res){$("commit").disabled=false;if(res&&res.ok){var w=res.written||{};var msg="取り込み完了: 親 "+(w.parent?"1":"0")+" 件 / 従事者 "+(w.children||0)+" 件。";if(res.warnings&&res.warnings.length)msg+=" 注意: "+res.warnings.join(" / ");var su=res.sheetUrls||{};$("result").innerHTML="<span class='ok'>"+esc(msg)+"</span><br><a href='"+esc(su.parent||"")+"' target='_blank'>親シートを開く</a> ／ <a href='"+esc(su.child||"")+"' target='_blank'>子シートを開く</a>";$("commitWrap").style.display="none";}else{$("result").innerHTML="<span class='err'>失敗: "+esc(res&&res.error||"unknown")+"</span>";}}).withFailureHandler(function(e){$("commit").disabled=false;$("result").innerHTML="<span class='err'>エラー: "+esc(e.message)+"</span>";}).Cho_commitImport(EXCEL,JSON.stringify(sel),CTX,atype());};
</script></body></html>`;
  return HtmlService.createHtmlOutput(html).setTitle("様式の取り込み").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// スコープ再認証トリガ: エディタで一度実行すると drive スコープの同意画面が出る。
// （マニフェストに drive を足しただけではウェブアプリは再同意を求めず権限不足で失敗するため）
function Cho_authorize() {
  DriveApp.getRootFolder().getName();      // https://www.googleapis.com/auth/drive
  Drive.Files.list({ maxResults: 1 });     // Advanced Drive Service v2
  SpreadsheetApp.getActiveSpreadsheet();   // https://www.googleapis.com/auth/spreadsheets（書き込み用）
  Session.getActiveUser().getEmail();      // userinfo.email（createdBy 用）
  return "authorized";
}

// プレビュー段階: base64 xlsx → 添付用に Drive へ永続化 → 解析 → 分かりやすい表 + issues を返す。
// 注: google.script.run から呼ぶため末尾アンダースコア不可。
function Cho_uploadAndImport(base64, filename, ctxToken, applicantType) {
  try {
    var bytes = Utilities.base64Decode(base64);
    var blob = Utilities.newBlob(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename || "import.xlsx");
    var folder = Cho_resolveUploadFolder_();
    var file = folder.createFile(blob);       // 添付用に残す（コミット時に親レコードへ添付）
    var imp = Cho_parseXlsxFile_(file.getId(), applicantType || "");
    return {
      ok: true,
      excelFileId: file.getId(),
      excelName: file.getName(),
      friendly: Cho_buildFriendly_(imp),
      issues: imp.issues,
      warnings: imp.warnings,
      summary: { applicantType: imp.parent.type, workerCount: imp.children.length, issueCounts: Cho_countIssues_(imp.issues) }
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// コミット段階: 永続 Excel を再パース（ブラウザ送信値は信用しない）→ 選択分を親子シートへ直接書き込む。
function Cho_commitImport(excelFileId, selectionJson, ctxToken, applicantType) {
  try {
    if (!excelFileId) return { ok: false, error: "Excel ファイルIDがありません。もう一度アップロードしてください。" };
    var selection = (typeof selectionJson === "string") ? JSON.parse(selectionJson || "{}") : (selectionJson || {});
    var targets = Cho_resolveTargets_(ctxToken);
    if (!targets.parentSpreadsheetId) return { ok: false, error: "親フォームのスプレッドシートIDが未設定です（エディタで Cho_registerWriteTargets を実行して登録してください）。" };
    if (!targets.childSpreadsheetId) return { ok: false, error: "子フォーム（従事者名簿）のスプレッドシートIDが未設定です。" };
    var imp = Cho_parseXlsxFile_(excelFileId, applicantType || "");
    return Cho_writeRecordsDirect_(imp, excelFileId, selection, targets);
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}


// #############################################################################
// ## write.gs — 親子シートへの直接書き込み（本体 SyncRecords_ の新規行分岐を移植）
// #############################################################################
//
// 本体 gas/ の保存層と byte 互換な行を append する。ヘッダは読むだけ（列の挿入/移動はしない）。
// スキーマは持たないので、日付は値の形（YYYY-MM-DD）で判定し、それ以外はテキスト("@")にする。

// ----- 本体 gas/constants.gs から移植した定数 -----
var NFB_HEADER_DEPTH = 11;
var NFB_HEADER_START_ROW = 1;
var NFB_DATA_START_ROW = NFB_HEADER_START_ROW + NFB_HEADER_DEPTH; // 12
var NFB_DEFAULT_SHEET_NAME = "Data";
var NFB_TZ = "Asia/Tokyo";
var NFB_SHEETS_DATE_FORMAT = "yyyy/mm/dd";
var NFB_SHEETS_TIME_FORMAT = "hh:mm:ss";
var NFB_SHEETS_DATETIME_FORMAT = "yyyy/mm/dd hh:mm:ss";
var NFB_SHEETS_TEXT_FORMAT = "@";
var NFB_PATH_SEP = "/";
var NFB_LOCK_WAIT_TIMEOUT_MS = 10000;
var NFB_FIXED_HEADER_PATHS = [["id"], ["No."], ["createdAt"], ["modifiedAt"], ["deletedAt"], ["createdBy"], ["modifiedBy"], ["deletedBy"], ["pid"]];
var NFB_RESERVED_HEADER_KEYS = {};
(function () { for (var i = 0; i < NFB_FIXED_HEADER_PATHS.length; i++) NFB_RESERVED_HEADER_KEYS[NFB_FIXED_HEADER_PATHS[i][0]] = true; })();

// ----- 本体 gas/pathCodec.gs から移植（可逆エスケープ "/" 連結）-----
function Nfb_escapeSegment_(segment, sep) {
  var s = String(segment === null || segment === undefined ? "" : segment);
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (ch === "\\" || ch === sep) out += "\\";
    out += ch;
  }
  return out;
}
function Nfb_joinEscaped_(segments, sep) {
  if (!Array.isArray(segments)) return "";
  var out = [];
  for (var i = 0; i < segments.length; i++) out.push(Nfb_escapeSegment_(segments[i], sep));
  return out.join(sep);
}
function Nfb_splitEscaped_(text, sep, allowQuotes) {
  var str = String(text === null || text === undefined ? "" : text);
  var tokens = [];
  var current = "";
  var escaping = false;
  var quote = null;
  var i = 0;
  while (i < str.length) {
    var ch = str[i];
    if (escaping) { current += ch; escaping = false; i++; continue; }
    if (ch === "\\") { escaping = true; i++; continue; }
    if (quote) {
      if (ch === quote) {
        if (str[i + 1] === quote) { current += quote; i += 2; continue; }
        quote = null; i++; continue;
      }
      current += ch; i++; continue;
    }
    if (allowQuotes && (ch === "'" || ch === '"')) { quote = ch; i++; continue; }
    if (ch === sep) { tokens.push(current); current = ""; i++; continue; }
    current += ch; i++;
  }
  if (escaping) current += "\\";
  tokens.push(current);
  return tokens;
}
function Nfb_joinFieldPath_(segments) {
  return Nfb_joinEscaped_(segments, NFB_PATH_SEP);
}
function Nfb_splitFieldKey_(key) {
  if (key === null || key === undefined || key === "") return [];
  return Nfb_splitEscaped_(key, NFB_PATH_SEP, false);
}

// ----- 本体 gas/sheetsHeaders.gs / sheetsRecords.gs から移植（ヘッダ→列マップ）-----
function Sheets_normalizeHeaderSegment_(segment) {
  if (segment === undefined || segment === null) return "";
  return String(segment).replace(/\r\n?/g, "\n").trim();
}
function Sheets_normalizeHeaderPath_(path) {
  var normalized = [];
  if (!Array.isArray(path)) return normalized;
  for (var i = 0; i < path.length && i < NFB_HEADER_DEPTH; i++) {
    var segment = Sheets_normalizeHeaderSegment_(path[i]);
    if (!segment) break;
    normalized.push(segment);
  }
  return normalized;
}
function Sheets_pathKey_(path) {
  return Nfb_joinFieldPath_(Sheets_normalizeHeaderPath_(path));
}
function Sheets_normalizeHeaderKey_(key) {
  if (key === undefined || key === null) return "";
  return Sheets_pathKey_(Nfb_splitFieldKey_(key));
}
function Sheets_normalizeRecordDataKeys_(data) {
  var normalized = {};
  if (!data || typeof data !== "object") return normalized;
  for (var key in data) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    var normalizedKey = Sheets_normalizeHeaderKey_(key);
    if (!normalizedKey || Object.prototype.hasOwnProperty.call(normalized, normalizedKey)) continue;
    normalized[normalizedKey] = data[key];
  }
  return normalized;
}
function Sheets_extractColumnPaths_(matrix) {
  var paths = [];
  if (!matrix || !matrix.length) return paths;
  for (var col = 0; col < matrix[0].length; col++) {
    var path = [];
    for (var row = 0; row < NFB_HEADER_DEPTH; row++) {
      var cell = Sheets_normalizeHeaderSegment_(matrix[row] ? matrix[row][col] : "");
      if (!cell) break;
      path.push(cell);
    }
    if (path.length) paths.push(path);
  }
  return paths;
}
function Sheets_readColumnPaths_(sheet, lastColumn) {
  var headerMatrix = sheet.getRange(NFB_HEADER_START_ROW, 1, NFB_HEADER_DEPTH, lastColumn).getValues();
  var columnPaths = [];
  for (var col = 0; col < lastColumn; col++) {
    var path = [];
    for (var row = 0; row < NFB_HEADER_DEPTH; row++) {
      var cell = Sheets_normalizeHeaderSegment_(headerMatrix[row][col]);
      if (!cell) break;
      path.push(cell);
    }
    if (path.length) columnPaths.push({ index: col, path: path, key: Sheets_pathKey_(path) });
  }
  return columnPaths;
}
function Sheets_buildHeaderKeyMap_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (!lastColumn) return {};
  var values = sheet.getRange(NFB_HEADER_START_ROW, 1, NFB_HEADER_DEPTH, lastColumn).getValues();
  var paths = Sheets_extractColumnPaths_(values);
  var map = {};
  for (var col = 0; col < paths.length; col++) map[Sheets_pathKey_(paths[col])] = col + 1;
  return map;
}
function Sheets_buildFixedColMapFromPaths_(columnPaths) {
  var map = {};
  if (!columnPaths || !columnPaths.length) return map;
  for (var i = 0; i < columnPaths.length; i++) {
    var p = columnPaths[i];
    if (p && p.path && p.path.length === 1 && NFB_RESERVED_HEADER_KEYS[p.path[0]]) map[p.path[0]] = p.index;
  }
  return map;
}
function Sheets_buildFixedColMapFromSheet_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (!lastColumn) return {};
  return Sheets_buildFixedColMapFromPaths_(Sheets_readColumnPaths_(sheet, lastColumn));
}
function Sheets_ensureRowCapacity_(sheet, minRows) {
  if (sheet.getMaxRows() < minRows) sheet.insertRowsAfter(sheet.getMaxRows() || 1, minRows - sheet.getMaxRows());
}

// ----- 本体 gas/sheetsRowOps.gs / sheetsDatetime.gs から移植（数式中和・pid 刻印・日時）-----
function Sheets_neutralizeFormulaPrefix_(s) {
  if (typeof s !== "string" || s.length === 0) return s;
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}
function Sheets_stampPid_(rowData, colIdx0, pid, lastColumn) {
  if (!pid) return;
  if (typeof colIdx0 !== "number" || colIdx0 < 0 || colIdx0 >= lastColumn) return;
  rowData[colIdx0] = Sheets_neutralizeFormulaPrefix_(pid);
}
function Sheets_isValidDate_(date) {
  return date instanceof Date && !isNaN(date.getTime());
}
function Sheets_unixMsToSheetDate_(unixMs) {
  if (typeof unixMs !== "number" || !isFinite(unixMs)) return null;
  var d = new Date(unixMs);
  return isNaN(d.getTime()) ? null : d;
}
// canonical 文字列 → シート用 Date（本体 Sheets_canonicalToSheetDate_ のトリム版。kind ∈ {"date","time"}）。
function Cho_canonicalToSheetDate_(canonical, kind) {
  if (typeof canonical !== "string") return null;
  var s = canonical.replace(/^\s+|\s+$/g, "");
  if (!s) return null;
  if (kind === "time") {
    var tm = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,3}))?)?$/);
    if (!tm) return null;
    var hh = parseInt(tm[1], 10), mi = parseInt(tm[2], 10), ss = tm[3] ? parseInt(tm[3], 10) : 0;
    var ms = tm[4] ? parseInt((tm[4] + "000").substring(0, 3), 10) : 0;
    if (hh > 23 || mi > 59 || ss > 59) return null;
    return new Date(1899, 11, 30, hh, mi, ss, ms);
  }
  var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T \s_](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,3}))?)?)?$/);
  if (!m) return null;
  var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  var h = m[4] ? parseInt(m[4], 10) : 0, mn = m[5] ? parseInt(m[5], 10) : 0, sc = m[6] ? parseInt(m[6], 10) : 0;
  var msd = m[7] ? parseInt((m[7] + "000").substring(0, 3), 10) : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mn > 59 || sc > 59) return null;
  return new Date(y, mo - 1, d, h, mn, sc, msd);
}

// 値 → セル書き込み値 + 数値書式。スキーマ無しなので値の形で判定する。
//   空 → ""(@)、YYYY-MM-DD → 日付(Date,yyyy/mm/dd)、Date → date/datetime、その他/数値 → テキスト(@)。
// choju の取り込みは date を canonical 文字列、数量を数値で出す。number 列も本体同様 "@"（テキスト）に揃える。
// 注意: time/datetime 文字列（"HH:mm"）は出さない前提。node テストで混入をガードする（メモリ datetime-canonical-types）。
function Cho_resolveCell_(value) {
  if (value === undefined || value === null || value === "") {
    return { value: "", numberFormat: NFB_SHEETS_TEXT_FORMAT };
  }
  if (typeof value === "string") {
    var s = value.replace(/^\s+|\s+$/g, "");
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
      var d = Cho_canonicalToSheetDate_(s, "date");
      if (d && !isNaN(d.getTime())) return { value: d, numberFormat: NFB_SHEETS_DATE_FORMAT };
    }
    return { value: Sheets_neutralizeFormulaPrefix_(value), numberFormat: NFB_SHEETS_TEXT_FORMAT };
  }
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return { value: "", numberFormat: NFB_SHEETS_TEXT_FORMAT };
    var midnight = value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0 && value.getMilliseconds() === 0;
    return { value: value, numberFormat: midnight ? NFB_SHEETS_DATE_FORMAT : NFB_SHEETS_DATETIME_FORMAT };
  }
  return { value: Sheets_neutralizeFormulaPrefix_(String(value)), numberFormat: NFB_SHEETS_TEXT_FORMAT };
}

// 新規行（rowData / rowFormats）を組み立てる純関数（GAS 非依存・テスト可能）。
// 固定メタ列は fixedColMap で動的解決（本体は位置直書きだが、ここは安全側で常に解決する）。
function Cho_buildNewRow_(keyToColumn, fixedColMap, lastColumn, rec, maxNo, now, email) {
  var rowData = new Array(lastColumn);
  var rowFormats = new Array(lastColumn);
  for (var c = 0; c < lastColumn; c++) { rowData[c] = ""; rowFormats[c] = "General"; }
  var setMeta = function (metaKey, value, fmt) {
    var idx = (fixedColMap && Object.prototype.hasOwnProperty.call(fixedColMap, metaKey)) ? fixedColMap[metaKey] : -1;
    if (idx < 0 || idx >= lastColumn) return;
    rowData[idx] = value;
    if (fmt) rowFormats[idx] = fmt;
  };
  var nowDate = Sheets_unixMsToSheetDate_(now);
  setMeta("id", (rec && rec.id) || "");
  setMeta("No.", (typeof maxNo === "number" ? maxNo : 0) + 1);
  setMeta("createdAt", nowDate || "", NFB_SHEETS_DATETIME_FORMAT);
  setMeta("modifiedAt", nowDate || "", NFB_SHEETS_DATETIME_FORMAT);
  setMeta("deletedAt", "");
  setMeta("createdBy", email || "");
  setMeta("modifiedBy", email || "");
  setMeta("deletedBy", "");
  var pidIdx = (fixedColMap && Object.prototype.hasOwnProperty.call(fixedColMap, "pid")) ? fixedColMap.pid : -1;
  Sheets_stampPid_(rowData, pidIdx, rec && rec.pid, lastColumn);

  var normData = Sheets_normalizeRecordDataKeys_(rec && rec.data);
  for (var key in normData) {
    if (!Object.prototype.hasOwnProperty.call(normData, key)) continue;
    if (NFB_RESERVED_HEADER_KEYS[key]) continue;
    if (!Object.prototype.hasOwnProperty.call(keyToColumn, key)) continue;
    var colIdx = keyToColumn[key] - 1;
    if (colIdx < 0 || colIdx >= lastColumn) continue;
    var norm = Cho_resolveCell_(normData[key]);
    rowData[colIdx] = norm.value;
    if (norm.numberFormat) rowFormats[colIdx] = norm.numberFormat;
  }
  return { rowData: rowData, rowFormats: rowFormats };
}

// data のキーのうち、ヘッダ列に存在せず取り込まれなかった（非空の）キーを列挙する。
function Cho_collectDroppedKeys_(data, keyToColumn) {
  var dropped = [];
  var normData = Sheets_normalizeRecordDataKeys_(data);
  for (var key in normData) {
    if (!Object.prototype.hasOwnProperty.call(normData, key)) continue;
    if (NFB_RESERVED_HEADER_KEYS[key]) continue;
    var v = normData[key];
    if (v === "" || v === null || v === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(keyToColumn, key)) dropped.push(key);
  }
  return dropped;
}

function Cho_activeEmail_() {
  try { return Session.getActiveUser().getEmail() || ""; } catch (e) { return ""; }
}

// スプレッドシートを id で開き、TZ を Asia/Tokyo に揃え、対象シートを返す（無ければ throw）。
function Cho_getDataSheet_(spreadsheetId, sheetName) {
  if (!spreadsheetId) throw new Error("spreadsheetId が未指定です。");
  var ss;
  try { ss = SpreadsheetApp.openById(spreadsheetId); }
  catch (err) { throw new Error("スプレッドシートを開けません (" + spreadsheetId + "): " + (err && err.message ? err.message : err)); }
  try { if (ss.getSpreadsheetTimeZone() !== NFB_TZ) ss.setSpreadsheetTimeZone(NFB_TZ); } catch (e) { /* no-op */ }
  var name = sheetName || NFB_DEFAULT_SHEET_NAME;
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('シート "' + name + '" が見つかりません (' + spreadsheetId + ")。");
  return sheet;
}

// 1 レコードを末尾へ append（新規行のみ）。戻り値 { ok, row, id, warnings }。
function Cho_appendRow_(spreadsheetId, sheetName, rec) {
  var sheet = Cho_getDataSheet_(spreadsheetId, sheetName);
  var lastColumn = Math.max(sheet.getLastColumn(), 10);
  var keyToColumn = Sheets_buildHeaderKeyMap_(sheet);
  var fixedColMap = Sheets_buildFixedColMapFromSheet_(sheet);

  var noIdx0 = Object.prototype.hasOwnProperty.call(fixedColMap, "No.") ? fixedColMap["No."] : 1;
  var maxNo = 0;
  var lastRow = sheet.getLastRow();
  if (lastRow >= NFB_DATA_START_ROW) {
    var noVals = sheet.getRange(NFB_DATA_START_ROW, noIdx0 + 1, lastRow - NFB_DATA_START_ROW + 1, 1).getValues();
    for (var i = 0; i < noVals.length; i++) { var v = Number(noVals[i][0]); if (isFinite(v) && v > maxNo) maxNo = v; }
  }

  var built = Cho_buildNewRow_(keyToColumn, fixedColMap, lastColumn, rec, maxNo, Date.now(), Cho_activeEmail_());
  var warnings = Cho_collectDroppedKeys_(rec && rec.data, keyToColumn);

  var targetRow = (lastRow >= NFB_DATA_START_ROW) ? lastRow + 1 : NFB_DATA_START_ROW;
  Sheets_ensureRowCapacity_(sheet, targetRow);
  var range = sheet.getRange(targetRow, 1, 1, lastColumn);
  range.setNumberFormats([built.rowFormats]); // 値より先に書式（"1-1"→日付等の自動変換を防ぐ）
  range.setValues([built.rowData]);
  return { ok: true, row: targetRow, id: rec && rec.id, warnings: warnings };
}

// スクリプトロックで直列化（このスタンドアロンアプリ自身のロック。本体とは別プロジェクトなので相互排他はしない）。
function Cho_withLock_(label, fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(NFB_LOCK_WAIT_TIMEOUT_MS)) {
    return { ok: false, code: "LOCK_TIMEOUT", error: label + "処理が混み合っています。少し待ってから再実行してください。" };
  }
  try { return fn(); }
  finally {
    try { SpreadsheetApp.flush(); } catch (e) { /* no-op */ }
    lock.releaseLock();
  }
}

// ファイルアップロード欄のセル値（本体 nfbBuildDriveFileResponse_ と同形の JSON 文字列）。
function Cho_buildUploadCell_(file, folder) {
  return JSON.stringify({
    folderUrl: folder && typeof folder.getUrl === "function" ? folder.getUrl() : "",
    folderName: folder && typeof folder.getName === "function" ? folder.getName() : "",
    files: [{
      name: file && typeof file.getName === "function" ? file.getName() : "",
      driveFileId: file && typeof file.getId === "function" ? file.getId() : "",
      driveFileUrl: file && typeof file.getUrl === "function" ? file.getUrl() : ""
    }]
  });
}

// Excel を親レコードのアップロード欄へ添付する（parentData[fieldKey] に添付セル JSON を入れる）。
function Cho_attachExcelToParent_(excelFileId, fieldKey, parentData, warnings) {
  if (!fieldKey) { warnings.push("親フォームのアップロード項目キー（CHO_PARENT_UPLOAD_FIELD_KEY）が未設定のため Excel は添付されませんでした。"); return; }
  try {
    var file = DriveApp.getFileById(excelFileId);
    var folder = null;
    var parents = file.getParents();
    if (parents.hasNext()) folder = parents.next();
    parentData[fieldKey] = Cho_buildUploadCell_(file, folder);
  } catch (e) {
    warnings.push("Excel の添付に失敗しました: " + (e && e.message ? e.message : e));
  }
}

// 選択分（親 + 子インデックス）を親子シートへ直接書き込む。子は pid=親ID を刻む。
function Cho_writeRecordsDirect_(imp, excelFileId, selection, targets) {
  return Cho_withLock_("取り込み", function () {
    var parentId = (selection && selection.parentRecordId) ? String(selection.parentRecordId).replace(/^\s+|\s+$/g, "") : "";
    if (!parentId) parentId = Cho_generateRecordId_();
    var includeParent = !selection || selection.parent !== false; // 既定 true
    var childIndexes = (selection && Array.isArray(selection.childIndexes)) ? selection.childIndexes : null;
    var warnings = [];
    var parentWritten = false;
    var writtenChildren = 0;

    if (includeParent) {
      var parentData = {};
      var pf = imp.parent.fields || {};
      for (var k in pf) if (Object.prototype.hasOwnProperty.call(pf, k)) parentData[k] = pf[k];
      Cho_attachExcelToParent_(excelFileId, targets.parentUploadFieldKey, parentData, warnings);
      var pres = Cho_appendRow_(targets.parentSpreadsheetId, targets.sheetName, { id: parentId, data: parentData, pid: "" });
      if (pres && pres.warnings && pres.warnings.length) {
        warnings.push("親: 列が見つからず取り込まれなかった項目: " + pres.warnings.join(" / "));
      }
      parentWritten = true;
    }

    for (var i = 0; i < imp.children.length; i++) {
      if (childIndexes && childIndexes.indexOf(i) === -1) continue;
      var childId = parentId + "_c" + (i + 1);
      var cres = Cho_appendRow_(targets.childSpreadsheetId, targets.childSheetName, { id: childId, data: imp.children[i], pid: parentId });
      if (cres && cres.warnings && cres.warnings.length) {
        warnings.push("従事者" + (i + 1) + ": 列が見つからず取り込まれなかった項目: " + cres.warnings.join(" / "));
      }
      writtenChildren++;
    }

    return {
      ok: true,
      parentRecordId: parentId,
      written: { parent: parentWritten, children: writtenChildren },
      sheetUrls: {
        parent: "https://docs.google.com/spreadsheets/d/" + targets.parentSpreadsheetId,
        child: "https://docs.google.com/spreadsheets/d/" + targets.childSpreadsheetId
      },
      warnings: warnings
    };
  });
}


// #############################################################################
// ## friendly.gs — 取り込み内容を「分かりやすい表」用に整形（純関数）
// #############################################################################

// "a/b/c" → "a ＞ b ＞ c"（表示用の簡易ブレッドクラム。エスケープは無視の軽整形）。
function Cho_prettyLabel_(key) {
  return String(key == null ? "" : key).split("/").join(" ＞ ");
}
function Cho_fieldsToRows_(fields) {
  var rows = [];
  if (!fields || typeof fields !== "object") return rows;
  var confirmPrefix = CHO_L_CONFIRM_ + "/";
  for (var k in fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
    var v = fields[k];
    if (v === "" || v === null || v === undefined) continue;
    // 確認用（桃セル由来）は表示色を変えて「正データではない」ことを明示する。
    var isConfirm = (k === CHO_L_CONFIRM_ || k.indexOf(confirmPrefix) === 0);
    rows.push({ label: Cho_prettyLabel_(k), value: String(v), confirm: isConfirm });
  }
  return rows;
}
function Cho_buildFriendly_(imp) {
  var pf = (imp && imp.parent && imp.parent.fields) ? imp.parent.fields : {};
  var type = (imp && imp.parent && imp.parent.type) ? imp.parent.type : "";
  var name = "";
  if (type === "法人") {
    name = pf[CHO_L_APPLICANT_ + "/" + CHO_L_APPLICANT_TYPE_ + "/法人/法人名"] || "";
  } else if (imp && imp.children && imp.children[0]) {
    name = imp.children[0]["氏名"] || "";
  }
  var workers = [];
  var kids = (imp && imp.children) ? imp.children : [];
  for (var i = 0; i < kids.length; i++) {
    var w = kids[i] || {};
    var wrows = Cho_fieldsToRows_(w);
    // 確認用: カテゴリ（手捕り/わな/銃器…）ではなく、実際の捕獲用具を平坦化して表示する。
    // 様式の名簿 P 列・申請書 E30（確認用 ＞ 捕獲方法）と直接見比べられるようにするための表示専用行
    // （保存される子フィールドには加えない＝w を変更しない）。
    var wtools = Cho_workerTools_(w);
    if (wtools.length) wrows.push({ label: "捕獲用具一覧（確認用）", value: wtools.join(", "), confirm: true });
    workers.push({
      index: i,
      title: w["氏名"] ? String(w["氏名"]) : ("従事者 " + (i + 1)),
      rows: wrows
    });
  }
  // 申請者セクションは保存フィールドのみを表示する。捕獲方法の名簿照合は表示行を出さず、
  // 食い違いは Cho_comparePinkSet_ が出す E30 の pink_inconsistent（抽出レポート）に委ねる。
  var appRows = Cho_fieldsToRows_(pf);
  // 確認用（displayFields・桃セル由来の集計）はプレビュー画面でのみ confirm=true（桃色）行で表示し、保存しない。
  var df = (imp && imp.parent && imp.parent.displayFields) ? imp.parent.displayFields : {};
  for (var dfk in df) {
    if (!Object.prototype.hasOwnProperty.call(df, dfk)) continue;
    var dfv = df[dfk];
    if (dfv === "" || dfv === null || dfv === undefined) continue;
    appRows.push({ label: Cho_prettyLabel_(dfk), value: String(dfv), confirm: true });
  }
  return {
    applicant: { type: type, name: String(name || ""), rows: appRows },
    workers: workers
  };
}


// #############################################################################
// ## settings.gs — 書き込みターゲット / 誤送信防止シークレットの登録（Script Properties）
// #############################################################################

function Cho_props_() { return PropertiesService.getScriptProperties(); }
function Cho_getProp_(key, def) {
  try { var v = Cho_props_().getProperty(key); return (v === null || v === undefined) ? (def || "") : v; }
  catch (e) { return def || ""; }
}

// エディタから一度実行して保存先を登録する。引数は省略可（指定したものだけ上書き）。
//   parentSsId / childSsId: 各フォームの settings.spreadsheetId（データ保存先）
//   parentUploadFieldKey: 親フォームの file 項目の生ヘッダ・パス文字列（例 "添付ファイル"）
//   uploadFolderId: 取り込んだ Excel を残す Drive フォルダ（空なら My Drive ルート）
//   sheetName: データシート名（既定 "Data"）
//   extActionSecret: 本体管理者設定 NFB_EXT_ACTION_SECRET と同じ共有シークレット（本体で設定時のみ必須）
function Cho_registerWriteTargets(parentSsId, childSsId, parentUploadFieldKey, uploadFolderId, sheetName, extActionSecret, childSheetName) {
  var p = Cho_props_();
  if (parentSsId != null && parentSsId !== "") p.setProperty("CHO_PARENT_SS_ID", String(parentSsId));
  if (childSsId != null && childSsId !== "") p.setProperty("CHO_CHILD_SS_ID", String(childSsId));
  if (parentUploadFieldKey != null) p.setProperty("CHO_PARENT_UPLOAD_FIELD_KEY", String(parentUploadFieldKey));
  if (uploadFolderId != null) p.setProperty("CHO_UPLOAD_FOLDER_ID", String(uploadFolderId));
  if (sheetName != null && sheetName !== "") p.setProperty("CHO_SHEET_NAME", String(sheetName));
  if (childSheetName != null && childSheetName !== "") p.setProperty("CHO_CHILD_SHEET_NAME", String(childSheetName));
  if (extActionSecret != null) p.setProperty("CHO_EXT_ACTION_SECRET", String(extActionSecret));
  return Cho_getWriteTargets();
}
function Cho_getWriteTargets() {
  return {
    parentSpreadsheetId: Cho_getProp_("CHO_PARENT_SS_ID", ""),
    childSpreadsheetId: Cho_getProp_("CHO_CHILD_SS_ID", ""),
    sheetName: Cho_getProp_("CHO_SHEET_NAME", "Data") || "Data",
    childSheetName: Cho_getProp_("CHO_CHILD_SHEET_NAME", ""),
    parentUploadFieldKey: Cho_getProp_("CHO_PARENT_UPLOAD_FIELD_KEY", ""),
    uploadFolderId: Cho_getProp_("CHO_UPLOAD_FOLDER_ID", ""),
    extActionSecretSet: Cho_getProp_("CHO_EXT_ACTION_SECRET", "") !== ""
  };
}

// 取り込み先を解決する。ctx トークンがあれば payload 由来の親/子 spreadsheetId・シート名を優先
// （現在のフォームのシートを尊重）。登録値（Script Properties）はフォールバック。
function Cho_resolveTargets_(ctxToken) {
  var propsTargets = {
    parentSpreadsheetId: Cho_getProp_("CHO_PARENT_SS_ID", ""),
    childSpreadsheetId: Cho_getProp_("CHO_CHILD_SS_ID", ""),
    sheetName: Cho_getProp_("CHO_SHEET_NAME", "Data") || "Data",
    childSheetName: Cho_getProp_("CHO_CHILD_SHEET_NAME", ""),
    parentUploadFieldKey: Cho_getProp_("CHO_PARENT_UPLOAD_FIELD_KEY", ""),
    uploadFolderId: Cho_getProp_("CHO_UPLOAD_FOLDER_ID", "")
  };
  var cached = ctxToken ? Cho_readCtx_(ctxToken) : null;
  return Cho_mergeTargets_(propsTargets, cached);
}
// 登録値（propsTargets）に ctx（リレーで受けた現在のフォームの保存先）を上書きする純関数。
// 親 SS / 子 SS / シート名はリレー値があればそれを優先（GAS 非依存・node テスト可能）。
function Cho_mergeTargets_(propsTargets, ctx) {
  var p = propsTargets || {};
  var t = {
    parentSpreadsheetId: p.parentSpreadsheetId || "",
    childSpreadsheetId: p.childSpreadsheetId || "",
    sheetName: p.sheetName || "Data",
    childSheetName: p.childSheetName || "",
    parentUploadFieldKey: p.parentUploadFieldKey || "",
    uploadFolderId: p.uploadFolderId || ""
  };
  if (ctx && ctx.parentSpreadsheetId) t.parentSpreadsheetId = ctx.parentSpreadsheetId;
  if (ctx && ctx.childSpreadsheetId) t.childSpreadsheetId = ctx.childSpreadsheetId;
  if (ctx && ctx.sheetName) t.sheetName = ctx.sheetName;
  if (ctx && ctx.childSheetName) t.childSheetName = ctx.childSheetName;
  // 子シート名が無ければ親シート名にフォールバック（子 SS でも従来は親と同じ名を使っていた互換）。
  if (!t.childSheetName) t.childSheetName = t.sheetName;
  return t;
}

// 取り込んだ Excel を残すフォルダ（登録があればそれ、無ければ My Drive ルート）。
function Cho_resolveUploadFolder_() {
  var id = Cho_getProp_("CHO_UPLOAD_FOLDER_ID", "");
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* fall through */ } }
  return DriveApp.getRootFolder();
}


// #############################################################################
// ## relay.gs — 外部アクションリレー受信（誤送信防止プローブ + ctx キャッシュ + openUrl）
// #############################################################################

// HMAC-SHA256(message, secret) を 16 進文字列で返す（本体 ExtAction_hmacHex_ と同一）。
function Cho_hmacHex_(message, secret) {
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
// 誤送信防止プローブへの応答。本体 ExtAction_verifyProbeResponse_ が検証する形で返す。
function Cho_buildProbeResponse_(nonce) {
  return {
    ok: true,
    nfbExternalAction: true,
    signature: Cho_hmacHex_(String(nonce == null ? "" : nonce), Cho_getProp_("CHO_EXT_ACTION_SECRET", ""))
  };
}
// 本体 payload から、取り込みに必要な親 storage を抜き出す。
// 子フォームの保存先 spreadsheetId は本体（管理者送信時のみ）が storage.childSpreadsheetId に同梱する。
// 欠落時は payload.list.childFormsByRow から拾うフォールバックを使う（手動登録 CHO_CHILD_SS_ID に依存しない）。
function Cho_extractRelayContext_(data) {
  var storage = (data && data.storage && typeof data.storage === "object") ? data.storage : {};
  var childSpreadsheetId = typeof storage.childSpreadsheetId === "string" ? storage.childSpreadsheetId : "";
  if (!childSpreadsheetId) childSpreadsheetId = Cho_firstChildSpreadsheetIdFromList_(data);
  var childSheetName = typeof storage.childSheetName === "string" ? storage.childSheetName : "";
  if (!childSheetName) childSheetName = Cho_firstChildSheetNameFromList_(data);
  return {
    parentSpreadsheetId: typeof storage.spreadsheetId === "string" ? storage.spreadsheetId : "",
    childSpreadsheetId: childSpreadsheetId,
    driveFileUrl: typeof storage.driveFileUrl === "string" ? storage.driveFileUrl : "",
    sheetName: typeof storage.sheetName === "string" ? storage.sheetName : "",
    childSheetName: childSheetName,
    formId: (data && typeof data.formId === "string") ? data.formId : ""
  };
}
// payload.list.childFormsByRow（各行 = 子フォーム合成オブジェクト配列）から最初の非空 childSpreadsheetId を拾う。
function Cho_firstChildSpreadsheetIdFromList_(data) {
  var list = (data && data.list && typeof data.list === "object") ? data.list : null;
  var rows = (list && Object.prototype.toString.call(list.childFormsByRow) === "[object Array]") ? list.childFormsByRow : null;
  if (!rows) return "";
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (Object.prototype.toString.call(row) !== "[object Array]") continue;
    for (var j = 0; j < row.length; j++) {
      var obj = row[j];
      if (obj && typeof obj.childSpreadsheetId === "string" && obj.childSpreadsheetId) return obj.childSpreadsheetId;
    }
  }
  return "";
}
// childFormsByRow から、最初の非空 childSpreadsheetId を持つ子フォームの childSheetName を拾う。
// childSpreadsheetId の選択（Cho_firstChildSpreadsheetIdFromList_）と同じオブジェクトを採り、SS とシート名を揃える。
function Cho_firstChildSheetNameFromList_(data) {
  var list = (data && data.list && typeof data.list === "object") ? data.list : null;
  var rows = (list && Object.prototype.toString.call(list.childFormsByRow) === "[object Array]") ? list.childFormsByRow : null;
  if (!rows) return "";
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (Object.prototype.toString.call(row) !== "[object Array]") continue;
    for (var j = 0; j < row.length; j++) {
      var obj = row[j];
      if (obj && typeof obj.childSpreadsheetId === "string" && obj.childSpreadsheetId) {
        return (typeof obj.childSheetName === "string") ? obj.childSheetName : "";
      }
    }
  }
  return "";
}
// ctx をスクリプトキャッシュへ（doPost と doGet/commit は別リクエストなので橋渡し。TTL 10 分）。
function Cho_putCtx_(ctx) {
  var token = Cho_generateRecordId_();
  try { CacheService.getScriptCache().put("choctx_" + token, JSON.stringify(ctx || {}), 600); } catch (e) { /* no-op */ }
  return token;
}
function Cho_readCtx_(token) {
  try { var s = CacheService.getScriptCache().get("choctx_" + String(token)); return s ? JSON.parse(s) : null; }
  catch (e) { return null; }
}
// 取り込み画面の URL（?page=import&ctx=<token>）。
function Cho_buildImportUrl_(token) {
  var base = "";
  try { base = ScriptApp.getService().getUrl() || ""; } catch (e) { base = ""; }
  var sep = base.indexOf("?") >= 0 ? "&" : "?";
  return base + sep + "page=import" + (token ? "&ctx=" + encodeURIComponent(token) : "");
}


// #############################################################################
// ## node エクスポート（GAS では module 未定義なので無視される）
// #############################################################################
if (typeof module === "object" && module.exports) {
  module.exports = {
    Cho_buildImport_: Cho_buildImport_, Cho_makeReader_: Cho_makeReader_,
    Cho_buildUploadRecords_: Cho_buildUploadRecords_,
    Cho_checkPinkConsistency_: Cho_checkPinkConsistency_, Cho_unionToolsFromImport_: Cho_unionToolsFromImport_,
    Cho_workerTools_: Cho_workerTools_,
    Cho_issue_: Cho_issue_, Cho_countIssues_: Cho_countIssues_, Cho_issuesToWarnings_: Cho_issuesToWarnings_,
    Cho_a1ToRC_: Cho_a1ToRC_, Cho_dateToCanonical_: Cho_dateToCanonical_,
    Cho_serialOrDateToDate_: Cho_serialOrDateToDate_,
    CHO_APP_SPECIES_: CHO_APP_SPECIES_, CHO_ROSTER_: CHO_ROSTER_,
    CHO_SPECIES_ORDER_: CHO_SPECIES_ORDER_, CHO_TOOL_KIND_: CHO_TOOL_KIND_,
    CHO_ROSTER_SPECIES_: CHO_ROSTER_SPECIES_, CHO_TOOL_ORDER_: CHO_TOOL_ORDER_,
    CHO_JIYU_SPECIES_MARK_: CHO_JIYU_SPECIES_MARK_,
    // 直接書き込み・添付・整形の純関数（node テスト用）
    Cho_resolveCell_: Cho_resolveCell_, Cho_canonicalToSheetDate_: Cho_canonicalToSheetDate_,
    Cho_buildNewRow_: Cho_buildNewRow_, Cho_collectDroppedKeys_: Cho_collectDroppedKeys_,
    Cho_buildUploadCell_: Cho_buildUploadCell_, Cho_buildFriendly_: Cho_buildFriendly_,
    Cho_extractRelayContext_: Cho_extractRelayContext_, Cho_firstChildSpreadsheetIdFromList_: Cho_firstChildSpreadsheetIdFromList_,
    Cho_firstChildSheetNameFromList_: Cho_firstChildSheetNameFromList_,
    Cho_mergeTargets_: Cho_mergeTargets_, Cho_hmacHex_: Cho_hmacHex_,
    Sheets_normalizeRecordDataKeys_: Sheets_normalizeRecordDataKeys_,
    Sheets_neutralizeFormulaPrefix_: Sheets_neutralizeFormulaPrefix_,
    NFB_SHEETS_DATE_FORMAT: NFB_SHEETS_DATE_FORMAT, NFB_SHEETS_DATETIME_FORMAT: NFB_SHEETS_DATETIME_FORMAT,
    NFB_SHEETS_TEXT_FORMAT: NFB_SHEETS_TEXT_FORMAT
  };
}

// #############################################################################
// ## Code.gs
// #############################################################################
//
// =============================================================================
// 許可証等様式 出力 Web App (Nested Form Builder 連携)
//
// 出力（フォームデータ → Excel 様式）: 検索画面の一覧ボタン / レコード詳細の単票ボタン
// （いずれも非 adminOnly＝管理者権限不要）から起動する。本体 GAS がサーバ間リレーで
// この doPost を叩き、生成画面の URL（openUrl）を返してもらって新しいタブで開く。
// 生成画面で内容を確認して「生成」を押すと、様式テンプレートをスプレッドシートとして複製し
// 緑セルへリテラル値を書き込んで Drive に保存し、リンクを返す。
//
// 設計の核（許可証等様式 の緑セル＝掃き出し場所 FF00B050）:
//   緑 FF00B050 = 出力先。サンプル値は「どのセルへ何を書くか」の仕様。
//   従事者名簿 は緑なし＝マスター名簿（choju_intake の名簿幾何と同一）。
//
// データ取得元（重要）: 管理者権限不要にするため storage（spreadsheetId 等）は来ない前提で、
// payload に同梱されるフォームデータを直接消費する。起動元（編集画面・検索一覧の単一/複数選択）
// に依らず単一フォーマット payload.records[]（{id,no,items}）で届き、recordCount（=records 数）で
// 申請件数が決まる（旧 context は廃止）。子（従事者）は各 record の items に
// "従事者情報/#<No>/<子質問>" で常時インライン展開される（list/childFormsByRow は廃止）。
// 値は表示文字列（選択肢は ", " 連結）。ただしパスは構造完全なので per-worker の種数/方法/免許まで復元できる。
//
// 本体 gas/ は一切変更しない。スタイルは本体準拠（var + function、内部ヘルパは末尾 _、接頭辞 Cho2_）。
// =============================================================================

// 本体は ?nfbRelay=1 付きでサーバ間 POST してくる。relay のときは JSON 応答、直 POST は JSON で返す。
function doPost(e) {
  try {
    var payload = Cho2_parsePayload_(e);
    if (!payload.ok) return Cho2_json_({ ok: false, error: payload.error });
    var data = payload.data;

    // 1) 誤送信防止プローブ（本体にシークレット設定時のみ来る）。共有シークレットで HMAC(nonce) を返す。
    if (String(data.nfbProbe) === "1" || String((e && e.parameter && e.parameter.nfbProbe) || "") === "1") {
      var nonce = String(data.nonce || (e && e.parameter && e.parameter.nonce) || "");
      var secret = Cho2_getProp_("CHO2_EXT_ACTION_SECRET", "");
      if (secret === "" || nonce === "") return Cho2_json_({ ok: true, nfbExternalAction: false });
      return Cho2_json_({ ok: true, nfbExternalAction: true, signature: Cho2_hmacHex_(nonce, secret) });
    }

    // 2) 外部アクションリレー（検索一覧 / 単票ボタン）。payload を一時キャッシュし、生成画面 URL を返す。
    var token = Cho2_putCtx_(data);
    return Cho2_json_({
      ok: true,
      nfbExternalAction: true,
      title: "許可証等の出力",
      message: "許可証等の出力画面を新しいタブで開きます。",
      openUrl: Cho2_buildGenUrl_(token)
    });
  } catch (err) {
    return Cho2_json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// GET: 生成画面（?page=gen&ctx=<token>）／設定・案内画面（既定）。
function doGet(e) {
  var params = (e && e.parameter) || {};
  var page = String(params.page || "");
  if (page === "gen") return Cho2_renderGenPage_(String(params.ctx || ""));
  return Cho2_renderSettingsPage_();
}

function Cho2_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj || { ok: false })).setMimeType(ContentService.MimeType.JSON);
}

function Cho2_parsePayload_(e) {
  var params = (e && e.parameter) || {};
  var raw = params.payload;
  if (raw == null || String(raw) === "") {
    // プローブは payload ではなく nfbProbe/nonce パラメータで来ることがある。
    if (params.nfbProbe != null) return { ok: true, data: { nfbProbe: params.nfbProbe, nonce: params.nonce } };
    return { ok: false, error: "payload パラメータがありません。" };
  }
  var data;
  try { data = JSON.parse(String(raw)); }
  catch (err) { return { ok: false, error: "payload の JSON 解析に失敗しました: " + (err && err.message ? err.message : err) }; }
  if (!data || typeof data !== "object") return { ok: false, error: "payload がオブジェクトではありません。" };
  return { ok: true, data: data };
}

// #############################################################################
// ## domain.gs — ラベル定数・緑セル番地表（番地はここ 1 箇所で管理）
// #############################################################################

// ----- 親フォーム「鳥獣保護管理法許可申請」のラベル（payload の question パスと一致）-----
var CHO2_CHILD_FORM_ID_ = "1Eh5p3Q5IMQEfi-7TiUV8ZZ8z_4HKW0Zj"; // 従事者情報
var CHO2_FORMLINK_LABEL_ = "従事者情報";                       // 親 schema の formLink ラベル（record items の親カードパス）
var CHO2_L_RECEIPT_DATE_ = "受付日"; // 交付通知書 B9 「…に申請を受けた」の日付（{{gge年M月D日}} 置換）
var CHO2_L_APPLICANT_TYPE_ = "申請者情報/個人・法人の別";
var CHO2_L_PURPOSE_ = "捕獲等又は採取等の目的";
var CHO2_L_PERIOD_START_ = "捕獲等又は採取等の期間/開始";
var CHO2_L_PERIOD_END_ = "捕獲等又は採取等の期間/終了";
var CHO2_L_AREA_ = "捕獲等又は採取等の区域/所在地";
var CHO2_L_DISPOSAL_ = "捕獲等又は採取等をしたあとの処置";
var CHO2_L_KYOKA_NO_ = "許可処分情報/許可番号";
var CHO2_L_KYOKA_DATE_ = "許可処分情報/許可年月日";
var CHO2_L_SHOBUN_ = "許可処分情報/処分の種類";
var CHO2_L_COND_ = "許可処分情報/処分の種類/条件付き許可/許可条件";

// ----- 子フォーム「従事者情報」のラベル（worker pathMap のキー。子相対パス）-----
var CHO2_L_W_NAME_ = "氏名";
var CHO2_L_W_ADDRESS_ = "住所";
var CHO2_L_W_OCCUPATION_ = "職業";
var CHO2_L_W_BIRTH_ = "生年月日";
var CHO2_L_W_SPECIES_ = "捕獲等をする鳥獣又は採取等をする鳥類の卵の種類及び数量";
var CHO2_L_W_METHOD_ = "捕獲等又は採取等の方法（使用する捕獲用具の名称）"; // 閉じ括弧が半角!

// ----- 種の表示順（フォーム選択肢順）。bird=採取卵数あり -----
var CHO2_SPECIES_ORDER_ = [
  "キジバト", "カワラバト", "スズメ", "ニュウナイスズメ", "ハシボソガラス", "ハシブトガラス",
  "キツネ", "ノイヌ", "ノネコ", "アライグマ", "トガリネズミ科・ネズミ科"
];
var CHO2_BIRDS_ = { "キジバト": 1, "カワラバト": 1, "スズメ": 1, "ニュウナイスズメ": 1, "ハシボソガラス": 1, "ハシブトガラス": 1 };

// 証類の種数グリッド（9 行）の詰め方。off=基準行からのオフセット、side=L(主)/R(副)。
//   鳥6種=L(卵列つき) / キツネ・ノネコ・トガリ=L / ノイヌ・アライグマ=R（同行の副列）。
var CHO2_GRID_SLOTS_ = [
  { sp: "キジバト", off: 0, side: "L", bird: true },
  { sp: "カワラバト", off: 1, side: "L", bird: true },
  { sp: "スズメ", off: 2, side: "L", bird: true },
  { sp: "ニュウナイスズメ", off: 3, side: "L", bird: true },
  { sp: "ハシボソガラス", off: 4, side: "L", bird: true },
  { sp: "ハシブトガラス", off: 5, side: "L", bird: true },
  { sp: "キツネ", off: 6, side: "L" },
  { sp: "ノイヌ", off: 6, side: "R" },
  { sp: "ノネコ", off: 7, side: "L" },
  { sp: "アライグマ", off: 7, side: "R" },
  { sp: "トガリネズミ科・ネズミ科", off: 8, side: "L" }
];

// 各シートの種数グリッド配置（基準行と列。j/k は鳥=卵列 / 哺乳=副種名・副数量の二役）。
var CHO2_GRID_KYOKASHO_ = { base: 17, name: "G", count: "H", j: "J", k: "K" }; // 許可証 G17:K25
var CHO2_GRID_TSUCHI_ = { base: 17, name: "C", count: "D", j: "F", k: "G" }; // 通知 C17:G25
var CHO2_GRID_JUJI_ = { base: 18, name: "K", count: "L", j: "N", k: "O" }; // 従事者証 K18:O26

// ----- 用具（名簿 P 列）と方法 kind -----
var CHO2_TOOL_ORDER_ = [
  "手捕り", "くくりわな", "はこわな", "はこおとし", "囲いわな",
  "むそう網", "はり網", "つき網", "なげ網", "空気銃", "散弾銃", "ライフル銃"
];
var CHO2_TOOL_KIND_ = {
  "手捕り": "手捕り",
  "くくりわな": "わな", "はこわな": "わな", "はこおとし": "わな", "囲いわな": "わな",
  "むそう網": "網", "はり網": "網", "つき網": "網", "なげ網": "網",
  "空気銃": "銃器", "散弾銃": "銃器", "ライフル銃": "銃器"
};
// 空気銃の免許種類(select) → 名簿 狩猟免許 種類（Q 列）
var CHO2_GUN_LIC_ = { "第一種銃猟免許": "第一種銃猟", "第二種銃猟免許": "第二種銃猟" };

// ----- 従事者名簿の幾何（choju CHO_ROSTER_ と同一）。1 ブロック = 1 従事者 -----
// blockCount = テンプレの物理ブロック数 = 1 シートあたりの従事者数（行 5〜76 の 8 ブロック）。
// 9 名以上はシートを複製して 8 名ずつ載せる（Cho2_materializeRoster_）。
var CHO2_ROSTER_ = {
  sheetName: "従事者名簿",
  firstRow: 5, blockHeight: 9, blockCount: 8,
  cols: {
    certNo: "E", address: "F", name: "G", occupation: "H", birth: "I",
    speciesName: "J", speciesCount: "K", species2Name: "M", species2Count: "N",
    tool: "P",
    licType: "Q", licPref: "R", licNo: "S", licDate: "T",
    regNo: "V", regDate: "W",
    gunPermitNo: "X", gunPermitDate: "Y", gunKind: "Z"
  }
};

// 各シート名
var CHO2_SHEET_ROSTER_ = "従事者名簿";
var CHO2_SHEET_KYOKASHO_ = "許可証";
var CHO2_SHEET_KOFU_ = "交付通知書";
var CHO2_SHEET_SHINKO_ = "振興局宛通知";
var CHO2_SHEET_KEISATSU_ = "警察宛通知";
var CHO2_SHEET_JUJI_ = "従事者証";

// 通知シートのレイアウト差分。交付通知書は冒頭段落(B9)ぶん記欄が全体に +1 行シフトし、宛名(B3/B4)を持つ。
// F2/F3（許可番号・許可年月日）はどのシートも不動。
var CHO2_TSUCHI_LAYOUT_STD_ = { shift: 0 };                  // 振興局宛通知 / 警察宛通知
var CHO2_TSUCHI_LAYOUT_KOFU_ = { shift: 1, addressee: true }; // 交付通知書

// 出力時にクリアしてから書き込む緑セル（サンプル値の消去用）。dump 済みの緑セル番地。
// 通知3種は許可の条件欄(C34/C34/C35)を追加。交付通知書は +1 行シフト＋宛名(B3:B4)。
// 交付の B9（段落トークン {{gge年M月D日}}）はクリア対象に含めない（トークン置換で本文を温存）。
var CHO2_CLEAR_RANGES_ = {
  "許可証": ["H4:H5", "G12:L14", "G17:L25", "G26", "G28", "G30", "G32", "G34"],
  "交付通知書": ["F2:F3", "B3:B4", "C13:H17", "C18:G26", "C27", "C29", "F29", "C31", "C33", "C35"],
  "振興局宛通知": ["F2:F3", "C12:H16", "C17:G25", "C26", "C28", "F28", "C30", "C32", "C34"],
  "警察宛通知": ["F2:F3", "C12:H16", "C17:G25", "C26", "C28", "F28", "C30", "C32", "C34"],
  "従事者証": ["F4:F5", "K14", "K16", "D17", "D23", "D29", "K18:P26", "K27", "K29", "K31", "K33"]
};


// #############################################################################
// ## payload.gs — payload → 中間モデル（純関数）
// #############################################################################

function Cho2_str_(v) {
  if (v && typeof v === "object") { // 一覧セルは { text, hyperlink } の場合がある
    if (typeof v.text === "string") return v.text.replace(/^\s+|\s+$/g, "");
    return "";
  }
  return String(v == null ? "" : v).replace(/^\s+|\s+$/g, "");
}
function Cho2_num_(v) {
  var s = Cho2_str_(v);
  if (s === "") return "";
  var n = Number(s.replace(/[, ]/g, ""));
  return isNaN(n) ? "" : n;
}
// 選択肢の表示値（", " 連結ラベル）を配列へ。
function Cho2_choiceList_(v) {
  var s = Cho2_str_(v);
  if (!s) return [];
  return s.split(/\s*,\s*/).map(function (x) { return x.replace(/^\s+|\s+$/g, ""); }).filter(function (x) { return x; });
}

// "YYYY-MM-DD" / "YYYY/MM/DD"（時刻があっても日付部のみ）→ {y,m,d}。不可なら null。
function Cho2_dateParts_(v) {
  var s = Cho2_str_(v);
  var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (!m) return null;
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y: y, m: mo, d: d };
}

// 元号表（改元日。降順で判定）。builder/src/features/expression/eraConversion.js と同じ境界。
var CHO2_ERAS_ = [
  { name: "令和", y: 2019, m: 5, d: 1 },
  { name: "平成", y: 1989, m: 1, d: 8 },
  { name: "昭和", y: 1926, m: 12, d: 25 },
  { name: "大正", y: 1912, m: 7, d: 30 },
  { name: "明治", y: 1868, m: 1, d: 25 }
];
// 西暦 {y,m,d} → 和暦文字列（例 "令和8年6月1日"、各元号の初年は "令和元年…"）。
// Google スプレッドシートは和暦の数値書式（ggge）を解釈しないため、リテラル文字列で書き込む。
// 本体正規実装 formatEraNonPadded の移植（元年表記）。明治改元前は西暦でフォールバック。
function Cho2_warekiString_(p) {
  if (!p) return "";
  var serial = p.y * 10000 + p.m * 100 + p.d;
  for (var i = 0; i < CHO2_ERAS_.length; i++) {
    var e = CHO2_ERAS_[i];
    if (serial >= e.y * 10000 + e.m * 100 + e.d) {
      var yy = p.y - e.y + 1;
      return e.name + (yy === 1 ? "元" : String(yy)) + "年" + p.m + "月" + p.d + "日";
    }
  }
  return p.y + "年" + p.m + "月" + p.d + "日";
}

// レコードの items（{question,value,type}[]）→ { parent:{pathMap}, workers:[{pathMap}] }。
// 子（従事者）は items の question 接頭辞 "従事者情報/#<marker>/" で識別し marker ごとにまとめる。
// 起動元（編集画面・検索一覧の単一/複数選択）に依らず、子は常に items にインライン展開される。
function Cho2_parseRecordItems_(items) {
  var list = (Object.prototype.toString.call(items) === "[object Array]") ? items : [];
  var parent = {};
  var workersByMarker = {};
  var order = [];
  var folderUrl = ""; // 出力先＝ファイルアップロード項目の folderUrl（複数あれば先頭）
  var prefix = CHO2_FORMLINK_LABEL_ + "/#";
  for (var i = 0; i < list.length; i++) {
    var it = list[i] || {};
    var q = String(it.question || "");
    var v = it.value;
    if (!folderUrl && it.folderUrl) folderUrl = Cho2_str_(it.folderUrl);
    if (q.indexOf(prefix) === 0) {
      var rest = q.substring(prefix.length); // "<marker>/<child path>"
      var slash = rest.indexOf("/");
      if (slash < 0) continue;
      var marker = rest.substring(0, slash);
      var childPath = rest.substring(slash + 1);
      if (!workersByMarker[marker]) { workersByMarker[marker] = {}; order.push(marker); }
      workersByMarker[marker][childPath] = v;
    } else {
      parent[q] = v;
    }
  }
  var workers = [];
  for (var j = 0; j < order.length; j++) workers.push(workersByMarker[order[j]]);
  return { parent: parent, workers: workers, folderUrl: folderUrl };
}

// payload を「申請（アプリケーション）」配列へ。起動元に依らず records[] を 1 件ずつ処理する
// （編集画面・検索一覧の単一選択は 1 件、検索一覧の複数選択は N 件）。旧 context 分岐は廃止。
function Cho2_parseApplications_(data) {
  var records = (data && Object.prototype.toString.call(data.records) === "[object Array]") ? data.records : [];
  var apps = [];
  for (var i = 0; i < records.length; i++) {
    var rec = records[i] || {};
    var one = Cho2_parseRecordItems_(rec.items);
    apps.push({ parent: one.parent, workers: one.workers, folderUrl: one.folderUrl, label: Cho2_applicantDisplayName_(one) });
  }
  return apps;
}


// #############################################################################
// ## build.gs — 中間モデル → 各シートの「セル番地→値」差分（純ロジック）
// #############################################################################

// 申請者区分（"個人"/"法人"）。未指定/不明は worker の有無からは決めず "個人" を既定にする。
function Cho2_applicantType_(parent) {
  var v = Cho2_choiceList_(parent[CHO2_L_APPLICANT_TYPE_]);
  if (v.indexOf("法人") !== -1) return "法人";
  if (v.indexOf("個人") !== -1) return "個人";
  return "個人";
}
function Cho2_applicantDisplayName_(app) {
  var type = Cho2_applicantType_(app.parent);
  if (type === "法人") {
    var hn = Cho2_str_(app.parent[CHO2_L_APPLICANT_TYPE_ + "/法人/法人名"]);
    if (hn) return hn;
  }
  if (app.workers && app.workers[0]) {
    var nm = Cho2_str_(app.workers[0][CHO2_L_W_NAME_]);
    if (nm) return nm;
  }
  var n = Cho2_str_(app.parent[CHO2_L_APPLICANT_TYPE_ + "/個人/氏名"]);
  return n || "(無題)";
}

// 1 従事者の種ごとの { 種: { count, egg } }（非該当は 0）。
function Cho2_workerSpecies_(worker) {
  var out = {};
  for (var i = 0; i < CHO2_SPECIES_ORDER_.length; i++) {
    var sp = CHO2_SPECIES_ORDER_[i];
    var c = Cho2_num_(worker[CHO2_L_W_SPECIES_ + "/" + sp + "/捕獲頭数"]);
    var e = CHO2_BIRDS_[sp] ? Cho2_num_(worker[CHO2_L_W_SPECIES_ + "/" + sp + "/採取卵数"]) : "";
    out[sp] = { count: (c === "" ? 0 : c), egg: (e === "" ? 0 : e) };
  }
  return out;
}
// 全従事者合計（法人全体 / 全員での捕獲数）。
function Cho2_aggregateSpecies_(workers) {
  var out = {};
  for (var i = 0; i < CHO2_SPECIES_ORDER_.length; i++) out[CHO2_SPECIES_ORDER_[i]] = { count: 0, egg: 0 };
  for (var w = 0; w < workers.length; w++) {
    var ws = Cho2_workerSpecies_(workers[w]);
    for (var s = 0; s < CHO2_SPECIES_ORDER_.length; s++) {
      var sp = CHO2_SPECIES_ORDER_[s];
      out[sp].count += ws[sp].count; out[sp].egg += ws[sp].egg;
    }
  }
  return out;
}

// 1 従事者の捕獲用具（葉用具）を CHO2_TOOL_ORDER_ 順で平坦化。
function Cho2_workerTools_(worker) {
  var M = CHO2_L_W_METHOD_, seen = {};
  var cats = Cho2_choiceList_(worker[M]);
  if (cats.indexOf("手捕り") !== -1) seen["手捕り"] = 1;
  var wana = Cho2_choiceList_(worker[M + "/わな/道具の種類"]);
  for (var i = 0; i < wana.length; i++) seen[wana[i]] = 1;
  var ami = Cho2_choiceList_(worker[M + "/網/道具の種類"]);
  for (var j = 0; j < ami.length; j++) seen[ami[j]] = 1;
  var gun = Cho2_choiceList_(worker[M + "/銃器/銃の種類"]);
  for (var g = 0; g < gun.length; g++) seen[gun[g]] = 1;
  var out = [];
  for (var t = 0; t < CHO2_TOOL_ORDER_.length; t++) if (seen[CHO2_TOOL_ORDER_[t]]) out.push(CHO2_TOOL_ORDER_[t]);
  // 未知用具（順序表に無いもの）は末尾に。
  for (var k in seen) if (seen.hasOwnProperty(k) && out.indexOf(k) === -1) out.push(k);
  return out;
}
// 全従事者の用具和集合（CHO2_TOOL_ORDER_ 順）。
function Cho2_unionTools_(workers) {
  var seen = {};
  for (var w = 0; w < workers.length; w++) {
    var ts = Cho2_workerTools_(workers[w]);
    for (var i = 0; i < ts.length; i++) seen[ts[i]] = 1;
  }
  var out = [];
  for (var t = 0; t < CHO2_TOOL_ORDER_.length; t++) if (seen[CHO2_TOOL_ORDER_[t]]) out.push(CHO2_TOOL_ORDER_[t]);
  for (var k in seen) if (seen.hasOwnProperty(k) && out.indexOf(k) === -1) out.push(k);
  return out;
}

// 1 従事者・1 用具の免許/登録/銃器情報を pathMap から取り出す（名簿 Q-Z 用）。choju 取込の逆。
function Cho2_toolLicense_(worker, tool) {
  var M = CHO2_L_W_METHOD_, kind = CHO2_TOOL_KIND_[tool] || "";
  var r = { tool: tool, kind: kind, licType: "", licPref: "", licNo: "", licDate: "", regNo: "", regDate: "", gunNo: "", gunDate: "", gunKind: "" };
  if (kind === "わな") {
    // フォームに「わなの免許種類」欄が無いため、免許必要時は種別から補完（名簿 Q 列＝狩猟免許 種類）。
    if (Cho2_str_(worker[M + "/わな/免許の必要性"]) === "必要") r.licType = "わな猟免許";
    var wb = M + "/わな/免許の必要性/必要/免許情報/";
    r.licPref = Cho2_str_(worker[wb + "都道府県"]);
    r.licNo = Cho2_str_(worker[wb + "番号"]);
    r.licDate = Cho2_str_(worker[wb + "交付年月日"]);
    var wr = M + "/わな/狩猟者登録/登録の有無/あり/";
    r.regNo = Cho2_str_(worker[wr + "番号"]);
    r.regDate = Cho2_str_(worker[wr + "交付年月日"]);
  } else if (kind === "網") {
    // 同上（網の免許種類欄が無いため補完）。
    if (Cho2_str_(worker[M + "/網/免許の必要性"]) === "必要") r.licType = "網猟免許";
    var nb = M + "/網/免許の必要性/必要/免許情報/";
    r.licPref = Cho2_str_(worker[nb + "都道府県"]);
    r.licNo = Cho2_str_(worker[nb + "番号"]);
    r.licDate = Cho2_str_(worker[nb + "交付年月日"]);
    var nr = M + "/網/免許の必要性/必要/狩猟者登録/登録の有無/あり/";
    r.regNo = Cho2_str_(worker[nr + "番号"]);
    r.regDate = Cho2_str_(worker[nr + "交付年月日"]);
  } else if (kind === "銃器") {
    var gb = M + "/銃器/銃の種類/" + tool;
    r.gunKind = tool;
    r.gunNo = Cho2_str_(worker[gb + "/所持許可/所持許可証番号"]);
    r.gunDate = Cho2_str_(worker[gb + "/所持許可/交付年月日"]);
    if (tool === "空気銃") {
      var sel = Cho2_choiceList_(worker[gb + "/免許種類"])[0] || "";
      if (sel) {
        r.licType = CHO2_GUN_LIC_[sel] || sel;
        var ab = gb + "/免許種類/" + sel + "/";
        r.licPref = Cho2_str_(worker[ab + "都道府県"]);
        r.licNo = Cho2_str_(worker[ab + "番号"]);
        r.licDate = Cho2_str_(worker[ab + "交付年月日"]);
      }
      var ar = gb + "/狩猟者登録/登録の有無/あり/";
      r.regNo = Cho2_str_(worker[ar + "番号"]);
      r.regDate = Cho2_str_(worker[ar + "交付年月日"]);
    } else { // 散弾銃 / ライフル銃
      r.licType = "第一種銃猟";
      var fb = gb + "/第一種銃猟免許/";
      r.licPref = Cho2_str_(worker[fb + "都道府県"]);
      r.licNo = Cho2_str_(worker[fb + "番号"]);
      r.licDate = Cho2_str_(worker[fb + "交付年月日"]);
      var fr = gb + "/狩猟者登録/登録の有無/あり/";
      r.regNo = Cho2_str_(worker[fr + "番号"]);
      r.regDate = Cho2_str_(worker[fr + "交付年月日"]);
    }
  }
  return r;
}

// ----- 番号生成（許可番号 "X-Y" 起点。空なら全て空）-----
// 許可証番号 / 従事者証番号 = 第X-Y-n号、通知の許可番号 = 第X-Y号、文書番号 = 札環対許可第X-Y号。
function Cho2_permitNo_(kyokaNo, idx /* 1-based */) {
  var k = Cho2_str_(kyokaNo);
  if (!k) return "";
  return "第" + k + "-" + idx + "号";
}
// 許可番号と従事者番号を素のまま連結（例 "1-1" + 1 → "1-1-1"）。名簿 E 列など書式装飾なしセル用。
function Cho2_certNoRaw_(kyokaNo, idx /* 1-based */) {
  var k = Cho2_str_(kyokaNo);
  return k ? k + "-" + idx : "";
}
function Cho2_kyokaBangoMark_(kyokaNo) { var k = Cho2_str_(kyokaNo); return k ? "第" + k + "号" : ""; }
function Cho2_docNo_(kyokaNo) { var k = Cho2_str_(kyokaNo); return k ? "札環対許可第" + k + "号" : ""; }
function Cho2_permitNoRange_(kyokaNo, n) {
  var k = Cho2_str_(kyokaNo);
  if (!k || n <= 0) return "";
  if (n === 1) return "(許可証番号　" + Cho2_permitNo_(k, 1) + ")";
  return "(許可証番号　" + Cho2_permitNo_(k, 1) + "～" + Cho2_permitNo_(k, n) + ")";
}

// セル差分の蓄積ヘルパ（空値は書かない。クリア済み前提）。
function Cho2_push_(cells, a1, value) {
  if (value === "" || value === null || value === undefined) return;
  cells.push({ a1: a1, value: value });
}
// 数値（0 は書かない＝空欄）。
function Cho2_pushNum_(cells, a1, n) { if (typeof n === "number" && n > 0) cells.push({ a1: a1, value: n }); }
// 日付（和暦文字列に変換してから書く。数値書式に依存せずリテラルで表示する）。
function Cho2_pushDate_(cells, a1, raw) {
  var p = Cho2_dateParts_(raw);
  if (p) cells.push({ a1: a1, value: Cho2_warekiString_(p) });
}

// 種数グリッド差分（grid 設定・種ごと {count,egg}）。
function Cho2_gridCells_(grid, totals) {
  var cells = [];
  for (var i = 0; i < CHO2_GRID_SLOTS_.length; i++) {
    var slot = CHO2_GRID_SLOTS_[i];
    var t = totals[slot.sp] || { count: 0, egg: 0 };
    if (!(t.count > 0 || t.egg > 0)) continue;
    var nameCol = (slot.side === "L") ? grid.name : grid.j;
    var countCol = (slot.side === "L") ? grid.count : grid.k;
    Cho2_push_(cells, nameCol + (grid.base + slot.off), slot.sp);
    Cho2_pushNum_(cells, countCol + (grid.base + slot.off), t.count);
    if (slot.side === "L" && slot.bird && t.egg > 0) {
      Cho2_push_(cells, grid.j + (grid.base + slot.off), "卵");
      Cho2_pushNum_(cells, grid.k + (grid.base + slot.off), t.egg);
    }
  }
  return cells;
}

// 従事者名簿 1 ブロック分の差分（top=ブロック先頭行）。
function Cho2_rosterBlockCells_(worker, top, certNo) {
  var C = CHO2_ROSTER_.cols, cells = [];
  Cho2_push_(cells, C.certNo + top, certNo);
  Cho2_push_(cells, C.address + top, Cho2_str_(worker[CHO2_L_W_ADDRESS_]));
  Cho2_push_(cells, C.name + top, Cho2_str_(worker[CHO2_L_W_NAME_]));
  Cho2_push_(cells, C.occupation + top, Cho2_str_(worker[CHO2_L_W_OCCUPATION_]));
  Cho2_pushDate_(cells, C.birth + top, worker[CHO2_L_W_BIRTH_]);
  // 種数（固定オフセット配置）
  var sp = Cho2_workerSpecies_(worker);
  for (var i = 0; i < CHO2_GRID_SLOTS_.length; i++) {
    var slot = CHO2_GRID_SLOTS_[i], t = sp[slot.sp];
    if (!(t.count > 0 || t.egg > 0)) continue;
    var row = top + slot.off;
    if (slot.side === "L") {
      Cho2_push_(cells, C.speciesName + row, slot.sp);
      Cho2_pushNum_(cells, C.speciesCount + row, t.count);
      if (slot.bird && t.egg > 0) { Cho2_push_(cells, C.species2Name + row, "卵"); Cho2_pushNum_(cells, C.species2Count + row, t.egg); }
    } else {
      Cho2_push_(cells, C.species2Name + row, slot.sp);
      Cho2_pushNum_(cells, C.species2Count + row, t.count);
    }
  }
  // 方法（用具を P 列に積層・免許/登録/銃器を行ごとに）
  var tools = Cho2_workerTools_(worker);
  for (var ti = 0; ti < tools.length && ti < CHO2_ROSTER_.blockHeight; ti++) {
    var row2 = top + ti, lic = Cho2_toolLicense_(worker, tools[ti]);
    Cho2_push_(cells, C.tool + row2, lic.tool);
    Cho2_push_(cells, C.licType + row2, lic.licType);
    Cho2_push_(cells, C.licPref + row2, lic.licPref);
    Cho2_push_(cells, C.licNo + row2, lic.licNo);
    Cho2_pushDate_(cells, C.licDate + row2, lic.licDate);
    Cho2_push_(cells, C.regNo + row2, lic.regNo);
    Cho2_pushDate_(cells, C.regDate + row2, lic.regDate);
    Cho2_push_(cells, C.gunPermitNo + row2, lic.gunNo);
    Cho2_pushDate_(cells, C.gunPermitDate + row2, lic.gunDate);
    Cho2_push_(cells, C.gunKind + row2, lic.gunKind);
  }
  return cells;
}

// 許可証 1 枚の差分。法人=集計・個人=その従事者分。header は {address,name,birthOrRep}。
// c3No は C3 に入れる許可番号（個人="1-1-1"/"1-1-2" の連結、法人="1-1" の素）。
function Cho2_kyokashoCells_(parent, speciesTotals, tools, header, c3No) {
  var cells = [];
  Cho2_pushDate_(cells, "H4", parent[CHO2_L_PERIOD_START_]);
  Cho2_pushDate_(cells, "H5", parent[CHO2_L_PERIOD_END_]);
  Cho2_push_(cells, "G12", header.address);
  Cho2_push_(cells, "G13", header.name);
  if (header.birthIsDate) Cho2_pushDate_(cells, "G14", header.birthOrRep);
  else Cho2_push_(cells, "G14", header.birthOrRep);
  var grid = Cho2_gridCells_(CHO2_GRID_KYOKASHO_, speciesTotals);
  for (var i = 0; i < grid.length; i++) cells.push(grid[i]);
  Cho2_push_(cells, "G26", Cho2_str_(parent[CHO2_L_PURPOSE_]));
  Cho2_push_(cells, "G28", Cho2_str_(parent[CHO2_L_AREA_]));
  Cho2_push_(cells, "G30", tools.join(","));
  Cho2_push_(cells, "G32", Cho2_choiceList_(parent[CHO2_L_DISPOSAL_]).join("・"));
  Cho2_push_(cells, "G34", Cho2_str_(parent[CHO2_L_COND_]));
  // C3 許可番号（書式なしセル＝そのまま記入。applyCells が数字ハイフン連結をテキスト化）
  Cho2_push_(cells, "C3", Cho2_str_(c3No));
  return cells;
}

// 従事者証 1 枚の差分（法人のみ）。種数=全員合計、方法=その従事者分。
function Cho2_jujiCells_(parent, worker, aggSpecies, workerTools, hojinName, kyokaNo, jujiNo) {
  var cells = [];
  Cho2_pushDate_(cells, "F4", parent[CHO2_L_PERIOD_START_]);
  Cho2_pushDate_(cells, "F5", parent[CHO2_L_PERIOD_END_]);
  Cho2_push_(cells, "K14", Cho2_str_(kyokaNo)); // 許可番号そのまま（例 "1-1"）
  Cho2_push_(cells, "K16", hojinName);
  Cho2_push_(cells, "D17", Cho2_str_(worker[CHO2_L_W_ADDRESS_]));
  Cho2_push_(cells, "D23", Cho2_str_(worker[CHO2_L_W_NAME_]));
  Cho2_pushDate_(cells, "D29", worker[CHO2_L_W_BIRTH_]);
  var grid = Cho2_gridCells_(CHO2_GRID_JUJI_, aggSpecies);
  for (var i = 0; i < grid.length; i++) cells.push(grid[i]);
  Cho2_push_(cells, "K27", Cho2_str_(parent[CHO2_L_PURPOSE_]));
  Cho2_push_(cells, "K29", Cho2_str_(parent[CHO2_L_AREA_]));
  Cho2_push_(cells, "K31", workerTools.join(","));
  Cho2_push_(cells, "K33", Cho2_str_(parent[CHO2_L_COND_])); // テンプレの =IF 数式をリテラルで上書き
  // C4 従事者証番号（非緑）
  Cho2_push_(cells, "C4", jujiNo);
  return cells;
}

// 通知 1 枚の差分（振興局/警察/交付 共通）。種数=全員合計、住所/氏名は申請者区分で出し分け。
// layout: { shift, addressee }。交付通知書は shift=1（記欄が +1 行）＋ addressee（宛名 B3/B4）。
// F2/F3（許可番号・許可年月日）はどのレイアウトでも不動。
function Cho2_tsuchiCells_(parent, workers, aggSpecies, unionTools, type, kyokaNo, layout) {
  var lay = layout || CHO2_TSUCHI_LAYOUT_STD_;
  var sh = lay.shift || 0;
  var cells = [];
  // F2:H2 / F3:H3 は結合セル（左上 F2/F3）。F2=許可番号そのまま("1-1")で "札環対許可第 @ 号" はセル書式が付与。
  Cho2_push_(cells, "F2", Cho2_str_(kyokaNo));
  Cho2_pushDate_(cells, "F3", parent[CHO2_L_KYOKA_DATE_]); // 許可年月日（和暦書式）
  // 宛名（交付通知書のみ・被許可者宛て）。法人=B3 法人名/B4 代表者名、個人=B4 氏名。
  if (lay.addressee) {
    if (type === "法人") {
      Cho2_push_(cells, "B3", Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/法人/法人名"]));
      Cho2_push_(cells, "B4", Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/法人/代表者名"]));
    } else {
      var w0a = workers[0] || {};
      Cho2_push_(cells, "B4", Cho2_str_(w0a[CHO2_L_W_NAME_]) || Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/個人/氏名"]));
    }
  }
  // 住所(C12)・氏名/法人名(C13)・許可証番号ブロック(C14…)・従事者名行(C15)。すべて +sh 行。
  if (type === "法人") {
    Cho2_push_(cells, "C" + (12 + sh), Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/法人/住所"]));
    var hn = Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/法人/法人名"]);
    var rep = Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/法人/代表者名"]);
    Cho2_push_(cells, "C" + (13 + sh), hn + (rep ? "　" + rep : ""));
    Cho2_push_(cells, "C" + (14 + sh), Cho2_str_(kyokaNo)); // "1-1"（セル書式 第@号）。法人は単一許可証番号
    Cho2_push_(cells, "C" + (15 + sh), "別紙のとおり");      // 従事者は別紙（従事者名簿）参照
  } else {
    var w0 = workers[0] || {};
    Cho2_push_(cells, "C" + (12 + sh), Cho2_str_(w0[CHO2_L_W_ADDRESS_]) || Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/個人/住所"]));
    Cho2_push_(cells, "C" + (13 + sh), Cho2_str_(w0[CHO2_L_W_NAME_]) || Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/個人/氏名"])); // 先頭従事者名のみ（他N名は G14）
    // 許可証番号は従事者ごと "1-1-1" …（セル書式 第@号）。複数なら範囲＋他N名。
    Cho2_push_(cells, "C" + (14 + sh), Cho2_certNoRaw_(kyokaNo, 1));
    if (workers.length > 1) {
      Cho2_push_(cells, "D" + (14 + sh), "～");
      Cho2_push_(cells, "E" + (14 + sh), Cho2_certNoRaw_(kyokaNo, workers.length));
      Cho2_pushNum_(cells, "G" + (14 + sh), workers.length - 1); // セル書式 "他#名"（先頭1名を除く人数）
    }
  }
  // 種数グリッド（base を +sh。共有定数 CHO2_GRID_TSUCHI_ は汚さずインライン）。
  var grid = Cho2_gridCells_(
    { base: CHO2_GRID_TSUCHI_.base + sh, name: CHO2_GRID_TSUCHI_.name, count: CHO2_GRID_TSUCHI_.count, j: CHO2_GRID_TSUCHI_.j, k: CHO2_GRID_TSUCHI_.k },
    aggSpecies
  );
  for (var i = 0; i < grid.length; i++) cells.push(grid[i]);
  Cho2_push_(cells, "C" + (26 + sh), Cho2_str_(parent[CHO2_L_PURPOSE_]));
  Cho2_pushDate_(cells, "C" + (28 + sh), parent[CHO2_L_PERIOD_START_]);
  Cho2_pushDate_(cells, "F" + (28 + sh), parent[CHO2_L_PERIOD_END_]);
  Cho2_push_(cells, "C" + (30 + sh), Cho2_str_(parent[CHO2_L_AREA_]));
  Cho2_push_(cells, "C" + (32 + sh), unionTools.join(","));
  Cho2_push_(cells, "C" + (34 + sh), Cho2_str_(parent[CHO2_L_COND_])); // 許可の条件（空ならスキップ）
  return cells;
}

// 1 申請 → 生成プラン（どのシートをどう複製し、各シートにどの差分を入れるか）。GAS 非依存。
//   forcedType: "個人"/"法人"（画面のラジオ）。未指定なら自動判定。
function Cho2_buildPlan_(app, forcedType) {
  var parent = app.parent, workers = app.workers || [];
  var type = (forcedType === "個人" || forcedType === "法人") ? forcedType : Cho2_applicantType_(parent);
  var kyokaNo = Cho2_str_(parent[CHO2_L_KYOKA_NO_]);
  var agg = Cho2_aggregateSpecies_(workers);
  var unionTools = Cho2_unionTools_(workers);

  // 従事者名簿（8 名/シート・9 名以上はシートを複製）。plan.roster = [{label, cells}]（従事者証と同形）。
  var roster = [];
  var perSheet = CHO2_ROSTER_.blockCount; // 8
  for (var rs = 0; rs < workers.length; rs += perSheet) {
    var rosterCells = [];
    var rosterN = Math.min(perSheet, workers.length - rs);
    for (var b = 0; b < rosterN; b++) {
      var top = CHO2_ROSTER_.firstRow + b * CHO2_ROSTER_.blockHeight; // 各シートとも行 5 から
      var gi = rs + b;                                                // 全体通し番号（許可証番号用）
      var blk = Cho2_rosterBlockCells_(workers[gi], top, Cho2_certNoRaw_(kyokaNo, gi + 1)); // E 列＝"1-1-1" 連結
      for (var i = 0; i < blk.length; i++) rosterCells.push(blk[i]);
    }
    roster.push({ label: String((rs / perSheet) + 1), cells: rosterCells });
  }
  if (roster.length === 0) roster.push({ label: "1", cells: [] }); // 従事者 0 名でも名簿は 1 枚残す

  // 許可証: 法人=1(集計) / 個人=人数分(各自)
  var kyokasho = [];
  if (type === "法人") {
    var hHeader = {
      address: Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/法人/住所"]),
      name: Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/法人/法人名"]),
      birthOrRep: Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/法人/代表者名"]),
      birthIsDate: false
    };
    kyokasho.push({ label: hHeader.name || "法人", cells: Cho2_kyokashoCells_(parent, agg, unionTools, hHeader, kyokaNo) });
  } else {
    for (var k = 0; k < workers.length; k++) {
      var wk = workers[k];
      var head = {
        address: Cho2_str_(wk[CHO2_L_W_ADDRESS_]),
        name: Cho2_str_(wk[CHO2_L_W_NAME_]),
        birthOrRep: wk[CHO2_L_W_BIRTH_],
        birthIsDate: true
      };
      kyokasho.push({
        label: head.name || ("従事者" + (k + 1)),
        // 個人の許可証番号は従事者ごとに "1-1-1" / "1-1-2"（法人は base "1-1"）
        cells: Cho2_kyokashoCells_(parent, Cho2_workerSpecies_(wk), Cho2_workerTools_(wk), head, Cho2_certNoRaw_(kyokaNo, k + 1))
      });
    }
  }

  // 従事者証: 法人=人数分(集計頭数・各自方法) / 個人=なし
  var juji = [];
  if (type === "法人") {
    var hojinName = Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/法人/法人名"]);
    for (var j = 0; j < workers.length; j++) {
      juji.push({
        label: Cho2_str_(workers[j][CHO2_L_W_NAME_]) || ("従事者" + (j + 1)),
        cells: Cho2_jujiCells_(parent, workers[j], agg, Cho2_workerTools_(workers[j]), hojinName, kyokaNo, Cho2_certNoRaw_(kyokaNo, j + 1))
      });
    }
  }

  // 通知（振興局・警察 各1・全員合計）＝標準レイアウト。交付通知書は +1 行シフト＋宛名。
  var tsuchi = Cho2_tsuchiCells_(parent, workers, agg, unionTools, type, kyokaNo, CHO2_TSUCHI_LAYOUT_STD_);
  var kofu = Cho2_tsuchiCells_(parent, workers, agg, unionTools, type, kyokaNo, CHO2_TSUCHI_LAYOUT_KOFU_);

  // 交付通知書 B9 段落の {{gge年M月D日}} を受付日の和暦へ置換（純関数側で値だけ確定・記入は fill 層）。
  var kofuTokens = [];
  var appParts = Cho2_dateParts_(parent[CHO2_L_RECEIPT_DATE_]);
  if (appParts) kofuTokens.push({ a1: "B9", token: "{{gge年M月D日}}", value: Cho2_warekiString_(appParts) });

  return {
    type: type,
    workerCount: workers.length,
    roster: roster, // [{label, cells}]（8 名/シート・9 名以上は複数エントリ）
    kyokasho: kyokasho, // [{label, cells}]
    juji: juji,         // [{label, cells}]
    kofu: kofu,         // 交付通知書（各1・全員合計・+1行シフト）
    kofuTokens: kofuTokens, // [{a1, token, value}]（B9 トークン置換）
    shinko: tsuchi,
    keisatsu: tsuchi
  };
}


// #############################################################################
// ## fill.gs — GAS I/O（テンプレ複製→記入→スプレッドシート保存→リンク）
// #############################################################################

// Cho2_applyCells_ が記録する「直近の書き込み」マップ（セルアドレス → {sheet, val}）。
// flush 例外のセルアドレスと突合してエラーメッセージを補強するために使う。
var Cho2_pendingWrites_ = {};

// google.script.run から呼ぶ生成本体（末尾アンダースコア不可）。
//   ctxToken: doPost が保存した payload のトークン。options: { rowIndex, forcedType }
function Cho2_generate(ctxToken, optionsJson) {
  try {
    var data = Cho2_readCtx_(ctxToken);
    if (!data) return { ok: false, error: "送信データが見つかりません（時間切れの可能性）。検索画面のボタンから開き直してください。" };
    var options = (typeof optionsJson === "string") ? JSON.parse(optionsJson || "{}") : (optionsJson || {});
    var apps = Cho2_parseApplications_(data);
    var rowIndex = (typeof options.rowIndex === "number") ? options.rowIndex : 0;
    var app = apps[rowIndex];
    if (!app) return { ok: false, error: "対象の申請が見つかりません。" };
    if (!app.workers || app.workers.length === 0) {
      return { ok: false, error: "従事者データがありません。一覧から起動する場合は formLink の includeChildData を ON にしてください（単票からはそのまま動きます）。" };
    }
    var folder = Cho2_resolveRecordFolder_(app.folderUrl); // 渡されたフォルダのみ・無ければ throw
    var plan = Cho2_buildPlan_(app, options.forcedType || "");
    var fileName = Cho2_outputFileName_(app, plan);
    var out = Cho2_renderWorkbook_(plan, fileName, folder);
    return { ok: true, fileUrl: out.url, fileName: out.name, type: plan.type, workerCount: plan.workerCount, ssId: out.ssId };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      folderUrl: (typeof app !== "undefined" && app && app.folderUrl) ? app.folderUrl : ""
    };
  }
}

function Cho2_outputFileName_(app, plan) {
  var base = "許可証等_" + (app.label || "申請") + "_" + plan.type;
  return base.replace(/[\\/:*?"<>|]/g, "-");
}

// テンプレートを複製して指定フォルダ内に Google Sheet として保存し、ファイル id を返す。
// 共有ドライブ上のテンプレでも確実にコピーするため supportsAllDrives:true を付ける。
// Advanced Drive が失敗したら DriveApp.makeCopy にフォールバックする。
function Cho2_copyTemplateToFolder_(fileId, title, folderId) {
  try {
    var copied = Drive.Files.copy(
      { title: title, mimeType: "application/vnd.google-apps.spreadsheet", parents: [{ id: folderId }] },
      fileId,
      { supportsAllDrives: true }
    );
    if (copied && copied.id) return copied.id;
  } catch (e) {
    // フォールバックへ（多くは共有ドライブ/権限による File not found か Advanced Drive 無効）。
  }
  try {
    return DriveApp.getFileById(fileId).makeCopy(title, DriveApp.getFolderById(folderId)).getId();
  } catch (e2) {
    throw new Error(
      "テンプレート（許可証等様式）をコピーできませんでした。Web アプリのデプロイ実行アカウントが、" +
      "このファイル（共有ドライブ上の可能性があります）にアクセスできるか確認してください。fileId: " + fileId +
      "（詳細: " + (e2 && e2.message ? e2.message : e2) + "）"
    );
  }
}

// テンプレを出力フォルダへ複製 → シート複製・記入 → スプレッドシートとして保存。エラー時のみ削除。
function Cho2_renderWorkbook_(plan, fileName, folder) {
  var fileId = Cho2_templateFileId_();
  if (!fileId) throw new Error("テンプレート（許可証等様式）の URL が未設定です。画面の「テンプレートの保存先」で設定してください。");
  var ssId = null;
  var success = false;
  try {
    ssId = Cho2_copyTemplateToFolder_(fileId, fileName, folder.getId());
    var ss = SpreadsheetApp.openById(ssId);
    Cho2_pendingWrites_ = {}; // 書き込み前にリセット（flush 例外時の照合用）

    // 従事者名簿（8 名/シート・9 名以上はシート複製 → クリア→記入）
    Cho2_materializeRoster_(ss, plan.roster);

    // 許可証（法人=1 / 個人=N）
    Cho2_materializeAndFill_(ss, CHO2_SHEET_KYOKASHO_, plan.kyokasho);

    // 従事者証（法人=N / 個人=0）
    Cho2_materializeAndFill_(ss, CHO2_SHEET_JUJI_, plan.juji);

    // 交付通知書（各 1・クリア→記入→B9 の {{gge年M月D日}} をトークン置換）
    Cho2_fillSingle_(ss, CHO2_SHEET_KOFU_, plan.kofu);
    Cho2_applyTokenReplacements_(ss.getSheetByName(CHO2_SHEET_KOFU_), plan.kofuTokens);

    // 通知（各 1・クリア→記入）
    Cho2_fillSingle_(ss, CHO2_SHEET_SHINKO_, plan.shinko);
    Cho2_fillSingle_(ss, CHO2_SHEET_KEISATSU_, plan.keisatsu);

    Cho2_reorderSheets_(ss);
    try {
      SpreadsheetApp.flush();
    } catch (flushErr) {
      // flush 例外にはセルアドレスが含まれるので Cho2_pendingWrites_ と突合してシート名・値を付加する
      var flushMsg = String(flushErr.message || flushErr);
      var mCell = /セル([A-Z]+\d+)/.exec(flushMsg);
      if (mCell) {
        var wInfo = Cho2_pendingWrites_[mCell[1]];
        if (wInfo) throw new Error('シート「' + wInfo.sheet + '」セル ' + mCell[1] + ' に値「' + wInfo.val + '」を書き込めませんでした: ' + flushMsg);
      }
      throw flushErr;
    }

    var ssFile = DriveApp.getFileById(ssId);
    success = true;
    return { url: ssFile.getUrl(), name: ssFile.getName(), ssId: ssId };
  } finally {
    if (!success && ssId) { try { Drive.Files.remove(ssId, { supportsAllDrives: true }); } catch (e) { /* no-op */ } }
  }
}

// 従事者名簿を entries.length 枚に複製して記入（8 名/枚）。entries=[{label,cells}]。
// 名簿はテンプレの 1 人目ブロックが免許列(R..Y)縦結合済みで per-row に書けないため、各シートで
// R:Y の結合を解除してから記入する（materializeAndFill との違いはこの breakApart と専用クリア範囲）。
function Cho2_materializeRoster_(ss, entries) {
  var base = ss.getSheetByName(CHO2_SHEET_ROSTER_);
  if (!base || !entries || entries.length === 0) return;
  var firstRow = CHO2_ROSTER_.firstRow;
  var lastRow = firstRow + CHO2_ROSTER_.blockCount * CHO2_ROSTER_.blockHeight; // 5+8*9=77
  // 記入前に空テンプレのまま必要枚数を複製（copyTo は末尾に追加。記入後に複製するとデータごと複製される）。
  var sheets = [base];
  for (var k = 1; k < entries.length; k++) sheets.push(base.copyTo(ss));
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s];
    try { sh.getRange("R" + firstRow + ":Y" + lastRow).breakApart(); } catch (e) { /* no-op */ }
    sh.getRange("E" + firstRow + ":AA" + lastRow).clearContent();
    Cho2_applyCells_(sh, entries[s].cells);
    // 常に <様式名>_<識別接尾語>。名簿の接尾語はページ番号（entries[s].label = "1","2",…）＝"従事者名簿_1ページ目"…
    sh.setName(Cho2_uniqueSheetName_(ss, CHO2_SHEET_ROSTER_ + "_" + entries[s].label + "ページ目", sh));
  }
}

// base シートを count 枚に複製して記入（count=0 なら base を削除）。entries=[{label,cells}]。
function Cho2_materializeAndFill_(ss, baseName, entries) {
  var base = ss.getSheetByName(baseName);
  if (!base) return;
  if (!entries || entries.length === 0) { ss.deleteSheet(base); return; }
  var clearList = CHO2_CLEAR_RANGES_[baseName] || [];
  if (entries.length === 1) {
    Cho2_clearRanges_(base, clearList);
    Cho2_applyCells_(base, entries[0].cells);
    base.setName(Cho2_uniqueSheetName_(ss, baseName + "_" + entries[0].label, base));
    return;
  }
  var made = [];
  for (var i = 0; i < entries.length; i++) {
    var sh = base.copyTo(ss);
    sh.setName(Cho2_uniqueSheetName_(ss, baseName + "_" + entries[i].label, sh));
    Cho2_clearRanges_(sh, clearList);
    Cho2_applyCells_(sh, entries[i].cells);
    made.push(sh);
  }
  ss.deleteSheet(base);
}

function Cho2_fillSingle_(ss, sheetName, cells) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return;
  Cho2_clearRanges_(sh, CHO2_CLEAR_RANGES_[sheetName] || []);
  Cho2_applyCells_(sh, cells);
}

// 既存セル文字列内のトークンを置換（クリアせず段落本文を温存。交付通知書 B9 の {{gge年M月D日}} 用）。
function Cho2_applyTokenReplacements_(sheet, list) {
  if (!sheet || !list || !list.length) return;
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var range = sheet.getRange(t.a1);
    var s = String(range.getValue() == null ? "" : range.getValue());
    if (s.indexOf(t.token) >= 0) range.setValue(s.split(t.token).join(t.value));
  }
}

function Cho2_clearRanges_(sheet, ranges) {
  for (var i = 0; i < ranges.length; i++) { try { sheet.getRange(ranges[i]).clearContent(); } catch (e) { /* no-op */ } }
}

// セル差分を書き込む。数値は数値、その他は文字列（先頭 = / 数字ハイフン連結は中和）。
// 日付は build 層（Cho2_pushDate_）で和暦文字列に変換済みなのでそのまま文字列として書く（{__date} は廃止）。
// 各書き込み前に Cho2_pendingWrites_ へ記録（flush 例外時のセルアドレス照合用）。
function Cho2_applyCells_(sheet, cells) {
  var sheetName = sheet.getName();
  for (var i = 0; i < cells.length; i++) {
    var c = cells[i], v = c.value;
    var displayVal = String(v == null ? "" : v);
    Cho2_pendingWrites_[c.a1] = { sheet: sheetName, val: displayVal };
    var range = sheet.getRange(c.a1);
    try {
      if (typeof v === "number") {
        range.setValue(v);
      } else {
        var s = String(v == null ? "" : v);
        // 先頭が数式/演算子、または "1-1" / "1-1-1" 等の数字ハイフン連結（許可番号）は
        // 日付/数値への誤変換を防ぐためテキスト化（先頭 ' は表示されずテキスト扱い・セル書式は維持）。
        if (/^[=+\-@]/.test(s) || /^\d+([-\/]\d+)+$/.test(s)) s = "'" + s;
        range.setValue(s);
      }
    } catch (e) {
      // setValue が即時例外を出す場合（レンジ不正・保護シート等）
      throw new Error('シート「' + sheetName + '」セル ' + c.a1 + ' に値「' + displayVal + '」を書き込めませんでした: ' + (e.message || e));
    }
  }
}

// シート順を 従事者名簿 → 許可証* → 交付通知書 → 振興局 → 警察 → 従事者証* に整える（best-effort）。
function Cho2_reorderSheets_(ss) {
  var order = [];
  var all = ss.getSheets();
  function pick(pred) { for (var i = 0; i < all.length; i++) { var n = all[i].getName(); if (pred(n) && order.indexOf(all[i]) === -1) order.push(all[i]); } }
  pick(function (n) { return n.indexOf(CHO2_SHEET_ROSTER_) === 0; }); // 名簿 + 名簿(2)…（「従事者証」は不一致）
  pick(function (n) { return n.indexOf(CHO2_SHEET_KYOKASHO_) === 0; });
  pick(function (n) { return n === CHO2_SHEET_KOFU_; });
  pick(function (n) { return n.indexOf(CHO2_SHEET_SHINKO_) === 0; });
  pick(function (n) { return n.indexOf(CHO2_SHEET_KEISATSU_) === 0; });
  pick(function (n) { return n.indexOf(CHO2_SHEET_JUJI_) === 0; });
  pick(function () { return true; }); // 残り
  for (var i = 0; i < order.length; i++) { ss.setActiveSheet(order[i]); ss.moveActiveSheet(i + 1); }
}

function Cho2_uniqueSheetName_(ss, name, selfSheet) {
  var base = String(name).substring(0, 90);
  var n = base, i = 2;
  while (true) {
    var ex = ss.getSheetByName(n);
    if (!ex || ex === selfSheet) return n;
    n = base + "(" + i + ")"; i++;
  }
}

function Cho2_templateFileId_() { return Cho2_extractFileId_(Cho2_getProp_("CHO2_TEMPLATE_URL", "")); }
function Cho2_extractFileId_(url) {
  var s = Cho2_str_(url);
  if (!s) return "";
  var m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/) || s.match(/^([a-zA-Z0-9_-]{20,})$/);
  return m ? m[1] : "";
}
// Drive フォルダ URL（/drive/folders/<id>・?id=・裸ID）→ フォルダ ID。
function Cho2_extractFolderId_(url) {
  var s = Cho2_str_(url);
  if (!s) return "";
  var m = s.match(/\/folders\/([a-zA-Z0-9_-]{20,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/) || s.match(/^([a-zA-Z0-9_-]{20,})$/);
  return m ? m[1] : "";
}
// 出力先＝レコードから渡されたフォルダのみ。未指定/解釈不可/アクセス不可は throw（フォールバックなし）。
function Cho2_resolveRecordFolder_(folderUrl) {
  var url = Cho2_str_(folderUrl);
  if (!url) throw new Error("出力先フォルダが渡されていません。フォーム側のファイルアップロード項目に保存先フォルダが必要です（「フォルダを自動作成して消さない」を ON にしてください）。");
  var id = Cho2_extractFolderId_(url);
  if (!id) throw new Error("出力先フォルダの URL を解釈できませんでした: " + url);
  try {
    return DriveApp.getFolderById(id);
  } catch (e) {
    throw new Error("出力先フォルダにアクセスできませんでした（存在・権限を確認してください）: " + url);
  }
}

// スコープ再認証トリガ（エディタで一度実行して同意する）。
function Cho2_authorize() {
  DriveApp.getRootFolder().getName();
  Drive.Files.list({ maxResults: 1 });
  SpreadsheetApp.getActiveSpreadsheet();
  Session.getActiveUser().getEmail();
  // 一括PDF出力で /export フェッチと pdf-lib CDN 取得を行うため external_request を消費して同意させる。
  try { UrlFetchApp.fetch("https://www.gstatic.com/generate_204", { muteHttpExceptions: true }); } catch (e) { /* no-op */ }
  return "authorized";
}


// #############################################################################
// ## pdf.gs — 一括PDF出力エンジン（print_kyokasyo からの移植）
// -----------------------------------------------------------------------------
// 生成した許可証等スプレッドシートの全シートを様式別の印刷設定で /export → PDF 化し、
// 1 つの「しおり付き結合 PDF」にまとめる。生成画面がこれを呼び、ブラウザ DL＋Drive 保存する。
// print_kyokasyo（②）は個別印刷メニュー専用に戻し、この一括ロジックは ① 自己完結のため移植した。
// pdf-lib が必須の箇所のみ async/await（スタイルは本体準拠で var + function 宣言・arrow 不使用）。
// #############################################################################

var CHO2_PRINT_SKIP_HIDDEN_ = true;

// 様式名（シート名の最初の "_" より前）ごとの印刷設定プリセット。margins はインチ。
// scaleMode:'fit'+fitToWidth:true = 横幅を 1 ページに合わせる。等倍は fit 指定なし。
var CHO2_PRINT_GENERIC_DEFAULT_ = {
  size: "A4", orientation: "portrait", scaleMode: "actual", fitToWidth: false,
  margins: { top: 0.75, bottom: 0.75, left: 0.7, right: 0.7 },
  horizontalCentered: true, gridlines: false
};
var CHO2_PRINT_FORM_DEFAULTS_ = {
  "許可証": { size: "A4", orientation: "landscape", scaleMode: "fit", fitToWidth: true,
    margins: { top: 0.4, bottom: 0.4, left: 0.7, right: 0.7 }, horizontalCentered: true, gridlines: false },
  "従事者名簿": { size: "A4", orientation: "landscape", scaleMode: "fit", fitToWidth: true,
    margins: { top: 0.4, bottom: 0.4, left: 0.7, right: 0.7 }, horizontalCentered: true, gridlines: false },
  "交付通知書": { size: "A4", orientation: "portrait", scaleMode: "fit", fitToWidth: true,
    margins: { top: 0.8, bottom: 0.4, left: 1.0, right: 1.0 }, horizontalCentered: true, gridlines: false },
  "振興局宛通知": { size: "A4", orientation: "portrait", scaleMode: "fit", fitToWidth: true,
    margins: { top: 0.8, bottom: 0.4, left: 1.0, right: 1.0 }, horizontalCentered: true, gridlines: false },
  "警察宛通知": { size: "A4", orientation: "portrait", scaleMode: "fit", fitToWidth: true,
    margins: { top: 0.8, bottom: 0.4, left: 1.0, right: 1.0 }, horizontalCentered: true, gridlines: false },
  "従事者証": { size: "A4", orientation: "landscape", scaleMode: "fit", fitToWidth: true,
    margins: { top: 0.7, bottom: 0.4, left: 0.7, right: 0.7 }, horizontalCentered: true, gridlines: false }
};

// シート名 → 様式名（最初の "_" より前。無ければシート名そのもの）。
function Cho2_printFormNameOf_(sheetName) {
  var s = Cho2_str_(sheetName);
  var i = s.indexOf("_");
  return i >= 0 ? s.slice(0, i) : s;
}
// 様式名の印刷設定。生成物は毎回テンプレの新規コピーで DocumentProperties が空なのでプリセットのみ使う。
function Cho2_loadPrintCfg_(formName) {
  return CHO2_PRINT_FORM_DEFAULTS_[formName] || CHO2_PRINT_GENERIC_DEFAULT_;
}
// ファイル名に使えない文字を "_" に。
function Cho2_printSanitize_(name) { return Cho2_str_(name).replace(/[\\\/:*?"<>|]/g, "_"); }

// ---- ページ構築（そのシートの実改ページを使用。API に改ページ取得は無く常に 1 帯=データ全域）----
function Cho2_buildPages_(sheet) {
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return [];
  var rowBands = Cho2_toBands_(Cho2_getRowBreaks_(sheet), lastRow);
  var colBands = Cho2_toBands_(Cho2_getColBreaks_(sheet), lastCol);
  var pages = [];
  for (var c = 0; c < colBands.length; c++) {
    for (var r = 0; r < rowBands.length; r++) {
      pages.push({ r1: rowBands[r][0] - 1, r2: rowBands[r][1], c1: colBands[c][0] - 1, c2: colBands[c][1] });
    }
  }
  return pages;
}
function Cho2_getRowBreaks_(sheet) {
  try { return sheet.getRowBreaks ? sheet.getRowBreaks() : []; } catch (e) { return []; }
}
function Cho2_getColBreaks_(sheet) {
  try { return sheet.getColumnBreaks ? sheet.getColumnBreaks() : []; } catch (e) { return []; }
}
function Cho2_toBands_(breaks, last) {
  var bands = [], prev = 0;
  var arr = (breaks || []).slice().sort(function (a, b) { return a - b; });
  for (var i = 0; i < arr.length; i++) {
    var b = arr[i];
    if (b > prev && b <= last) { bands.push([prev + 1, b]); prev = b; }
  }
  if (prev < last) bands.push([prev + 1, last]);
  if (!bands.length) bands.push([1, last]);
  return bands;
}

// ---- エクスポート URL ----
function Cho2_buildPageExportUrl_(ssId, gid, p, cfg) {
  var params = {
    format: "pdf", gid: gid,
    size: cfg.size || "A4",
    portrait: (cfg.orientation || "portrait") !== "landscape",
    gridlines: !!cfg.gridlines,
    printtitle: false, sheetnames: false, pagenumbers: false, fzr: false,
    r1: p.r1, c1: p.c1, r2: p.r2, c2: p.c2
  };
  // スケール: /export は % 不可のため fitTo で近似。等倍は指定しない。
  if (cfg.scaleMode === "fit") {
    if (cfg.fitToWidth) params.fitw = true;
  }
  if (cfg.horizontalCentered) params.horizontal_alignment = "CENTER";
  var m = cfg.margins || {};
  if (m.top != null) {
    params.top_margin = m.top; params.bottom_margin = m.bottom;
    params.left_margin = m.left; params.right_margin = m.right;
  }
  var keys = Object.keys(params), pairs = [];
  for (var k = 0; k < keys.length; k++) pairs.push(keys[k] + "=" + encodeURIComponent(params[keys[k]]));
  return "https://docs.google.com/spreadsheets/d/" + ssId + "/export?" + pairs.join("&");
}

// /export を取得。429/5xx/例外は指数バックオフでリトライ。成功→Blob / 最終失敗→null。
function Cho2_fetchExportWithRetry_(url, token, label) {
  var maxTry = 4, wait = 800;
  for (var t = 1; t <= maxTry; t++) {
    var code = 0;
    try {
      var res = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
      code = res.getResponseCode();
      if (code === 200) return res.getBlob();
    } catch (e) {
      Logger.log("fetch例外 %s (try %s): %s", label, t, e);
    }
    var retryable = (code === 0 || code === 429 || (code >= 500 && code <= 504));
    Logger.log("export失敗 %s: HTTP %s (try %s/%s)%s", label, code, t, maxTry, (retryable && t < maxTry) ? " → リトライ" : "");
    if (!retryable || t === maxTry) break;
    Utilities.sleep(wait);
    wait *= 2;
  }
  return null;
}

// 1 シートを PDF 化。{status:'ok',blob} / {status:'empty'} / {status:'failed'}。
async function Cho2_sheetToPdfBlob_(ss, sheet, cfg, token) {
  var pages = Cho2_buildPages_(sheet);
  if (!pages.length) return { status: "empty" };
  var blobs = [];
  for (var i = 0; i < pages.length; i++) {
    var url = Cho2_buildPageExportUrl_(ss.getId(), sheet.getSheetId(), pages[i], cfg);
    var blob = Cho2_fetchExportWithRetry_(url, token, sheet.getName() + " p" + (i + 1));
    if (!blob) return { status: "failed" }; // 1 ページでも欠ければシート不完全＝失敗扱い
    blobs.push(blob);
    Utilities.sleep(120);
  }
  var name = Cho2_printSanitize_(sheet.getName()) + ".pdf";
  var merged = await Cho2_mergePdfBlobs_(blobs, name);
  return { status: "ok", blob: merged };
}

// 選択シートを様式別設定で個別 PDF 化して順序付きで集める。{items,succeeded,failed,empty}。
async function Cho2_collectSheetPdfs_(ss, targets, token) {
  var want = {};
  for (var i = 0; i < targets.length; i++) want[targets[i]] = true;
  var items = [], usedNames = {}, succeeded = [], failed = [], empty = [];
  var sheets = ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    if (CHO2_PRINT_SKIP_HIDDEN_ && sheet.isSheetHidden()) continue;
    if (!want[sheet.getName()]) continue;
    var sname = sheet.getName();
    var cfg = Cho2_loadPrintCfg_(Cho2_printFormNameOf_(sname));
    var result = await Cho2_sheetToPdfBlob_(ss, sheet, cfg, token);
    if (result.status !== "ok") {
      if (result.status === "empty") empty.push(sname); else failed.push(sname);
      continue;
    }
    var blob = result.blob;
    var base = Cho2_printSanitize_(sname), fname = base + ".pdf", n = 2;
    while (usedNames[fname]) { fname = base + "(" + n + ").pdf"; n++; }
    usedNames[fname] = true;
    blob.setName(fname);
    items.push({ name: sname, blob: blob });
    succeeded.push(sname);
  }
  return { items: items, succeeded: succeeded, failed: failed, empty: empty };
}

// 未出力の内訳ラベルを組み立てる。
function Cho2_buildNote_(failed, empty) {
  var parts = [];
  if (failed && failed.length) parts.push("ダウンロード失敗: " + failed.join(", "));
  if (empty && empty.length) parts.push("空のため未出力: " + empty.join(", "));
  return parts.join(" ／ ");
}

// ---- PDF 結合（pdf-lib を CDN から eval ロード） ----
var Cho2_pdfLibLoaded_ = false;
function Cho2_ensurePdfLib_() {
  if (Cho2_pdfLibLoaded_ && typeof globalThis.PDFLib !== "undefined") return;
  var cdn = "https://cdn.jsdelivr.net/npm/pdf-lib/dist/pdf-lib.min.js";
  var src = UrlFetchApp.fetch(cdn).getContentText().replace(/setTimeout\(.*?,.*?(\d*?)\)/g, "Utilities.sleep($1);return t();");
  eval(src);
  if (typeof PDFLib !== "undefined") globalThis.PDFLib = PDFLib;
  Cho2_pdfLibLoaded_ = true;
}

async function Cho2_mergePdfBlobs_(pdfBlobs, fileName) {
  Cho2_ensurePdfLib_();
  var PDFLib = globalThis.PDFLib;
  var merged = await PDFLib.PDFDocument.create();
  for (var i = 0; i < pdfBlobs.length; i++) {
    var doc = await PDFLib.PDFDocument.load(new Uint8Array(pdfBlobs[i].getBytes()));
    var pages = await merged.copyPages(doc, doc.getPageIndices());
    for (var p = 0; p < pages.length; p++) merged.addPage(pages[p]);
  }
  var bytes = await merged.save();
  return Utilities.newBlob([].slice.call(new Int8Array(bytes)), MimeType.PDF, fileName);
}

// items=[{name:シート名, blob}] を 1 PDF に結合し、各物理ページに元シート名のしおり（PDF アウトライン）を付ける。
// タイトルは PDFHexString.fromText で UTF-16BE 化され CJK も欠けない。
async function Cho2_mergeWithBookmarks_(items, fileName) {
  Cho2_ensurePdfLib_();
  var PDFLib = globalThis.PDFLib;
  var PDFDocument = PDFLib.PDFDocument, PDFDict = PDFLib.PDFDict, PDFArray = PDFLib.PDFArray;
  var PDFName = PDFLib.PDFName, PDFNumber = PDFLib.PDFNumber, PDFHexString = PDFLib.PDFHexString;
  var merged = await PDFDocument.create();
  var entries = []; // {title, pageIndex}（1 物理ページ = 1 しおり）
  for (var i = 0; i < items.length; i++) {
    var doc = await PDFDocument.load(new Uint8Array(items[i].blob.getBytes()));
    var startIndex = merged.getPageCount();
    var pages = await merged.copyPages(doc, doc.getPageIndices());
    for (var pp = 0; pp < pages.length; pp++) merged.addPage(pages[pp]);
    var cnt = pages.length;
    for (var p = 0; p < cnt; p++) {
      var title = cnt > 1 ? (items[i].name + "（p" + (p + 1) + "）") : items[i].name;
      entries.push({ title: title, pageIndex: startIndex + p });
    }
  }
  if (entries.length) {
    var context = merged.context;
    var outlinesDict = PDFDict.withContext(context);
    var outlinesRef = context.register(outlinesDict);
    var itemRefs = [];
    for (var q = 0; q < entries.length; q++) itemRefs.push(context.nextRef());
    for (var idx = 0; idx < entries.length; idx++) {
      var en = entries[idx];
      var page = merged.getPage(en.pageIndex);
      var dest = PDFArray.withContext(context);
      dest.push(page.ref);
      dest.push(PDFName.of("Fit"));
      var dict = PDFDict.withContext(context);
      dict.set(PDFName.of("Title"), PDFHexString.fromText(en.title));
      dict.set(PDFName.of("Parent"), outlinesRef);
      dict.set(PDFName.of("Dest"), dest);
      if (idx > 0) dict.set(PDFName.of("Prev"), itemRefs[idx - 1]);
      if (idx < entries.length - 1) dict.set(PDFName.of("Next"), itemRefs[idx + 1]);
      context.assign(itemRefs[idx], dict);
    }
    outlinesDict.set(PDFName.of("Type"), PDFName.of("Outlines"));
    outlinesDict.set(PDFName.of("First"), itemRefs[0]);
    outlinesDict.set(PDFName.of("Last"), itemRefs[itemRefs.length - 1]);
    outlinesDict.set(PDFName.of("Count"), PDFNumber.of(entries.length));
    merged.catalog.set(PDFName.of("Outlines"), outlinesRef);
    merged.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
  }
  var bytes = await merged.save();
  return Utilities.newBlob([].slice.call(new Int8Array(bytes)), MimeType.PDF, fileName);
}

// google.script.run から呼ぶ（末尾アンダースコア不可）: 生成済みスプレッドシート(ssId)の全シートを
// しおり付き結合 PDF にし、同じ（＝記録）フォルダへ保存しつつ base64 を返す。
async function Cho2_generatePdf(ssId) {
  try {
    var id = Cho2_str_(ssId);
    if (!id) return { ok: false, error: "スプレッドシートIDが指定されていません。" };
    var ss = SpreadsheetApp.openById(id);
    var token = ScriptApp.getOAuthToken();
    var targets = [], sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (CHO2_PRINT_SKIP_HIDDEN_ && sheets[i].isSheetHidden()) continue;
      targets.push(sheets[i].getName());
    }
    var col = await Cho2_collectSheetPdfs_(ss, targets, token);
    var note = Cho2_buildNote_(col.failed, col.empty);
    if (!col.items.length) {
      return { ok: false, error: "PDF 出力対象がありませんでした。" + (note ? "（" + note + "）" : ""),
        succeeded: col.succeeded, failed: col.failed, empty: col.empty };
    }
    var fileName = Cho2_printSanitize_(ss.getName()) + ".pdf";
    var merged = await Cho2_mergeWithBookmarks_(col.items, fileName);
    // Drive 保存: スプレッドシートと同じ（＝記録）フォルダへ。保存失敗は致命的でなく DL は続行する。
    var pdfUrl = "";
    try {
      var parents = DriveApp.getFileById(id).getParents();
      var saved = parents.hasNext() ? parents.next().createFile(merged) : DriveApp.createFile(merged);
      pdfUrl = saved.getUrl();
    } catch (e) { /* no-op */ }
    return { ok: true, name: merged.getName(), mime: MimeType.PDF,
      b64: Utilities.base64Encode(merged.getBytes()), pdfUrl: pdfUrl, note: note,
      succeeded: col.succeeded, failed: col.failed, empty: col.empty };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}


// #############################################################################
// ## settings.gs — Script Properties（テンプレ URL ほか）
// #############################################################################

function Cho2_props_() { return PropertiesService.getScriptProperties(); }
function Cho2_getProp_(key, def) {
  try { var v = Cho2_props_().getProperty(key); return (v === null || v === undefined) ? (def || "") : v; }
  catch (e) { return def || ""; }
}

// 画面（google.script.run）から呼ぶ: テンプレ URL の保存（末尾アンダースコア不可）。
function Cho2_setTemplateUrl(url) {
  var s = Cho2_str_(url);
  Cho2_props_().setProperty("CHO2_TEMPLATE_URL", s);
  return { ok: true, url: s, fileId: Cho2_extractFileId_(s) };
}
// 画面（google.script.run）から呼ぶ: 現在のテンプレ URL 取得。
function Cho2_getTemplateUrl() {
  var s = Cho2_getProp_("CHO2_TEMPLATE_URL", "");
  return { ok: true, url: s, fileId: Cho2_extractFileId_(s) };
}

// エディタから一度実行して各種設定を登録する（任意。すべて省略可＝指定したものだけ上書き）。
//   templateUrl: 様式 xlsx の Drive URL（または fileId）
//   outputFolderId: 生成 xlsx の保存フォルダ（空なら My Drive ルート）
//   extActionSecret: 本体 NFB_EXT_ACTION_SECRET と同じ共有シークレット（本体で設定時のみ）
function Cho2_registerSettings(templateUrl, outputFolderId, extActionSecret) {
  var p = Cho2_props_();
  if (templateUrl != null && templateUrl !== "") p.setProperty("CHO2_TEMPLATE_URL", String(templateUrl));
  if (outputFolderId != null) p.setProperty("CHO2_OUTPUT_FOLDER_ID", String(outputFolderId));
  if (extActionSecret != null) p.setProperty("CHO2_EXT_ACTION_SECRET", String(extActionSecret));
  return {
    templateUrl: Cho2_getProp_("CHO2_TEMPLATE_URL", ""),
    templateFileId: Cho2_templateFileId_(),
    outputFolderId: Cho2_getProp_("CHO2_OUTPUT_FOLDER_ID", ""),
    extActionSecretSet: Cho2_getProp_("CHO2_EXT_ACTION_SECRET", "") !== ""
  };
}


// #############################################################################
// ## relay.gs — リレー受信（プローブ HMAC・ctx キャッシュ・openUrl）
// #############################################################################

function Cho2_hmacHex_(message, secret) {
  var raw = Utilities.computeHmacSha256Signature(String(message == null ? "" : message), String(secret == null ? "" : secret));
  var hex = "";
  for (var i = 0; i < raw.length; i++) { var b = (raw[i] + 256) % 256; var s = b.toString(16); if (s.length === 1) s = "0" + s; hex += s; }
  return hex;
}

// ULID 風トークン。
function Cho2_token_() {
  var ts = (new Date()).getTime().toString(36), rand = "";
  for (var i = 0; i < 10; i++) rand += "0123456789abcdefghijklmnopqrstuvwxyz".charAt(Math.floor(Math.random() * 36));
  return "k_" + ts + "_" + rand;
}

// payload をスクリプトキャッシュへ（doPost と doGet/generate は別リクエスト）。90KB ごとに分割（CacheService 上限対策）。
function Cho2_putCtx_(data) {
  var token = Cho2_token_();
  try {
    var s = JSON.stringify(data || {});
    var cache = CacheService.getScriptCache();
    var CHUNK = 90000, parts = [];
    for (var i = 0; i < s.length; i += CHUNK) parts.push(s.substring(i, i + CHUNK));
    var map = {};
    for (var j = 0; j < parts.length; j++) map["kctx_" + token + "_" + j] = parts[j];
    cache.putAll(map, 1800); // 30 分
    cache.put("kctx_" + token + "_n", String(parts.length), 1800);
  } catch (e) { /* no-op */ }
  return token;
}
function Cho2_readCtx_(token) {
  try {
    var t = String(token || ""); if (!t) return null;
    var cache = CacheService.getScriptCache();
    var nStr = cache.get("kctx_" + t + "_n"); if (!nStr) return null;
    var n = Number(nStr), keys = [];
    for (var i = 0; i < n; i++) keys.push("kctx_" + t + "_" + i);
    var got = cache.getAll(keys), s = "";
    for (var j = 0; j < n; j++) { var part = got["kctx_" + t + "_" + j]; if (part == null) return null; s += part; }
    return JSON.parse(s);
  } catch (e) { return null; }
}

function Cho2_buildGenUrl_(token) {
  var base = "";
  try { base = ScriptApp.getService().getUrl() || ""; } catch (e) { base = ""; }
  var sep = base.indexOf("?") >= 0 ? "&" : "?";
  return base + sep + "page=gen" + (token ? "&ctx=" + encodeURIComponent(token) : "");
}


// #############################################################################
// ## ui.gs — 生成画面 / 設定画面（HtmlService・テンプレートリテラル）
// #############################################################################

// ctx の payload を解析し、画面に出すプレビュー（申請一覧・各申請の従事者）を作る純関数。
function Cho2_buildPreview_(data) {
  var apps = Cho2_parseApplications_(data);
  var out = [];
  for (var i = 0; i < apps.length; i++) {
    var a = apps[i];
    var type = Cho2_applicantType_(a.parent);
    var ws = [];
    for (var w = 0; w < (a.workers || []).length; w++) {
      var wk = a.workers[w];
      var sp = Cho2_workerSpecies_(wk), spList = [];
      for (var s = 0; s < CHO2_SPECIES_ORDER_.length; s++) {
        var name = CHO2_SPECIES_ORDER_[s], t = sp[name];
        if (t.count > 0 || t.egg > 0) spList.push(name + (t.count > 0 ? " " + t.count : "") + (t.egg > 0 ? " 卵" + t.egg : ""));
      }
      ws.push({ name: Cho2_str_(wk[CHO2_L_W_NAME_]) || ("従事者" + (w + 1)), tools: Cho2_workerTools_(wk).join(", "), species: spList.join(" / ") });
    }
    out.push({ index: i, label: a.label, type: type, workerCount: ws.length, workers: ws,
      kyokaNo: Cho2_str_(a.parent[CHO2_L_KYOKA_NO_]),
      kyokaDate: Cho2_str_(a.parent[CHO2_L_KYOKA_DATE_]),
      shobun: Cho2_choiceList_(a.parent[CHO2_L_SHOBUN_]).join(", "),
      folderUrl: a.folderUrl || "" });
  }
  return out;
}

// デバッグ表示用: 受信 payload の件数と先頭レコードの items 先頭 N 件（question/value）。
// プレビューが想定外（氏名崩れ等）のとき、ライブ payload の実形式を画面で確認するために使う。
function Cho2_buildDebug_(data) {
  var out = { recordCount: 0, itemCount: 0, items: [] };
  if (!data || typeof data !== "object") return out;
  var recs = (Object.prototype.toString.call(data.records) === "[object Array]") ? data.records : [];
  out.recordCount = recs.length;
  var first = recs[0] || {};
  var items = (Object.prototype.toString.call(first.items) === "[object Array]") ? first.items : [];
  out.itemCount = items.length;
  for (var i = 0; i < items.length && i < 30; i++) {
    var it = items[i] || {}, v = it.value;
    if (v && typeof v === "object") v = (typeof v.text === "string") ? v.text : JSON.stringify(v);
    out.items.push({ q: String(it.question == null ? "" : it.question), v: String(v == null ? "" : v) });
  }
  return out;
}

function Cho2_renderGenPage_(ctxToken) {
  var token = String(ctxToken == null ? "" : ctxToken);
  var data = Cho2_readCtx_(token);
  var preview = data ? Cho2_buildPreview_(data) : [];
  var tplUrl = Cho2_getProp_("CHO2_TEMPLATE_URL", "");
  var ctxJs = JSON.stringify(token);
  var prevJs = JSON.stringify(preview);
  var tplJs = JSON.stringify(tplUrl);
  var dbgJs = JSON.stringify(Cho2_buildDebug_(data));
  var html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>許可証等の出力</title>
<style>
body{font-family:-apple-system,"Segoe UI",Roboto,"Noto Sans JP",sans-serif;background:#f8f9fa;margin:0;padding:24px;color:#202124;}
.card{max-width:920px;margin:0 auto;background:#fff;border:1px solid #dadce0;border-radius:8px;padding:20px 24px;}
h1{font-size:18px;color:#1a73e8;}h2{font-size:14px;margin:18px 0 6px;}
label{font-size:13px;}label.blk{display:block;margin:12px 0 4px;font-weight:bold;}
input[type=text]{width:100%;padding:6px;box-sizing:border-box;}
button{margin-top:8px;padding:8px 16px;font-size:14px;cursor:pointer;}
button#gen{background:#1a73e8;color:#fff;border:none;border-radius:4px;}
.sec{border:1px solid #e0e0e0;border-radius:6px;padding:10px 12px;margin:10px 0;}
.muted{color:#5f6368;font-size:12px;}.ok{color:#188038;font-weight:bold;}.err{color:#c5221f;}
.warn{display:none;margin:0 0 14px;padding:10px 14px;border:1px solid #f1aeb5;border-radius:6px;background:#fce8e6;color:#c5221f;font-size:13px;font-weight:bold;}
.awarn{margin:6px 0 4px;padding:8px 12px;border:1px solid #f1aeb5;border-radius:5px;background:#fce8e6;color:#c5221f;font-size:13px;font-weight:bold;}
button:disabled{background:#dadce0;color:#80868b;cursor:not-allowed;}
table{border-collapse:collapse;width:100%;font-size:12px;margin-top:6px;}
th,td{border:1px solid #e0e0e0;padding:4px 6px;text-align:left;vertical-align:top;}
th{background:#f1f3f4;}
#status{margin-top:12px;font-size:13px;}#result{margin-top:12px;font-size:13px;}
</style></head><body><div class="card">
<h1>許可証等様式の出力（フォーム → スプレッドシート）</h1>

<div id="tplWarn" class="warn">⚠ 許可証等様式（テンプレート）の URL が未登録です。下の入力欄に Drive URL を登録してください。登録するまで生成できません。</div>

<div class="sec">
  <label class="blk">テンプレートの保存先（許可証等様式 の Drive URL）</label>
  <div class="muted">現在: <span id="curTpl"></span></div>
  <input type="text" id="tplUrl" placeholder="https://drive.google.com/file/d/.../view または fileId">
  <button id="saveTpl">この URL を保存</button>
  <span id="tplStatus" class="muted"></span>
</div>

<div id="apps"></div>
<div id="status"></div>
<div id="result"></div>
<details style="margin-top:16px"><summary class="muted" style="cursor:pointer">受信データの確認（デバッグ）</summary><div id="dbg" style="margin-top:8px"></div></details>
</div>
<script>
var CTX=${ctxJs}; var PREVIEW=${prevJs}; var TPL=${tplJs}; var DBG=${dbgJs};
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function showTpl(u){ $("curTpl").innerHTML = u ? ('<a href="'+esc(u)+'" target="_blank" rel="noopener">'+esc(u)+'</a>') : '<span class="err">未設定</span>'; }
function updateTplGate(){
  var unset = !TPL;
  $("tplWarn").style.display = unset ? "block" : "none";
  var g=$("gen"); if(g){ g.disabled = unset; g.title = unset ? "テンプレ URL を登録すると生成できます" : ""; }
  if(unset){ var inp=$("tplUrl"); if(inp) inp.focus(); }
}
showTpl(TPL); $("tplUrl").value = TPL;
$("saveTpl").onclick=function(){
  var u=$("tplUrl").value;
  $("tplStatus").textContent="保存中...";
  google.script.run.withSuccessHandler(function(r){ TPL=r.url; showTpl(r.url); updateTplGate(); $("tplStatus").textContent = r.fileId ? "保存しました（fileId: "+r.fileId+"）" : "保存しましたが URL から fileId を取得できませんでした。"; })
    .withFailureHandler(function(e){ $("tplStatus").innerHTML='<span class="err">失敗: '+esc(e.message)+'</span>'; })
    .Cho2_setTemplateUrl(u);
};
function shobunValid(s){ if(!s) return false; var v=s.split(/\s*,\s*/); for(var i=0;i<v.length;i++){ if(v[i]==="許可"||v[i]==="条件付き許可") return true; } return false; }
function shobunFukyoka(s){ if(!s) return false; return s.split(/\s*,\s*/).indexOf("不許可")!==-1; }
function renderApps(){
  if(!PREVIEW.length){ $("apps").innerHTML='<p class="err">送信データが見つかりません（時間切れの可能性）。検索画面のボタンから開き直してください。</p>'; return; }
  var h='<h2>出力する申請を選択</h2>';
  for(var i=0;i<PREVIEW.length;i++){
    var a=PREVIEW[i];
    h+='<div class="sec">';
    h+='<label><input type="radio" name="app" value="'+a.index+'"'+(i===0?' checked':'')+'> <b>'+esc(a.label)+'</b></label> ';
    h+='<label style="margin-left:12px">区分: <select class="atype" data-idx="'+a.index+'"><option value="">自動（'+esc(a.type)+'）</option><option value="個人">個人</option><option value="法人">法人</option></select></label>';
    h+=' <span class="muted">許可番号: '+esc(a.kyokaNo||"（未入力）")+' / 従事者 '+a.workerCount+' 名</span>';
    if(!a.kyokaDate) h+='<div class="awarn">⚠ 許可年月日が未入力です。</div>';
    if(shobunFukyoka(a.shobun)) h+='<div class="awarn">⚠ 処分の種類が「不許可」です。</div>';
    else if(!shobunValid(a.shobun)) h+='<div class="awarn">⚠ 処分の種類が「許可」または「条件付き許可」ではありません'+(a.shobun?'（現在: '+esc(a.shobun)+'）':'（未入力）')+'。</div>';
    if(a.workers.length){ h+='<table><thead><tr><th>従事者</th><th>種類・数量</th><th>方法</th></tr></thead><tbody>';
      for(var w=0;w<a.workers.length;w++){ var x=a.workers[w]; h+='<tr><td>'+esc(x.name)+'</td><td>'+esc(x.species)+'</td><td>'+esc(x.tools)+'</td></tr>'; }
      h+='</tbody></table>'; }
    else h+='<div class="err">従事者データがありません（一覧から起動時は formLink の includeChildData を ON に）。</div>';
    if(a.folderUrl){h+='<div class="muted" style="margin-top:4px;font-size:11px">出力先フォルダ: <a href="'+esc(a.folderUrl)+'" target="_blank" rel="noopener">開く</a></div>';}
    h+='</div>';
  }
  h+='<button id="gen">この内容で生成（Drive に保存）</button>';
  $("apps").innerHTML=h;
  $("gen").onclick=doGen;
  updateTplGate();
}
var lastPdfUrl=null, lastPdfName=null;
function b64ToBlobUrl(b64,mime){ var bin=atob(b64),len=bin.length,bytes=new Uint8Array(len); for(var i=0;i<len;i++)bytes[i]=bin.charCodeAt(i); return URL.createObjectURL(new Blob([bytes],{type:mime||"application/pdf"})); }
function triggerDownload(url,name){ var a=document.createElement("a"); a.href=url; a.download=name||"print.pdf"; document.body.appendChild(a); a.click(); setTimeout(function(){ try{document.body.removeChild(a);}catch(e){} },800); }
function doGen(){
  var r=document.querySelector('input[name="app"]:checked'); var idx=r?Number(r.value):0;
  var sel=document.querySelector('.atype[data-idx="'+idx+'"]'); var forced=sel?sel.value:"";
  $("status").textContent="生成中...（テンプレート複製・記入・スプレッドシート保存）"; $("gen").disabled=true; $("result").innerHTML="";
  google.script.run.withSuccessHandler(function(res){
    if(res&&res.ok){
      $("status").innerHTML='<span class="ok">様式を生成しました（'+esc(res.type)+' / 従事者 '+res.workerCount+' 名）。</span> 続けて一括PDFを作成します…';
      $("result").innerHTML='<a href="'+esc(res.fileUrl)+'" target="_blank" rel="noopener">'+esc(res.fileName)+' を開く（Drive）</a>';
      genPdf(res.ssId);
    } else {
      $("gen").disabled=false;
      var errHtml='<span class="err">失敗: '+esc(res&&res.error||"unknown")+'</span>'; if(res&&res.folderUrl){errHtml+=' ／ <a href="'+esc(res.folderUrl)+'" target="_blank" rel="noopener">フォルダを開く</a>';} $("status").innerHTML=errHtml;
    }
  }).withFailureHandler(function(e){ $("gen").disabled=false; $("status").innerHTML='<span class="err">エラー: '+esc(e.message)+'</span>'; })
    .Cho2_generate(CTX, JSON.stringify({rowIndex:idx, forcedType:forced}));
}
function genPdf(ssId){
  if(!ssId){ $("gen").disabled=false; return; }
  $("status").innerHTML='<span class="ok">様式を生成しました。</span> 一括PDFを作成中…（ページ数が多いと時間がかかります）';
  google.script.run.withSuccessHandler(function(res){
    $("gen").disabled=false;
    if(res&&res.ok){
      var note=res.note?(' <span class="muted">（'+esc(res.note)+'）</span>'):'';
      $("status").innerHTML='<span class="ok">一括PDFを作成しました（'+esc(res.name)+'）。ダウンロードを開始します。</span>'+note;
      if(lastPdfUrl){ try{URL.revokeObjectURL(lastPdfUrl);}catch(e){} }
      lastPdfUrl=b64ToBlobUrl(res.b64,res.mime); lastPdfName=res.name;
      triggerDownload(lastPdfUrl,lastPdfName);
      var h='<button id="dlPdf" style="background:#1a73e8;color:#fff;border:none;border-radius:4px;padding:8px 18px;font-weight:bold;margin-right:14px;cursor:pointer">PDFをダウンロード</button>';
      if(res.pdfUrl) h+='<a href="'+esc(res.pdfUrl)+'" target="_blank" rel="noopener" style="margin-right:14px">PDF を Drive で開く</a>';
      $("result").innerHTML=h+$("result").innerHTML;
      var b=$("dlPdf"); if(b) b.onclick=function(){ if(lastPdfUrl) triggerDownload(lastPdfUrl,lastPdfName); };
    } else {
      var note2=res&&res.note?(' <span class="muted">（'+esc(res.note)+'）</span>'):'';
      $("status").innerHTML='<span class="err">一括PDFの作成に失敗しました: '+esc(res&&res.error||"unknown")+'</span>'+note2+' <span class="muted">（スプレッドシートは保存済みです。下のリンクから開けます）</span>';
    }
  }).withFailureHandler(function(e){ $("gen").disabled=false; $("status").innerHTML='<span class="err">一括PDF作成エラー: '+esc(e.message)+'</span> <span class="muted">（スプレッドシートは保存済みです）</span>'; })
    .Cho2_generatePdf(ssId);
}
function renderDebug(){
  var d=$("dbg"); if(!d) return;
  var h='<div class="muted">records: '+esc(DBG.recordCount)+' / 先頭レコード items: '+esc(DBG.itemCount)+'（先頭'+(DBG.items?DBG.items.length:0)+'件を表示）</div>';
  if(DBG.items&&DBG.items.length){ h+='<table><thead><tr><th>question</th><th>value</th></tr></thead><tbody>';
    for(var i=0;i<DBG.items.length;i++){ h+='<tr><td>'+esc(DBG.items[i].q)+'</td><td>'+esc(DBG.items[i].v)+'</td></tr>'; }
    h+='</tbody></table>'; }
  else h+='<div class="muted">items がありません。</div>';
  d.innerHTML=h;
}
renderApps(); updateTplGate(); renderDebug();
</script></body></html>`;
  return HtmlService.createHtmlOutput(html).setTitle("許可証等の出力").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function Cho2_renderSettingsPage_() {
  var tplUrl = Cho2_getProp_("CHO2_TEMPLATE_URL", "");
  var tplJs = JSON.stringify(tplUrl);
  var html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>許可証等の出力 設定</title>
<style>
body{font-family:-apple-system,"Segoe UI",Roboto,"Noto Sans JP",sans-serif;background:#f8f9fa;margin:0;padding:24px;color:#202124;}
.card{max-width:760px;margin:0 auto;background:#fff;border:1px solid #dadce0;border-radius:8px;padding:20px 24px;}
h1{font-size:18px;color:#1a73e8;}label.blk{display:block;margin:14px 0 4px;font-weight:bold;font-size:13px;}
input[type=text]{width:100%;padding:6px;box-sizing:border-box;}button{margin-top:8px;padding:8px 16px;cursor:pointer;}
.muted{color:#5f6368;font-size:12px;}.ok{color:#188038;font-weight:bold;}.err{color:#c5221f;}
</style></head><body><div class="card">
<h1>許可証等の出力 — 設定</h1>
<p class="muted">この URL は本体フォームの外部アクションボタンから起動されます。ここではテンプレート（許可証等様式.xlsx）の保存先を設定します。生成画面で「生成」すると、様式作成に続けて一括PDFのダウンロードまで自動で行います。</p>
<label class="blk">テンプレートの保存先（Drive URL または fileId）</label>
<div class="muted">現在: <span id="curTpl"></span></div>
<input type="text" id="tplUrl" placeholder="https://drive.google.com/file/d/.../view">
<button id="saveTpl">保存</button> <span id="st" class="muted"></span>
</div>
<script>
var TPL=${tplJs};
function $(i){return document.getElementById(i);}
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function showTpl(u){ $("curTpl").innerHTML = u ? ('<a href="'+esc(u)+'" target="_blank" rel="noopener">'+esc(u)+'</a>') : '<span class="err">未設定</span>'; }
showTpl(TPL); $("tplUrl").value=TPL;
$("saveTpl").onclick=function(){ $("st").textContent="保存中...";
  google.script.run.withSuccessHandler(function(r){TPL=r.url;showTpl(r.url);$("st").textContent=r.fileId?("保存（fileId: "+r.fileId+"）"):"保存（fileId 取得不可）";})
    .withFailureHandler(function(e){$("st").innerHTML='<span class="err">'+esc(e.message)+'</span>';})
    .Cho2_setTemplateUrl($("tplUrl").value); };
</script></body></html>`;
  return HtmlService.createHtmlOutput(html).setTitle("許可証等の出力 設定").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// #############################################################################
// ## node エクスポート（GAS では module 未定義なので無視される）
// #############################################################################
if (typeof module === "object" && module.exports) {
  module.exports = {
    Cho2_parseRecordItems_: Cho2_parseRecordItems_,
    Cho2_parseApplications_: Cho2_parseApplications_,
    Cho2_applicantType_: Cho2_applicantType_,
    Cho2_workerSpecies_: Cho2_workerSpecies_,
    Cho2_aggregateSpecies_: Cho2_aggregateSpecies_,
    Cho2_workerTools_: Cho2_workerTools_,
    Cho2_unionTools_: Cho2_unionTools_,
    Cho2_toolLicense_: Cho2_toolLicense_,
    Cho2_permitNo_: Cho2_permitNo_,
    Cho2_certNoRaw_: Cho2_certNoRaw_,
    Cho2_kyokaBangoMark_: Cho2_kyokaBangoMark_,
    Cho2_docNo_: Cho2_docNo_,
    Cho2_permitNoRange_: Cho2_permitNoRange_,
    Cho2_gridCells_: Cho2_gridCells_,
    Cho2_rosterBlockCells_: Cho2_rosterBlockCells_,
    Cho2_kyokashoCells_: Cho2_kyokashoCells_,
    Cho2_jujiCells_: Cho2_jujiCells_,
    Cho2_tsuchiCells_: Cho2_tsuchiCells_,
    Cho2_buildPlan_: Cho2_buildPlan_,
    Cho2_buildPreview_: Cho2_buildPreview_,
    Cho2_extractFileId_: Cho2_extractFileId_,
    Cho2_extractFolderId_: Cho2_extractFolderId_,
    Cho2_resolveRecordFolder_: Cho2_resolveRecordFolder_,
    Cho2_hmacHex_: Cho2_hmacHex_,
    Cho2_choiceList_: Cho2_choiceList_,
    Cho2_dateParts_: Cho2_dateParts_,
    Cho2_warekiString_: Cho2_warekiString_,
    Cho2_printFormNameOf_: Cho2_printFormNameOf_,
    Cho2_printSanitize_: Cho2_printSanitize_,
    Cho2_toBands_: Cho2_toBands_,
    Cho2_buildPageExportUrl_: Cho2_buildPageExportUrl_,
    Cho2_buildNote_: Cho2_buildNote_,
    CHO2_SPECIES_ORDER_: CHO2_SPECIES_ORDER_,
    CHO2_TOOL_ORDER_: CHO2_TOOL_ORDER_,
    CHO2_GRID_KYOKASHO_: CHO2_GRID_KYOKASHO_,
    CHO2_GRID_TSUCHI_: CHO2_GRID_TSUCHI_,
    CHO2_GRID_JUJI_: CHO2_GRID_JUJI_
  };
}

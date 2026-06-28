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
// 生成画面で内容を確認して「生成」を押すと、様式テンプレート（許可証等様式.xlsx）を複製し
// 緑セルへリテラル値を書き込んだ xlsx を Drive に保存し、リンクを返す。
//
// 設計の核（許可証等様式 の緑セル＝掃き出し場所 FF00B050）:
//   緑 FF00B050 = 出力先。サンプル値は「どのセルへ何を書くか」の仕様。
//   従事者名簿 は緑なし＝マスター名簿（choju_yoshiki の名簿幾何と同一）。
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

function Cho2_escapeHtml_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}


// #############################################################################
// ## domain.gs — ラベル定数・緑セル番地表（番地はここ 1 箇所で管理）
// #############################################################################

// ----- 親フォーム「鳥獣保護管理法許可申請」のラベル（payload の question パスと一致）-----
var CHO2_CHILD_FORM_ID_ = "1Eh5p3Q5IMQEfi-7TiUV8ZZ8z_4HKW0Zj"; // 従事者情報
var CHO2_FORMLINK_LABEL_ = "従事者情報";                       // 親 schema の formLink ラベル（record items の親カードパス）
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
var CHO2_L_W_METHOD_ = "捕獲等又は採取等の方法（使用する捕獲用具の名称)"; // 閉じ括弧が半角!

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
var CHO2_GRID_TSUCHI_ = { base: 19, name: "C", count: "D", j: "F", k: "G" }; // 通知 C19:G27
var CHO2_GRID_JUJI_ = { base: 20, name: "K", count: "L", j: "N", k: "O" }; // 従事者証 K20:O28

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
var CHO2_ROSTER_ = {
  sheetName: "従事者名簿",
  firstRow: 5, blockHeight: 9, blockCount: 10,
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
var CHO2_SHEET_SHINKO_ = "振興局宛通知";
var CHO2_SHEET_KEISATSU_ = "警察宛通知";
var CHO2_SHEET_JUJI_ = "従事者証";

// 出力時にクリアしてから書き込む緑セル（サンプル値の消去用）。dump 済みの緑セル番地。
var CHO2_CLEAR_RANGES_ = {
  "許可証": ["H4:H5", "G12:L14", "G17:L25", "G26", "G28", "G31", "G33", "G35"],
  "振興局宛通知": ["F3:F4", "C13:H18", "C19:H27", "C28", "C31", "F31", "C34", "C37"],
  "警察宛通知": ["F3:F4", "C13:H18", "C19:H27", "C28", "C31", "F31", "C34", "C37"],
  "従事者証": ["F4:F5", "K14", "K17", "D18", "D25", "D32", "K20:P28", "K29", "K32", "K36", "K39"]
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
function Cho2_hasChoice_(v, label) { return Cho2_choiceList_(v).indexOf(label) !== -1; }

// "YYYY-MM-DD" / "YYYY/MM/DD"（時刻があっても日付部のみ）→ {y,m,d}。不可なら null。
function Cho2_dateParts_(v) {
  var s = Cho2_str_(v);
  var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (!m) return null;
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y: y, m: mo, d: d };
}

// レコードの items（{question,value,type}[]）→ { parent:{pathMap}, workers:[{pathMap}] }。
// 子（従事者）は items の question 接頭辞 "従事者情報/#<marker>/" で識別し marker ごとにまとめる。
// 起動元（編集画面・検索一覧の単一/複数選択）に依らず、子は常に items にインライン展開される。
function Cho2_parseRecordItems_(items) {
  var list = (Object.prototype.toString.call(items) === "[object Array]") ? items : [];
  var parent = {};
  var workersByMarker = {};
  var order = [];
  var prefix = CHO2_FORMLINK_LABEL_ + "/#";
  for (var i = 0; i < list.length; i++) {
    var it = list[i] || {};
    var q = String(it.question || "");
    var v = it.value;
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
  return { parent: parent, workers: workers };
}

// payload を「申請（アプリケーション）」配列へ。起動元に依らず records[] を 1 件ずつ処理する
// （編集画面・検索一覧の単一選択は 1 件、検索一覧の複数選択は N 件）。旧 context 分岐は廃止。
function Cho2_parseApplications_(data) {
  var records = (data && Object.prototype.toString.call(data.records) === "[object Array]") ? data.records : [];
  var apps = [];
  for (var i = 0; i < records.length; i++) {
    var rec = records[i] || {};
    var one = Cho2_parseRecordItems_(rec.items);
    apps.push({ parent: one.parent, workers: one.workers, label: Cho2_applicantDisplayName_(one) });
  }
  return apps;
}


// #############################################################################
// ## build.gs — 中間モデル → 各シートの「セル番地→値」差分（純ロジック）
// #############################################################################

// A1 番地の行+offset（例 "G17", 1 → "G18"）。
function Cho2_a1Offset_(a1, rowDelta) {
  var m = String(a1).match(/^([A-Z]+)([0-9]+)$/);
  if (!m) throw new Error("不正な番地: " + a1);
  return m[1] + (Number(m[2]) + rowDelta);
}

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
// 日付（{y,m,d} を Date 化して書く。GAS 側で Date オブジェクトとして渡す）。
function Cho2_pushDate_(cells, a1, raw) {
  var p = Cho2_dateParts_(raw);
  if (p) cells.push({ a1: a1, value: { __date: true, y: p.y, m: p.m, d: p.d } });
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
  Cho2_push_(cells, "G31", tools.join(","));
  Cho2_push_(cells, "G33", Cho2_choiceList_(parent[CHO2_L_DISPOSAL_]).join("・"));
  Cho2_push_(cells, "G35", Cho2_str_(parent[CHO2_L_COND_]));
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
  Cho2_push_(cells, "K17", hojinName);
  Cho2_push_(cells, "D18", Cho2_str_(worker[CHO2_L_W_ADDRESS_]));
  Cho2_push_(cells, "D25", Cho2_str_(worker[CHO2_L_W_NAME_]));
  Cho2_pushDate_(cells, "D32", worker[CHO2_L_W_BIRTH_]);
  var grid = Cho2_gridCells_(CHO2_GRID_JUJI_, aggSpecies);
  for (var i = 0; i < grid.length; i++) cells.push(grid[i]);
  Cho2_push_(cells, "K29", Cho2_str_(parent[CHO2_L_PURPOSE_]));
  Cho2_push_(cells, "K32", Cho2_str_(parent[CHO2_L_AREA_]));
  Cho2_push_(cells, "K36", workerTools.join(","));
  Cho2_push_(cells, "K39", Cho2_str_(parent[CHO2_L_COND_])); // テンプレの =IF 数式をリテラルで上書き
  // C4 従事者証番号（非緑）
  Cho2_push_(cells, "C4", jujiNo);
  return cells;
}

// 通知 1 枚の差分（振興局/警察 共通）。種数=全員合計、住所/氏名は申請者区分で出し分け。
function Cho2_tsuchiCells_(parent, workers, aggSpecies, unionTools, type, kyokaNo) {
  var cells = [];
  // F3:H3 / F4:H4 は結合セル（左上 F3/F4）。F3=許可番号そのまま("1-1")で "札環対許可第○号" はセル書式が付与。
  Cho2_push_(cells, "F3", Cho2_str_(kyokaNo));
  Cho2_pushDate_(cells, "F4", parent[CHO2_L_KYOKA_DATE_]); // 許可日（era 書式）
  // 住所・氏名
  if (type === "法人") {
    Cho2_push_(cells, "C13", Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/法人/住所"]));
    var hn = Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/法人/法人名"]);
    var rep = Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/法人/代表者名"]);
    Cho2_push_(cells, "C14", hn + (rep ? "　" + rep : ""));
  } else {
    var w0 = workers[0] || {};
    Cho2_push_(cells, "C13", Cho2_str_(w0[CHO2_L_W_ADDRESS_]) || Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/個人/住所"]));
    var nm = Cho2_str_(w0[CHO2_L_W_NAME_]) || Cho2_str_(parent[CHO2_L_APPLICANT_TYPE_ + "/個人/氏名"]);
    Cho2_push_(cells, "C14", nm + (workers.length > 1 ? "(ほか" + (workers.length - 1) + "名)" : ""));
  }
  Cho2_push_(cells, "C15", Cho2_kyokaBangoMark_(kyokaNo));
  Cho2_push_(cells, "D15", Cho2_permitNoRange_(kyokaNo, workers.length));
  // 従事者名及び従事者証番号（C16 にまとめて。氏名(第X-Y-n号)、… ）
  var names = [];
  for (var w = 0; w < workers.length; w++) {
    var nm2 = Cho2_str_(workers[w][CHO2_L_W_NAME_]);
    var no = Cho2_permitNo_(kyokaNo, w + 1);
    if (nm2) names.push(nm2 + (no ? "（" + no + "）" : ""));
  }
  Cho2_push_(cells, "C16", names.join("、"));
  var grid = Cho2_gridCells_(CHO2_GRID_TSUCHI_, aggSpecies);
  for (var i = 0; i < grid.length; i++) cells.push(grid[i]);
  Cho2_push_(cells, "C28", Cho2_str_(parent[CHO2_L_PURPOSE_]));
  Cho2_pushDate_(cells, "C31", parent[CHO2_L_PERIOD_START_]);
  Cho2_pushDate_(cells, "F31", parent[CHO2_L_PERIOD_END_]);
  Cho2_push_(cells, "C34", Cho2_str_(parent[CHO2_L_AREA_]));
  Cho2_push_(cells, "C37", unionTools.join(","));
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

  // 従事者名簿（マスター・常に 1 シート）
  var rosterCells = [];
  for (var b = 0; b < workers.length && b < CHO2_ROSTER_.blockCount; b++) {
    var top = CHO2_ROSTER_.firstRow + b * CHO2_ROSTER_.blockHeight;
    var blk = Cho2_rosterBlockCells_(workers[b], top, Cho2_certNoRaw_(kyokaNo, b + 1)); // E 列＝"1-1-1" 連結
    for (var i = 0; i < blk.length; i++) rosterCells.push(blk[i]);
  }

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
        cells: Cho2_jujiCells_(parent, workers[j], agg, Cho2_workerTools_(workers[j]), hojinName, kyokaNo, Cho2_permitNo_(kyokaNo, j + 1))
      });
    }
  }

  // 通知（振興局・警察 各1・全員合計）
  var tsuchi = Cho2_tsuchiCells_(parent, workers, agg, unionTools, type, kyokaNo);

  return {
    type: type,
    workerCount: workers.length,
    roster: rosterCells,
    kyokasho: kyokasho, // [{label, cells}]
    juji: juji,         // [{label, cells}]
    shinko: tsuchi,
    keisatsu: tsuchi
  };
}


// #############################################################################
// ## fill.gs — GAS I/O（テンプレ複製→記入→xlsx 保存→リンク）
// #############################################################################

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
    var plan = Cho2_buildPlan_(app, options.forcedType || "");
    var fileName = Cho2_outputFileName_(app, plan);
    var out = Cho2_renderWorkbook_(plan, fileName);
    return { ok: true, fileUrl: out.url, fileName: out.name, type: plan.type, workerCount: plan.workerCount };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

function Cho2_outputFileName_(app, plan) {
  var base = "許可証等_" + (app.label || "申請") + "_" + plan.type;
  return base.replace(/[\\/:*?"<>|]/g, "-");
}

// テンプレートを複製して Google Sheet 化した一時ファイルの id を返す。共有ドライブ上のテンプレでも
// 確実にコピーするため supportsAllDrives:true を付ける（本体 gas/driveFile.gs nfbMakeDriveFileCopy_ と同方針）。
// Advanced Drive が失敗（File not found 等）したら DriveApp.makeCopy にフォールバックする（テンプレは
// 既に Google Sheet 形式の前提なので変換不要）。両方失敗時はアクセス権を案内する明確なエラーを投げる。
function Cho2_copyTemplateToTmp_(fileId, title) {
  try {
    var copied = Drive.Files.copy(
      { title: title, mimeType: "application/vnd.google-apps.spreadsheet" },
      fileId,
      { supportsAllDrives: true }
    );
    if (copied && copied.id) return copied.id;
  } catch (e) {
    // フォールバックへ（多くは共有ドライブ/権限による File not found か Advanced Drive 無効）。
  }
  try {
    return DriveApp.getFileById(fileId).makeCopy(title).getId();
  } catch (e2) {
    throw new Error(
      "テンプレート（許可証等様式）をコピーできませんでした。Web アプリのデプロイ実行アカウントが、" +
      "このファイル（共有ドライブ上の可能性があります）にアクセスできるか確認してください。fileId: " + fileId +
      "（詳細: " + (e2 && e2.message ? e2.message : e2) + "）"
    );
  }
}

// テンプレを複製 → Google Sheet 化 → シート複製・記入 → xlsx エクスポート → Drive 保存。一時 Sheet は削除。
function Cho2_renderWorkbook_(plan, fileName) {
  var fileId = Cho2_templateFileId_();
  if (!fileId) throw new Error("テンプレート（許可証等様式）の URL が未設定です。画面の「テンプレートの保存先」で設定してください。");
  var tmpId = null;
  try {
    tmpId = Cho2_copyTemplateToTmp_(fileId, "_nfb_kyokasho_tmp");
    var ss = SpreadsheetApp.openById(tmpId);

    // 従事者名簿（クリア→記入）
    var roster = ss.getSheetByName(CHO2_SHEET_ROSTER_);
    if (roster) {
      var lastRow = CHO2_ROSTER_.firstRow + CHO2_ROSTER_.blockCount * CHO2_ROSTER_.blockHeight;
      // テンプレの 1 人目ブロックは免許列(R..Y=都道府県/番号/交付・登録・所持許可)が縦結合済みで、
      // 用具ごとの行（top+ti）へ書けない（非左上セルは setValue 不可）。全ブロックを per-row に
      // 揃えるため免許列の結合を解除する（2 人目以降や未結合行は no-op）。氏名等の左列結合は維持。
      try { roster.getRange("R" + CHO2_ROSTER_.firstRow + ":Y" + lastRow).breakApart(); } catch (e) { /* no-op */ }
      roster.getRange("E" + CHO2_ROSTER_.firstRow + ":AA" + lastRow).clearContent();
      Cho2_applyCells_(roster, plan.roster);
    }

    // 許可証（法人=1 / 個人=N）
    Cho2_materializeAndFill_(ss, CHO2_SHEET_KYOKASHO_, plan.kyokasho);

    // 従事者証（法人=N / 個人=0）
    Cho2_materializeAndFill_(ss, CHO2_SHEET_JUJI_, plan.juji);

    // 通知（各 1・クリア→記入）
    Cho2_fillSingle_(ss, CHO2_SHEET_SHINKO_, plan.shinko);
    Cho2_fillSingle_(ss, CHO2_SHEET_KEISATSU_, plan.keisatsu);

    Cho2_reorderSheets_(ss);
    SpreadsheetApp.flush();

    // xlsx エクスポート → 出力フォルダへ保存
    var blob = Cho2_exportXlsx_(tmpId, fileName);
    var folder = Cho2_resolveOutputFolder_();
    var file = folder.createFile(blob);
    return { url: file.getUrl(), name: file.getName() };
  } finally {
    if (tmpId) { try { Drive.Files.remove(tmpId, { supportsAllDrives: true }); } catch (e) { /* no-op */ } }
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

function Cho2_clearRanges_(sheet, ranges) {
  for (var i = 0; i < ranges.length; i++) { try { sheet.getRange(ranges[i]).clearContent(); } catch (e) { /* no-op */ } }
}

// セル差分を書き込む。{__date} は Date、数値は数値、その他は文字列（先頭 = は中和）。
function Cho2_applyCells_(sheet, cells) {
  for (var i = 0; i < cells.length; i++) {
    var c = cells[i], v = c.value, range = sheet.getRange(c.a1);
    if (v && typeof v === "object" && v.__date) {
      range.setValue(new Date(v.y, v.m - 1, v.d));
    } else if (typeof v === "number") {
      range.setValue(v);
    } else {
      var s = String(v == null ? "" : v);
      // 先頭が数式/演算子、または "1-1" / "1-1-1" 等の数字ハイフン連結（許可番号）は
      // 日付/数値への誤変換を防ぐためテキスト化（先頭 ' は表示されずテキスト扱い・セル書式は維持）。
      if (/^[=+\-@]/.test(s) || /^\d+([-\/]\d+)+$/.test(s)) s = "'" + s;
      range.setValue(s);
    }
  }
}

// シート順を 従事者名簿 → 許可証* → 振興局 → 警察 → 従事者証* に整える（best-effort）。
function Cho2_reorderSheets_(ss) {
  var order = [];
  var all = ss.getSheets();
  function pick(pred) { for (var i = 0; i < all.length; i++) { var n = all[i].getName(); if (pred(n) && order.indexOf(all[i]) === -1) order.push(all[i]); } }
  pick(function (n) { return n === CHO2_SHEET_ROSTER_; });
  pick(function (n) { return n.indexOf(CHO2_SHEET_KYOKASHO_) === 0; });
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

// Google Sheet を xlsx blob へエクスポート。
function Cho2_exportXlsx_(ssId, fileName) {
  var url = "https://www.googleapis.com/drive/v3/files/" + ssId +
    "/export?mimeType=" + encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  var resp = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (resp.getResponseCode() >= 400) throw new Error("xlsx エクスポートに失敗しました (HTTP " + resp.getResponseCode() + ")。");
  return resp.getBlob().setName((fileName || "許可証等") + ".xlsx");
}

function Cho2_templateFileId_() { return Cho2_extractFileId_(Cho2_getProp_("CHO2_TEMPLATE_URL", "")); }
function Cho2_extractFileId_(url) {
  var s = Cho2_str_(url);
  if (!s) return "";
  var m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/) || s.match(/^([a-zA-Z0-9_-]{20,})$/);
  return m ? m[1] : "";
}
function Cho2_resolveOutputFolder_() {
  var id = Cho2_getProp_("CHO2_OUTPUT_FOLDER_ID", "");
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* fall through */ } }
  return DriveApp.getRootFolder();
}

// スコープ再認証トリガ（エディタで一度実行して同意する）。
// xlsx エクスポートで UrlFetchApp を使うため script.external_request も同意させる。
function Cho2_authorize() {
  DriveApp.getRootFolder().getName();
  Drive.Files.list({ maxResults: 1 });
  SpreadsheetApp.getActiveSpreadsheet();
  Session.getActiveUser().getEmail();
  try { UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/about?fields=kind", { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }); } catch (e) { /* 同意取得目的なので失敗は無視 */ }
  return "authorized";
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
      kyokaNo: Cho2_str_(a.parent[CHO2_L_KYOKA_NO_]) });
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
button:disabled{background:#dadce0;color:#80868b;cursor:not-allowed;}
table{border-collapse:collapse;width:100%;font-size:12px;margin-top:6px;}
th,td{border:1px solid #e0e0e0;padding:4px 6px;text-align:left;vertical-align:top;}
th{background:#f1f3f4;}
#status{margin-top:12px;font-size:13px;}#result{margin-top:12px;font-size:13px;}
</style></head><body><div class="card">
<h1>許可証等様式の出力（フォーム → Excel）</h1>

<div id="tplWarn" class="warn">⚠ 許可証等様式（テンプレート）の URL が未登録です。下の入力欄に Drive URL を登録してください。登録するまで生成できません。</div>

<div class="sec">
  <label class="blk">テンプレートの保存先（許可証等様式.xlsx の Drive URL）</label>
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
function renderApps(){
  if(!PREVIEW.length){ $("apps").innerHTML='<p class="err">送信データが見つかりません（時間切れの可能性）。検索画面のボタンから開き直してください。</p>'; return; }
  var h='<h2>出力する申請を選択</h2>';
  for(var i=0;i<PREVIEW.length;i++){
    var a=PREVIEW[i];
    h+='<div class="sec">';
    h+='<label><input type="radio" name="app" value="'+a.index+'"'+(i===0?' checked':'')+'> <b>'+esc(a.label)+'</b></label> ';
    h+='<label style="margin-left:12px">区分: <select class="atype" data-idx="'+a.index+'"><option value="">自動（'+esc(a.type)+'）</option><option value="個人">個人</option><option value="法人">法人</option></select></label>';
    h+=' <span class="muted">許可番号: '+esc(a.kyokaNo||"（未入力）")+' / 従事者 '+a.workerCount+' 名</span>';
    if(a.workers.length){ h+='<table><thead><tr><th>従事者</th><th>種類・数量</th><th>方法</th></tr></thead><tbody>';
      for(var w=0;w<a.workers.length;w++){ var x=a.workers[w]; h+='<tr><td>'+esc(x.name)+'</td><td>'+esc(x.species)+'</td><td>'+esc(x.tools)+'</td></tr>'; }
      h+='</tbody></table>'; }
    else h+='<div class="err">従事者データがありません（一覧から起動時は formLink の includeChildData を ON に）。</div>';
    h+='</div>';
  }
  h+='<button id="gen">この内容で生成（Drive に保存）</button>';
  $("apps").innerHTML=h;
  $("gen").onclick=doGen;
  updateTplGate();
}
function doGen(){
  var r=document.querySelector('input[name="app"]:checked'); var idx=r?Number(r.value):0;
  var sel=document.querySelector('.atype[data-idx="'+idx+'"]'); var forced=sel?sel.value:"";
  $("status").textContent="生成中...（テンプレート複製・記入・xlsx 変換）"; $("gen").disabled=true; $("result").innerHTML="";
  google.script.run.withSuccessHandler(function(res){
    $("gen").disabled=false;
    if(res&&res.ok){ $("status").innerHTML='<span class="ok">生成しました（'+esc(res.type)+' / 従事者 '+res.workerCount+' 名）。</span>';
      $("result").innerHTML='<a href="'+esc(res.fileUrl)+'" target="_blank" rel="noopener">'+esc(res.fileName)+' を開く（Drive）</a>'; }
    else { $("status").innerHTML='<span class="err">失敗: '+esc(res&&res.error||"unknown")+'</span>'; }
  }).withFailureHandler(function(e){ $("gen").disabled=false; $("status").innerHTML='<span class="err">エラー: '+esc(e.message)+'</span>'; })
    .Cho2_generate(CTX, JSON.stringify({rowIndex:idx, forcedType:forced}));
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
<p class="muted">この URL は本体フォームの外部アクションボタンから起動されます。ここではテンプレート（許可証等様式.xlsx）の保存先のみ設定できます。</p>
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
    Cho2_hmacHex_: Cho2_hmacHex_,
    Cho2_choiceList_: Cho2_choiceList_,
    Cho2_dateParts_: Cho2_dateParts_,
    CHO2_SPECIES_ORDER_: CHO2_SPECIES_ORDER_,
    CHO2_TOOL_ORDER_: CHO2_TOOL_ORDER_,
    CHO2_GRID_KYOKASHO_: CHO2_GRID_KYOKASHO_,
    CHO2_GRID_TSUCHI_: CHO2_GRID_TSUCHI_,
    CHO2_GRID_JUJI_: CHO2_GRID_JUJI_
  };
}

// #############################################################################
// ## Code.gs
// #############################################################################

// =============================================================================
// 苦情・通報 PDF を「リンク受け取り → ブラウザ pdf.js でパース → 様式駆動で振り分け」する外部アクション
//
//   フォーム「R8環境共生担当課_苦情・通報等対応一覧」用のスタンドアロン GAS Web アプリ。
//   本体アプリ（gas/）には一切手を入れない（choju_yoshiki の兄弟）。
//
// 流れ:
//   (1) doGet(?page=parse&pdf=<DriveのURL/ID>) で、リンクを受け取った「パース」ページを開く（手貼りも可）。
//   (2) [パース] ボタン → google.script.run.Kuj_fetchPdfBase64_(ref) で GAS が Drive/URL の「生バイト」を base64 で返す（解析しない・中継のみ）。
//   (3) ブラウザの pdf.js が base64 → 全文テキスト抽出（GAS にできない唯一の処理。pdf.js は pdfjs.html を include）。
//   (4) google.script.run.Kuj_parseTextToRecords_(text, name) → GAS が様式判定＋ラベル抽出（Kuj_textToCandidate_）→
//       Kuj_candidateToData_ → Kuj_buildUploadRecords_ で uploadRecords(JSON) を生成。
//   (5) ユーザーがプレビューでネスト分類を補完し、本体アプリ（管理者 > Playground）の取り込み口で sync_records に流す。
//       ＝ choju と同じペースト運用。このアプリは本体へ直接書き込まない（越境書込みなし）。
//
// 分類は AI なし＝様式（フォーム雛形）駆動のラベル抽出のみ自動化。相談大分類などネストの深い意味分類は人手レビュー。
// 規約: 接頭辞 Kuj_ / 定数 KUJ_ / 内部ヘルパ末尾 _ / var + function（本体 gas/ に合わせる）。
// =============================================================================

// フォームの外部アクション（検索一覧の「末端問い合わせ csv 取り込み」ボタン）から、本体 GAS の
// サーバ間リレーで叩かれる。本アプリは Sheets へ直接書かない（CSV/PDF を JSON 化して管理者 >
// Playground へ貼る運用）ので、リレーには「取り込み（パース）ページの URL」を openUrl で返すだけにする。
// 本体フロント（interpretExternalActionResponse / SearchSidebar.buttons）がこの JSON を解釈し、
// openUrl を新しいタブで開く＝ボタン押下で CSV / PDF 取り込み画面が開く導線（choju と同方式）。
//   - nfbProbe=1: 本体にシークレット（KUJ_EXT_ACTION_SECRET = 本体 NFB_EXT_ACTION_SECRET）が
//     設定されているとき、本送信の前に誤送信防止プローブが来る。共有シークレットで HMAC(nonce) に
//     署名して返すと、本体が正規受信アプリと認める。シークレット未設定なら本体はプローブを送らない。
//   - それ以外: 取り込みページ（?page=parse）の URL を openUrl で返す。検索結果 payload は使わない。
function doPost(e) {
  try {
    var params = (e && e.parameter) || {};
    if (String(params.nfbProbe || "") === "1") {
      return Kuj_json_(Kuj_buildProbeResponse_(params.nonce));
    }
    var openUrl = Kuj_buildParseUrl_();
    return Kuj_json_({
      ok: true,
      nfbExternalAction: true,
      title: "苦情・通報の取り込み",
      message: openUrl
        ? "取り込みページを新しいタブで開きます。CSV ファイル（または PDF リンク）を選んで［パース］してください。"
        : "取り込みページの URL を取得できませんでした。?page=parse を直接開いてください。",
      openUrl: openUrl
    });
  } catch (err) {
    return Kuj_json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// JSON 応答（プローブ署名・openUrl いずれも JSON で返す）。
function Kuj_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj || { ok: false })).setMimeType(ContentService.MimeType.JSON);
}

// 取り込み（パース）ページの URL（?page=parse）。デプロイ URL は ScriptApp から解決する。
function Kuj_buildParseUrl_() {
  var base = "";
  try { base = ScriptApp.getService().getUrl() || ""; } catch (e) { base = ""; }
  if (!base) return "";
  return base + (base.indexOf("?") >= 0 ? "&" : "?") + "page=parse";
}

// HMAC-SHA256(message, secret) を 16 進文字列で返す（本体 ExtAction_hmacHex_ と同一実装）。
// GAS の computeHmacSha256Signature は符号付きバイト（-128..127）を返すので (b+256)%256 で符号無しに直す。
function Kuj_hmacHex_(message, secret) {
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
// シークレット未設定（KUJ_EXT_ACTION_SECRET 空）なら本体もプローブを送らない（後方互換）。
function Kuj_buildProbeResponse_(nonce) {
  return {
    ok: true,
    nfbExternalAction: true,
    signature: Kuj_hmacHex_(String(nonce == null ? "" : nonce), Kuj_prop_(KUJ_PROP_EXT_ACTION_SECRET_))
  };
}

// GET: セットアップ状態の確認 ＋ パースUI。
// 構造 HTML タグはリテラルで書くが、これは doGet の自前ページ（本体フロントの単一 HTML
// 配信経路とは別物）なので問題ない（choju 踏襲）。
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || "";
  if (page === "parse") {
    var keyErr = Kuj_checkAccessKey_(e);
    if (keyErr) return renderHtml_("アクセスエラー", "<p>" + escapeHtml_(keyErr) + "</p>", true);
    return Kuj_renderParsePage_(e);
  }
  var formId = KUJ_FORM_ID_();
  var body = ""
    + "<p>苦情・通報 PDF のリンクをパースし、フォーム用レコード(JSON)へ振り分けるスタンドアロン連携です。"
    + "PDF のテキスト抽出はブラウザ（pdf.js）で行うため、外部 AI / API は使いません。</p>"
    + "<ul>"
    + "<li><a href=\"?page=parse\">パースページ</a> を開く（URL に <code>?page=parse&amp;pdf=&lt;DriveのURL/ID&gt;</code> でリンクを渡せます。手貼りも可）。</li>"
    + "<li>[パース] を押すと、リンク先 PDF を読み取り uploadRecords(JSON) を生成します。</li>"
    + "<li>生成された JSON を本体アプリ（管理者 &gt; Playground）の取り込み口で sync_records に渡してレコード化します。</li>"
    + "</ul>"
    + "<table class=\"kv\"><tbody>"
    + "<tr><th>フォーム ID</th><td>" + (formId ? escapeHtml_(formId) : "(未設定・任意)") + "</td></tr>"
    + "<tr><th>抽出方式</th><td>ブラウザ pdf.js（外部 API 不使用）＋ 様式駆動ラベル抽出</td></tr>"
    + "</tbody></table>";
  return renderHtml_("苦情・通報 PDF 振り分け（pdf.js）", body, false);
}

function Kuj_checkAccessKey_(e) {
  var expected = Kuj_prop_(KUJ_PROP_ACCESS_KEY_);
  if (!expected) return "";
  var actual = e && e.parameter ? String(e.parameter.k || "") : "";
  return actual === expected ? "" : "アクセスキーが一致しません。URL の ?k= パラメータを確認してください。";
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
    'code{background:#fff;border:1px solid #dadce0;border-radius:4px;padding:1px 4px;font-size:12px;}' +
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
// ## codec.gs — フィールドパスの可逆エスケープ（gas/pathCodec.gs 移植）
// #############################################################################
// セグメント内の "/" と "\" をバックスラッシュエスケープ、区切りは "/"。
// 例: ["継続/完結"] → "継続\/完結"（1 セグメント）/ ["相談大分類","野生鳥獣","対象種"] → "相談大分類/野生鳥獣/対象種"。

var KUJ_PATH_SEP_ = "/";

function Kuj_escapeSegment_(segment) {
  var s = String(segment == null ? "" : segment);
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (ch === "\\" || ch === KUJ_PATH_SEP_) out += "\\";
    out += ch;
  }
  return out;
}

function Kuj_joinFieldPath_(segments) {
  if (!Array.isArray(segments)) return "";
  var out = [];
  for (var i = 0; i < segments.length; i++) out.push(Kuj_escapeSegment_(segments[i]));
  return out.join(KUJ_PATH_SEP_);
}


// #############################################################################
// ## schema.gs — フォーム選択肢・フィールド仕様（enum の唯一の真実源）
// #############################################################################
// 典拠: form_test/R8環境共生担当課_苦情・通報等対応一覧.json。
// 選択肢を変えたら KUJ_OPTIONS_（と必要なら KUJ_FIELDS_）を更新する。
// KUJ_OPTIONS_ は mapper の enum 防御・プレビューの選択肢母集合で共有する。

var KUJ_PROP_FORM_ID_ = "KUJ_FORM_ID";
var KUJ_PROP_ACCESS_KEY_ = "KUJ_ACCESS_KEY";
// 誤送信防止プローブ用の共有シークレット（任意）。本体 GAS の NFB_EXT_ACTION_SECRET と同値を入れると、
// 本体は本送信の前に nonce プローブで宛先を検証する。空（既定）ならプローブなしで直接送信（後方互換）。
var KUJ_PROP_EXT_ACTION_SECRET_ = "KUJ_EXT_ACTION_SECRET";
var KUJ_MAX_PDF_BYTES_ = 30 * 1024 * 1024; // 中継 PDF の上限（base64 化で UrlFetchApp/blob が扱える範囲）

function Kuj_prop_(name) {
  if (typeof PropertiesService === "undefined") return ""; // node テスト時
  try { return PropertiesService.getScriptProperties().getProperty(name) || ""; } catch (e) { return ""; }
}
function KUJ_FORM_ID_() { return Kuj_prop_(KUJ_PROP_FORM_ID_); }

// 選択肢ラベル（フォームの選択肢そのもの。自動抽出で enum 外の値を入れないための防御）。
var KUJ_OPTIONS_ = {
  keizoku: ["継続中", "完結"],
  hoho: ["電話", "メール", "ホームページ", "市政相談対応票", "来庁（市民等）", "打合せ（庁内）", "その他"],
  ku: ["中央区", "北区", "東区", "白石区", "豊平区", "南区", "西区", "厚別区", "手稲区", "清田区", "市内", "市外", "不明"],
  daibunrui: ["野生鳥獣", "生物多様性", "環境アセス", "その他"],
  taisho: ["カラス", "スズメ", "ハト", "ヒグマ", "エゾシカ", "キタキツネ", "アライグマ", "その他"],
  kogarasu: ["はい"],
  shurui: ["餌付け", "攻撃・威嚇", "糞害等衛生被害", "巣の撤去", "捕獲・駆除・追払い要望", "保護・保全要望", "食害等財産被害", "足跡・写真等確認依頼", "死骸回収", "傷病鳥獣回収", "鳥インフルエンザ関連", "許認可・鳥獣保護管理法について", "その他"],
  kaitoKani: ["PCO紹介", "見守り・放置提案", "他行政機関紹介", "許可取得案内（アライグマ箱わな自ら設置の場合等）", "その他", "アライグマ箱わな貸し出し制度紹介（実際に申し込みがある場合は申し込み票も作成のこと）", "傾聴", "現地調査・対応"],
  shokaisaki: ["土木センター（公園等管理者）", "区生活衛生担当係（木酢液配布）", "石狩振興局自然環境係", "業務課・清掃事務所紹介（ゴミ回収）", "その他"],
  tayosei: ["アズマヒキガエル", "ウチダザリガニ", "アメリカオニアザミ", "オオハンゴウソウ", "オオキンケイギク", "バイカルハナウド類似植物", "その他外来種", "生物多様性一般", "その他"],
  asesu: ["個別事業", "法・条例・制度", "アセス該当性", "その他"]
};

// フィールド仕様: 抽出候補プロパティ ↔ フォーム data キー（セグメント配列）。
//   prop    : 抽出候補のプロパティ名（ascii・一意。Kuj_textToCandidate_ が埋める）
//   kind    : "scalar"（単一）/ "multi"（複数→", "連結）/ "date"（→"YYYY-MM-DD"）
//   enumKey : KUJ_OPTIONS_ のキー（無ければ自由テキスト）
//   segs    : data キーのセグメント配列（Kuj_joinFieldPath_ に通す）
//   gate    : [{prop, needs}, ...] すべて満たすときだけ出力（子キーのゲーティング）
//   desc    : 説明（プレビュー/ドキュメント用）
var KUJ_FIELDS_ = [
  // --- 単一値（自由テキスト / enum） ---
  { prop: "ukeotsukeDate", kind: "date", segs: ["受付日"],
    desc: "受付日（市政相談対応票の受付年月日や Web 問い合わせ日）。西暦/和暦どちらでも可。" },
  { prop: "keizokuKanketsu", kind: "scalar", enumKey: "keizoku", segs: ["継続/完結"],
    desc: "対応が継続中か完結か。intake 時点では通常「継続中」（自動では入れない＝人手）" },
  { prop: "toiawaseHoho", kind: "scalar", enumKey: "hoho", segs: ["問合せ方法"],
    desc: "問い合わせの経路。市政相談対応票で届いたものは「市政相談対応票」、札幌市 CMS の Web 問い合わせは「ホームページ」" },
  { prop: "toiawaseHohoOther", kind: "scalar", segs: ["問合せ方法", "その他", "具体的に"],
    gate: [{ prop: "toiawaseHoho", needs: "その他" }],
    desc: "問合せ方法が「その他」のときの具体的な方法（手紙・FAX 等）" },
  { prop: "toiawaseMoto", kind: "scalar", segs: ["問合せ元"],
    desc: "問い合わせ元（氏名・団体名など）。匿名なら「匿名」" },
  { prop: "toiawaseMotoRenraku", kind: "scalar", segs: ["問合せ元　連絡先"],
    desc: "問い合わせ元の連絡先（メールアドレス・電話・住所など。複数あれば「, 」で連結）" },
  { prop: "genbaKu", kind: "scalar", enumKey: "ku", segs: ["現場住所等の区"],
    desc: "現場住所の区。住所から判断できなければ「不明」、札幌市外なら「市外」（自動では入れない＝人手）" },
  { prop: "genbaJusho", kind: "scalar", segs: ["現場住所等"],
    desc: "現場の住所・場所（条丁目や公園名・地名など）。不明なら「不明」（自動では入れない＝人手）" },
  { prop: "geninShisetsu", kind: "scalar", segs: ["原因施設等"],
    desc: "原因となる施設等（公園名・事業者名など）。なければ空" },
  { prop: "tantosha", kind: "scalar", segs: ["担当者"],
    desc: "市側の担当者（受付者）。なければ空" },
  { prop: "soudanShosai", kind: "scalar", segs: ["相談詳細"],
    desc: "相談・通報の本文内容（申出内容/件名+内容）。要約せず原文のまま" },
  { prop: "kaitoShosai", kind: "scalar", segs: ["回答詳細"],
    desc: "市側の回答内容。なければ空" },
  { prop: "bikou", kind: "scalar", segs: ["備考"],
    desc: "備考（受付番号など補足情報。例: 受付番号 00-12-2264）" },
  { prop: "tag", kind: "scalar", segs: ["タグ"],
    desc: "分類タグ（任意のキーワード）。なければ空" },

  // --- 相談大分類（複数値） ---
  { prop: "soudanDaibunrui", kind: "multi", enumKey: "daibunrui", segs: ["相談大分類"],
    desc: "相談の大分類（複数可・必須。自動では入れない＝相談詳細を見て人手で選択）" },
  { prop: "soudanDaibunruiOther", kind: "scalar", segs: ["相談大分類", "その他", "具体的に"],
    gate: [{ prop: "soudanDaibunrui", needs: "その他" }],
    desc: "相談大分類が「その他」のときの具体的内容" },

  // --- 野生鳥獣 ---
  { prop: "taishoSpecies", kind: "multi", enumKey: "taisho", segs: ["相談大分類", "野生鳥獣", "対象種"],
    gate: [{ prop: "soudanDaibunrui", needs: "野生鳥獣" }],
    desc: "対象となる野生鳥獣の種（複数可）" },
  { prop: "kogarasuKa", kind: "multi", enumKey: "kogarasu", segs: ["相談大分類", "野生鳥獣", "対象種", "カラス", "子ガラスか"],
    gate: [{ prop: "soudanDaibunrui", needs: "野生鳥獣" }, { prop: "taishoSpecies", needs: "カラス" }],
    desc: "対象種がカラスで、子ガラス（巣立ち雛）に関する相談なら「はい」" },
  { prop: "taishoSpeciesOther", kind: "scalar", segs: ["相談大分類", "野生鳥獣", "対象種", "その他", "具体的に"],
    gate: [{ prop: "soudanDaibunrui", needs: "野生鳥獣" }, { prop: "taishoSpecies", needs: "その他" }],
    desc: "対象種が「その他」のときの具体的な動物名（タヌキ等）" },
  { prop: "soudanShurui", kind: "multi", enumKey: "shurui", segs: ["相談大分類", "野生鳥獣", "相談種類"],
    gate: [{ prop: "soudanDaibunrui", needs: "野生鳥獣" }],
    desc: "野生鳥獣に関する相談の種類（複数可）" },
  { prop: "soudanShuruiOther", kind: "scalar", segs: ["相談大分類", "野生鳥獣", "相談種類", "その他", "具体的に"],
    gate: [{ prop: "soudanDaibunrui", needs: "野生鳥獣" }, { prop: "soudanShurui", needs: "その他" }],
    desc: "相談種類が「その他」のときの具体的内容" },
  { prop: "kaitoKani", kind: "multi", enumKey: "kaitoKani", segs: ["相談大分類", "野生鳥獣", "回答（簡易）"],
    gate: [{ prop: "soudanDaibunrui", needs: "野生鳥獣" }],
    desc: "簡易回答の種類（複数可）。intake 時点で未回答なら空" },
  { prop: "shokaisaki", kind: "multi", enumKey: "shokaisaki", segs: ["相談大分類", "野生鳥獣", "回答（簡易）", "他行政機関紹介", "紹介先"],
    gate: [{ prop: "soudanDaibunrui", needs: "野生鳥獣" }, { prop: "kaitoKani", needs: "他行政機関紹介" }],
    desc: "他行政機関紹介の紹介先（複数可）" },
  { prop: "kaitoKaniOther", kind: "scalar", segs: ["相談大分類", "野生鳥獣", "回答（簡易）", "その他", "具体的に"],
    gate: [{ prop: "soudanDaibunrui", needs: "野生鳥獣" }, { prop: "kaitoKani", needs: "その他" }],
    desc: "簡易回答が「その他」のときの具体的内容" },

  // --- 生物多様性 ---
  { prop: "seibutsuTayosei", kind: "multi", enumKey: "tayosei", segs: ["相談大分類", "生物多様性", "生物多様性詳細"],
    gate: [{ prop: "soudanDaibunrui", needs: "生物多様性" }],
    desc: "生物多様性に関する詳細（複数可）" },

  // --- 環境アセス ---
  { prop: "asesuShosai", kind: "multi", enumKey: "asesu", segs: ["相談大分類", "環境アセス", "アセス詳細"],
    gate: [{ prop: "soudanDaibunrui", needs: "環境アセス" }],
    desc: "環境アセスに関する詳細（複数可）" },
  { prop: "asesuKobetsuJigyoName", kind: "scalar", segs: ["相談大分類", "環境アセス", "アセス詳細", "個別事業", "事業名"],
    gate: [{ prop: "soudanDaibunrui", needs: "環境アセス" }, { prop: "asesuShosai", needs: "個別事業" }],
    desc: "アセス詳細が「個別事業」のときの事業名" },
  { prop: "asesuGaitoseiInfo", kind: "scalar", segs: ["相談大分類", "環境アセス", "アセス詳細", "アセス該当性", "住所、施設種別、規模等"],
    gate: [{ prop: "soudanDaibunrui", needs: "環境アセス" }, { prop: "asesuShosai", needs: "アセス該当性" }],
    desc: "アセス該当性の住所、施設種別、規模等" },
  { prop: "asesuOther", kind: "scalar", segs: ["相談大分類", "環境アセス", "アセス詳細", "その他", "具体的に"],
    gate: [{ prop: "soudanDaibunrui", needs: "環境アセス" }, { prop: "asesuShosai", needs: "その他" }],
    desc: "アセス詳細が「その他」のときの具体的内容" }
];


// #############################################################################
// ## extract.gs — PDF 抽出テキスト → 様式判定 → ラベル抽出 → 候補（純ロジック・node テスト対象）
// #############################################################################
// 入力はブラウザ pdf.js が y 座標で行復元したテキスト。GAS は PDF バイナリではなくテキストを処理する。
// 出力候補のプロパティ名は KUJ_FIELDS_ の prop に合わせる（後段 Kuj_candidateToData_ がそのまま消費）。

// Kangxi / CJK 部首コードポイント（U+2E80–U+2EFF, U+2F00–U+2FDF）を通常の漢字へ。
// 一部 PDF フォントは「長→⾧」「日→⽇」「氏→⽒」等の部首字を吐くため NFKC で復元する。
// 全角記号（！？（）等）は対象外＝原文の表記を保つ。改行は LF に統一。
function Kuj_normalizeText_(s) {
  var t = String(s == null ? "" : s).replace(/\r\n?/g, "\n");
  return t.replace(/[⺀-⻿⼀-⿟]/g, function (ch) { return ch.normalize("NFKC"); });
}

// 様式判定: "ホームページ"（札幌市 CMS Web 問い合わせ）/ "市政相談対応票"（市民の声）/ ""（不明）。
function Kuj_detectLayout_(text) {
  var t = String(text == null ? "" : text);
  if (/問い合わせ日/.test(t) || /メールアドレス/.test(t) || /print\.php/.test(t)) return "ホームページ";
  if (/市政提案/.test(t) || /市民の声/.test(t) || /受付番号/.test(t) || /申出内容/.test(t) || /\d{2}-\d{2}-\d{4}/.test(t)) return "市政相談対応票";
  return "";
}

// 空・空白を除いて連結。
function Kuj_joinNonEmpty_(arr, sep) {
  var out = [];
  for (var i = 0; i < (arr || []).length; i++) {
    var s = String(arr[i] == null ? "" : arr[i]).replace(/^\s+|\s+$/g, "");
    if (s) out.push(s);
  }
  return out.join(sep);
}

// CMS 印刷フッター行（print.php を含む URL）を落とす。
function Kuj_stripFooter_(text) {
  var lines = String(text == null ? "" : text).split("\n");
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    if (/print\.php/.test(lines[i])) continue;
    out.push(lines[i]);
  }
  return out.join("\n");
}

// 行頭ラベル走査: 各行が labels のいずれかで始まればフィールド開始、続く非ラベル行は値へ連結（"" 連結で折返しを戻す）。
// returns { ラベル: 値 }。
function Kuj_scanLabels_(text, labels) {
  var lines = String(text == null ? "" : text).split("\n");
  var result = {};
  var current = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var matched = null, rest = "";
    for (var j = 0; j < labels.length; j++) {
      var lab = labels[j];
      if (line.indexOf(lab) === 0) {
        matched = lab;
        rest = line.slice(lab.length).replace(/^[\s:：]+/, "");
        break;
      }
    }
    if (matched) {
      current = matched;
      result[current] = rest;
    } else if (current != null) {
      result[current] += line; // 折返し行は "" 連結（日本語の語中改行を戻す）
    }
  }
  for (var k in result) if (result.hasOwnProperty(k)) result[k] = result[k].replace(/^\s+|\s+$/g, "");
  return result;
}

// 様式B（ホームページ問い合わせ）→ 候補。
function Kuj_extractHomepage_(text) {
  var clean = Kuj_stripFooter_(text);
  var labels = ["問い合わせ日", "メールアドレス", "氏名", "ふりがな", "年齢", "職業", "住所", "郵便番号", "電話番号", "件名", "内容"];
  var f = Kuj_scanLabels_(clean, labels);
  return {
    toiawaseHoho: "ホームページ",
    ukeotsukeDate: f["問い合わせ日"] || "",
    toiawaseMoto: f["氏名"] || "",
    toiawaseMotoRenraku: Kuj_joinNonEmpty_([f["メールアドレス"], f["電話番号"], f["住所"]], ", "),
    soudanShosai: Kuj_joinNonEmpty_([f["件名"], f["内容"]], "\n"),
    confidence: 0.85,
    reasoning: "様式B（ホームページ問い合わせ）としてラベル抽出。相談大分類などネスト分類は相談詳細を見て人手で選択してください。",
    _layout: "ホームページ"
  };
}

// 様式A（市政相談対応票 / 市民の声）→ 候補。
function Kuj_extractShisei_(text) {
  var cand = { toiawaseHoho: "市政相談対応票", _layout: "市政相談対応票" };
  var wareki = "(?:令和|平成|昭和)\\s*(?:元|\\d+)\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日?";
  var seireki = "\\d{4}\\s*[\\/年.\\-]\\s*\\d{1,2}\\s*[\\/月.\\-]\\s*\\d{1,2}\\s*日?";
  // 受付番号（NN-NN-NNNN）と、それに隣接する受付日（行復元で同一行に並ぶ）。
  var m = text.match(new RegExp("(\\d{2}-\\d{2}-\\d{4})\\s*(" + wareki + "|" + seireki + ")"));
  if (m) {
    cand.bikou = "受付番号 " + m[1];
    cand.ukeotsukeDate = m[2].replace(/\s+/g, "");
  } else {
    var num = text.match(/(\d{2}-\d{2}-\d{4})/);
    if (num) cand.bikou = "受付番号 " + num[1];
  }
  if (/匿名/.test(text)) cand.toiawaseMoto = "匿名";
  var tel = text.match(/0\d{1,4}-\d{1,4}-\d{3,4}/);
  if (tel) cand.toiawaseMotoRenraku = tel[0];
  // 相談詳細＝【内容】（申出内容）以降。折返しを "" 連結で戻す。
  var body = "";
  var idx = text.lastIndexOf("【内容】");
  if (idx >= 0) body = text.slice(idx + "【内容】".length);
  else { var ai = text.indexOf("申出内容"); if (ai >= 0) body = text.slice(ai + "申出内容".length); }
  cand.soudanShosai = Kuj_joinNonEmpty_(body.split("\n"), "");
  cand.confidence = 0.8;
  cand.reasoning = "様式A（市政相談対応票）として抽出。相談大分類・対象種・相談種類などネスト分類は相談詳細を読んで人手で選択してください。";
  return cand;
}

// 抽出テキスト → 候補（1 PDF = 1 候補）。様式不明なら全文を相談詳細に入れて人手へ回す。
function Kuj_textToCandidate_(text) {
  var t = Kuj_normalizeText_(text);
  var layout = Kuj_detectLayout_(t);
  if (layout === "ホームページ") return Kuj_extractHomepage_(t);
  if (layout === "市政相談対応票") return Kuj_extractShisei_(t);
  return {
    soudanShosai: t.replace(/^\s+|\s+$/g, ""),
    confidence: 0.2,
    reasoning: "様式を判定できませんでした。全文を相談詳細に入れています。問合せ方法・相談大分類など全項目を人手で入力してください。",
    _layout: "不明"
  };
}


// #############################################################################
// ## csv.gs — お問い合わせフォーム CSV → 候補（様式駆動・列ヘッダ駆動・純ロジック）
// #############################################################################
// 札幌市 CMS「お問い合わせフォーム」CSV エクスポート（Shift-JIS）を取り込む。中身は様式B
// （ホームページ問い合わせ）と同じデータの表形式＝1 データ行 = 1 問い合わせ = 1 レコード。
// Shift-JIS デコードはブラウザ側（TextDecoder）が担い、ここはデコード済みテキストを処理する。
// PDF 経路と同様、列ヘッダ（様式）からの固定マッピングのみ自動化。相談大分類などネストは人手。

// RFC4180 準拠のピュア CSV パーサ（引用符・フィールド内カンマ/改行・"" エスケープ・CRLF 対応）。
// 2 次元配列（行 × セル）を返す。GAS の Utilities.parseCsv は node sandbox に無いので自前実装で一本化。
function Kuj_parseCsv_(text) {
  var s = String(text == null ? "" : text);
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); // 先頭 BOM 除去
  var rows = [];
  var row = [];
  var field = "";
  var inQuotes = false;
  var i = 0;
  var n = s.length;
  while (i < n) {
    var ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; } // "" → リテラル "
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { // CRLF / CR
      if (s[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = []; i++; continue;
    }
    if (ch === "\n") { row.push(field); field = ""; rows.push(row); row = []; i++; continue; }
    field += ch; i++;
  }
  // 末尾フィールド/行（最終行に改行が無い場合）。完全に空（フィールド 1 個かつ空）なら末尾余りは捨てる。
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ヘッダ行 → { 正規化ヘッダ名: 列インデックス }（最初の出現を採用）。BOM/前後空白除去＋部首正規化。
function Kuj_csvHeaderIndex_(headerRow) {
  var idx = {};
  var arr = headerRow || [];
  for (var i = 0; i < arr.length; i++) {
    var name = Kuj_normalizeText_(String(arr[i] == null ? "" : arr[i])).replace(/^﻿/, "").replace(/^\s+|\s+$/g, "");
    if (name && !idx.hasOwnProperty(name)) idx[name] = i;
  }
  return idx;
}

// ヘッダ名でセルを取得（trim 済み文字列。列が無ければ ""）。
function Kuj_csvCell_(row, idx, name) {
  if (!idx || !idx.hasOwnProperty(name)) return "";
  var v = row ? row[idx[name]] : "";
  return String(v == null ? "" : v).replace(/^\s+|\s+$/g, "");
}

// CSV ヘッダが「お問い合わせフォーム」様式か（問い合わせ日 ＋ 件名/内容/メールアドレスのいずれか）。
function Kuj_csvHeaderLooksHomepage_(idx) {
  if (!idx) return false;
  if (!idx.hasOwnProperty("問い合わせ日")) return false;
  return idx.hasOwnProperty("件名") || idx.hasOwnProperty("内容") || idx.hasOwnProperty("メールアドレス");
}

// 重複判定に使う列（これらが全て一致する行は同一とみなす）。
// ステータス・問い合わせ日・返信者は対象外（受付状況や受付日時が違っても内容が同じなら重複）。
var KUJ_CSV_DEDUP_COLS_ = [
  "現在の振分先", "問い合わせ件名", "メールアドレス", "氏名", "ふりがな",
  "年齢", "職業", "住所", "郵便番号", "電話番号", "件名", "内容"
];

// 重複判定キー（KUJ_CSV_DEDUP_COLS_ の各セルを trim して  連結）。区切りは本文に出にくい制御文字。
function Kuj_csvDedupKey_(idx, row) {
  var parts = [];
  for (var i = 0; i < KUJ_CSV_DEDUP_COLS_.length; i++) parts.push(Kuj_csvCell_(row, idx, KUJ_CSV_DEDUP_COLS_[i]));
  return parts.join("");
}

// CSV 1 行 → 候補（様式B＝ホームページ形）。全セル空なら null。
//   連絡先＝メール/電話/郵便番号/住所、相談詳細＝(件名||問い合わせ件名)+内容、担当者＝返信者、
//   備考＝ふりがな/年齢/職業（あるものだけラベル付き）。相談大分類などネストは人手。
//   _dedupKey は重複判定用メタ（candidateToData_ は KUJ_FIELDS_ のみ消費するので data には出ない）。
function Kuj_csvRowToCandidate_(idx, row) {
  var arr = row || [];
  var hasAny = false;
  for (var i = 0; i < arr.length; i++) {
    if (String(arr[i] == null ? "" : arr[i]).replace(/^\s+|\s+$/g, "")) { hasAny = true; break; }
  }
  if (!hasAny) return null;

  var get = function (name) { return Kuj_csvCell_(arr, idx, name); };
  var subject = get("件名") || get("問い合わせ件名");
  var bikouParts = [];
  if (get("ふりがな")) bikouParts.push("ふりがな: " + get("ふりがな"));
  if (get("年齢")) bikouParts.push("年齢: " + get("年齢"));
  if (get("職業")) bikouParts.push("職業: " + get("職業"));

  return {
    toiawaseHoho: "ホームページ",
    ukeotsukeDate: get("問い合わせ日"),
    toiawaseMoto: get("氏名"),
    toiawaseMotoRenraku: Kuj_joinNonEmpty_([get("メールアドレス"), get("電話番号"), get("郵便番号"), get("住所")], ", "),
    soudanShosai: Kuj_joinNonEmpty_([subject, get("内容")], "\n"),
    tantosha: get("返信者"),
    bikou: bikouParts.join(" / "),
    confidence: 0.85,
    reasoning: "お問い合わせフォーム CSV の 1 行を様式B（ホームページ問い合わせ）として取り込み。相談大分類などネスト分類は相談詳細を見て人手で選択してください。",
    _layout: "ホームページ（CSV）",
    _dedupKey: Kuj_csvDedupKey_(idx, arr)
  };
}

// CSV テキスト → 候補配列。1 データ行 = 1 候補。空行はスキップ。重複行（KUJ_CSV_DEDUP_COLS_ 一致）は取り込まない。
//   { candidates, warnings, total, skipped, duplicates, headerOk }。
function Kuj_csvToCandidates_(text) {
  var rows = Kuj_parseCsv_(Kuj_normalizeText_(text));
  var result = { candidates: [], warnings: [], total: 0, skipped: 0, duplicates: 0, headerOk: false };
  if (!rows.length) {
    result.warnings.push("CSV にデータがありません。");
    return result;
  }
  var idx = Kuj_csvHeaderIndex_(rows[0]);
  result.headerOk = Kuj_csvHeaderLooksHomepage_(idx);
  if (!result.headerOk) {
    result.warnings.push("CSV のヘッダが「お問い合わせフォーム」様式に一致しません（問い合わせ日/件名/内容/メールアドレス）。可能な列のみベストエフォートで取り込みます。");
  }
  var seen = {};
  for (var r = 1; r < rows.length; r++) {
    var cand = Kuj_csvRowToCandidate_(idx, rows[r]);
    if (!cand) { result.skipped++; continue; }
    var key = cand._dedupKey || "";
    if (key && seen.hasOwnProperty(key)) { result.duplicates++; continue; } // 同一内容の行は最初の 1 件だけ採用
    if (key) seen[key] = true;
    result.total++;
    result.candidates.push(cand);
  }
  if (result.duplicates) {
    result.warnings.push("重複 " + result.duplicates + " 行をスキップしました（現在の振分先〜内容が一致。ステータス/問い合わせ日/返信者は判定対象外）。");
  }
  return result;
}

// パースページから CSV テキスト 1 件ごとに呼ばれる（google.script.run）。ブラウザがファイルを読み
// Shift-JIS デコードしたテキストを受け取り、列ヘッダ駆動でマッピング → uploadRecords を返す。
// 返り形は Kuj_parseTextToRecords_ と同じ（finish() でマージ可）。
function Kuj_parseCsvToRecords_(csvText, name) {
  try {
    var parsed = Kuj_csvToCandidates_(csvText);
    var built = Kuj_buildUploadRecords_(parsed.candidates);
    for (var i = 0; i < parsed.warnings.length; i++) built.warnings.push(parsed.warnings[i]);
    if (parsed.skipped) built.warnings.push("空行 " + parsed.skipped + " 件をスキップしました。");
    built.ok = true;
    built.filename = name || "";
    return built;
  } catch (err) {
    return { ok: false, filename: name || "", error: String(err && err.message ? err.message : err) };
  }
}


// #############################################################################
// ## mapper.gs — 候補 → フォーム data キー（純ロジック・node テスト対象）
// #############################################################################

// 候補オブジェクトの prop が value を含む/等しいか（gate 判定）。
function Kuj_candHas_(cand, prop, needs) {
  var v = cand ? cand[prop] : null;
  if (Array.isArray(v)) {
    for (var i = 0; i < v.length; i++) {
      if (String(v[i] == null ? "" : v[i]).replace(/^\s+|\s+$/g, "") === needs) return true;
    }
    return false;
  }
  return String(v == null ? "" : v).replace(/^\s+|\s+$/g, "") === needs;
}

function Kuj_gatePasses_(cand, gate) {
  if (!gate || !gate.length) return true;
  for (var i = 0; i < gate.length; i++) {
    if (!Kuj_candHas_(cand, gate[i].prop, gate[i].needs)) return false;
  }
  return true;
}

// 選択ラベル配列 → trim・空除去して ", " 連結（choju の cause.join(", ") 同方式）。
function Kuj_joinChecks_(arr) {
  var out = [];
  for (var i = 0; i < (arr || []).length; i++) {
    var p = String(arr[i] == null ? "" : arr[i]).replace(/^\s+|\s+$/g, "");
    if (p) out.push(p);
  }
  return out.join(", ");
}

// data[セグメント連結キー] = value（空はスキップ）。キーは必ずコーデック経由で組む。
function Kuj_setIf_(data, segments, value) {
  if (value === "" || value === null || value === undefined) return;
  data[Kuj_joinFieldPath_(segments)] = value;
}

function Kuj_specLabel_(spec) { return (spec.segs || []).join("/"); }

// 候補 → { data:{<キー>:値}, warnings:[] }。子ゲーティング・複数値連結・enum 防御を一括処理。
function Kuj_candidateToData_(cand) {
  var c = cand || {};
  var data = {};
  var warnings = [];
  for (var i = 0; i < KUJ_FIELDS_.length; i++) {
    var spec = KUJ_FIELDS_[i];
    if (!Kuj_gatePasses_(c, spec.gate)) continue;
    var raw = c[spec.prop];

    if (spec.kind === "multi") {
      var arr = Array.isArray(raw) ? raw : (raw == null || raw === "" ? [] : [raw]);
      var opts = spec.enumKey ? KUJ_OPTIONS_[spec.enumKey] : null;
      var kept = [];
      for (var a = 0; a < arr.length; a++) {
        var label = String(arr[a] == null ? "" : arr[a]).replace(/^\s+|\s+$/g, "");
        if (!label) continue;
        if (opts && opts.indexOf(label) === -1) {
          warnings.push(Kuj_specLabel_(spec) + ": 未知の選択肢「" + label + "」を破棄しました。");
          continue;
        }
        if (kept.indexOf(label) === -1) kept.push(label);
      }
      if (kept.length) Kuj_setIf_(data, spec.segs, Kuj_joinChecks_(kept));

    } else if (spec.kind === "date") {
      var canon = Kuj_toCanonicalDate_(raw);
      if (canon) Kuj_setIf_(data, spec.segs, canon);
      else if (String(raw == null ? "" : raw).replace(/^\s+|\s+$/g, "")) {
        warnings.push(Kuj_specLabel_(spec) + ": 日付「" + raw + "」を解釈できませんでした。");
      }

    } else { // scalar
      var v = String(raw == null ? "" : raw).replace(/^\s+|\s+$/g, "");
      if (!v) continue;
      if (spec.enumKey) {
        var o = KUJ_OPTIONS_[spec.enumKey];
        if (o && o.indexOf(v) === -1) {
          warnings.push(Kuj_specLabel_(spec) + ": 未知の選択肢「" + v + "」を破棄しました。");
          continue;
        }
      }
      Kuj_setIf_(data, spec.segs, v);
    }
  }
  return { data: data, warnings: warnings };
}


// #############################################################################
// ## drive.gs — PDF の「生バイト」中継（Drive / 任意 URL → base64）。解析はしない。
// #############################################################################

// Drive の各種 URL / 素の fileId から fileId を取り出す（取れなければ ""）。
function Kuj_extractDriveId_(s) {
  var v = String(s == null ? "" : s);
  var m = v.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/) ||
          v.match(/[?&]id=([a-zA-Z0-9_-]{20,})/) ||
          v.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(v)) return v; // 素の fileId
  return "";
}

// ref（Drive の URL/ID または http(s) URL）→ { ok, base64, name } または { ok:false, error }。
// GAS は PDF を「解析」せず、バイトを base64 にして返すだけ（テキスト抽出はブラウザ pdf.js）。
function Kuj_fetchPdfBase64_(ref) {
  try {
    var s = String(ref == null ? "" : ref).replace(/^\s+|\s+$/g, "");
    if (!s) return { ok: false, error: "PDF のリンクまたは ID が空です。" };
    var blob = null;
    var fileId = Kuj_extractDriveId_(s);
    if (fileId) {
      blob = DriveApp.getFileById(fileId).getBlob();
    } else if (/^https?:\/\//.test(s)) {
      var res = UrlFetchApp.fetch(s, { muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() !== 200) {
        return { ok: false, error: "PDF の取得に失敗しました (HTTP " + res.getResponseCode() + ")。共有権限とリンクを確認してください。" };
      }
      blob = res.getBlob();
    } else {
      return { ok: false, error: "リンクの形式を認識できません。Drive の共有リンク/ファイル ID か、http(s) の PDF URL を指定してください。" };
    }
    var bytes = blob.getBytes();
    if (bytes.length > KUJ_MAX_PDF_BYTES_) {
      return { ok: false, error: "PDF が大きすぎます（約 " + Math.round(bytes.length / 1024 / 1024) + "MB）。" };
    }
    return { ok: true, base64: Utilities.base64Encode(bytes), name: blob.getName() };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}


// #############################################################################
// ## upload.gs — uploadRecords 生成 + パースUI（サーバ関数）
// #############################################################################

// ULID 風レコード ID（本体 Nfb_generateRecordId_ と互換の "r_..." 形。choju 移植）。
function Kuj_generateRecordId_() {
  var ts = (new Date()).getTime().toString(36);
  var rand = "";
  for (var i = 0; i < 10; i++) rand += "0123456789abcdefghijklmnopqrstuvwxyz".charAt(Math.floor(Math.random() * 36));
  return "r_" + ts + "_" + rand;
}

// 候補配列 → sync_records 用 uploadRecords（親単独・children 無し）+ プレビュー/警告。
//   { parentFormId, parentRecordId:"", parent:{formId, uploadRecords:[{id,data,modifiedAtUnixMs}]}, preview, warnings }
function Kuj_buildUploadRecords_(candidates) {
  var now = (new Date()).getTime();
  var formId = KUJ_FORM_ID_();
  var recs = [];
  var preview = [];
  var warnings = [];
  for (var i = 0; i < (candidates || []).length; i++) {
    var cand = candidates[i] || {};
    var conv = Kuj_candidateToData_(cand);
    for (var w = 0; w < conv.warnings.length; w++) warnings.push("[苦情" + (i + 1) + "] " + conv.warnings[w]);
    var id = Kuj_generateRecordId_();
    recs.push({ id: id, data: conv.data, modifiedAtUnixMs: now });
    preview.push({
      index: i + 1,
      id: id,
      layout: String(cand._layout == null ? "" : cand._layout),
      confidence: (typeof cand.confidence === "number" ? cand.confidence : null),
      reasoning: String(cand.reasoning == null ? "" : cand.reasoning),
      dedupKey: String(cand._dedupKey == null ? "" : cand._dedupKey), // 複数ファイル横断の重複排除に使う（CSV のみ・PDF は ""）
      data: conv.data
    });
  }
  return {
    parentFormId: formId,
    parentRecordId: "",
    parent: { formId: formId, uploadRecords: recs },
    preview: preview,
    warnings: warnings
  };
}

// パースページからテキスト 1 件ごとに呼ばれる（google.script.run）。ブラウザ pdf.js が抽出したテキストを受け取り
// 様式判定→ラベル抽出→uploadRecords を返す。PDF バイナリは扱わない（テキストのみ）。
function Kuj_parseTextToRecords_(text, name) {
  try {
    var cand = Kuj_textToCandidate_(text);
    var built = Kuj_buildUploadRecords_([cand]);
    built.ok = true;
    built.filename = name || "";
    return built;
  } catch (err) {
    return { ok: false, filename: name || "", error: String(err && err.message ? err.message : err) };
  }
}

// パースページ（HtmlService）。PDF リンク（?pdf= から prefilled・手貼り/複数可）を読み込み、
// (1) Kuj_fetchPdfBase64_ でバイト取得 → (2) ブラウザ pdf.js でテキスト抽出 → (3) Kuj_parseTextToRecords_ で変換、
// 全 PDF の uploadRecords を 1 つにマージ → プレビュー表 + JSON コピー。pdf.js は pdfjs.html を include。
function Kuj_renderParsePage_(e) {
  var prefill = (e && e.parameter && e.parameter.pdf) ? String(e.parameter.pdf) : "";
  var prefillJs = JSON.stringify(prefill).replace(/</g, "\\u003c");
  var pdfjs = HtmlService.createHtmlOutputFromFile("pdfjs").getContent(); // <script>pdf.min.js</script> + worker(script type=js-worker)
  var html =
    '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>苦情・通報の取り込み（PDF / CSV）</title>' +
    '<style>body{font-family:-apple-system,"Segoe UI",Roboto,"Noto Sans JP",sans-serif;background:#f8f9fa;margin:0;padding:24px;color:#202124;}' +
    '.card{max-width:1000px;margin:0 auto;background:#fff;border:1px solid #dadce0;border-radius:8px;padding:20px 24px;}' +
    'h1{font-size:18px;color:#1a73e8;}label{display:block;margin:12px 0 4px;font-size:13px;}' +
    'textarea#links{width:100%;height:64px;font-size:13px;}button{margin-top:14px;padding:8px 16px;font-size:14px;cursor:pointer;}' +
    '#status{margin-top:12px;font-size:13px;}#out{width:100%;height:240px;margin-top:12px;font-family:monospace;font-size:12px;}' +
    'table.pv{border-collapse:collapse;width:100%;margin-top:12px;font-size:12px;}' +
    'table.pv th,table.pv td{border:1px solid #dadce0;padding:5px 8px;text-align:left;vertical-align:top;}' +
    'table.pv th{background:#f1f3f4;}.low{color:#c5221f;font-weight:bold;}' +
    '.warn{background:#FEF7E0;border:1px solid #F9AB00;border-radius:6px;padding:8px 12px;margin:12px 0;font-size:13px;}' +
    '.warn ul{margin:6px 0 0;padding-left:20px;}.err{color:#c5221f;}</style>' +
    pdfjs +
    '</head><body><div class="card">' +
    '<h1>苦情・通報の取り込み（PDF / CSV → フォーム）</h1>' +
    '<p>PDF のリンク（Drive の共有リンク/ファイル ID、または http(s) の PDF URL。複数は改行区切り）を入れるか、' +
    'お問い合わせフォームの <b>CSV ファイル</b>（Shift-JIS）を選んで「パース」を押すと、ブラウザがテキストを抽出し、' +
    '様式（市政相談対応票 / ホームページ問い合わせ）からフォーム用レコード(JSON)へ振り分けます。' +
    'CSV は 1 データ行＝1 レコードです。相談大分類などネスト分類は自動では入りません。相談詳細を見て下のプレビューと JSON を人手で補完してください。</p>' +
    '<label>PDF リンク（複数可・改行区切り）</label>' +
    '<textarea id="links" placeholder="https://drive.google.com/file/d/<id>/view"></textarea>' +
    '<label>お問い合わせフォーム CSV（複数可・Shift-JIS / UTF-8 自動判定）</label>' +
    '<input type="file" id="csv" accept=".csv,text/csv" multiple>' +
    '<button id="go">パース</button>' +
    '<div id="status"></div><div id="preview"></div>' +
    '<label>uploadRecords(JSON)</label>' +
    '<textarea id="out" placeholder="ここに uploadRecords(JSON) が出ます（編集可）"></textarea>' +
    '<button id="copy">JSON をコピー</button>' +
    '</div><script>' +
    'var PREFILL=' + prefillJs + ';' +
    'function $(i){return document.getElementById(i);}' +
    'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}' +
    'function setStatus(s){$("status").innerHTML=s;}' +
    'if(PREFILL)$("links").value=PREFILL;' +
    // pdf.js worker をベンダリングした worker ソースから Blob URL で設定（単一ページ・外部取得なし）。
    'pdfjsLib.GlobalWorkerOptions.workerSrc=URL.createObjectURL(new Blob([$("kuj-pdf-worker").textContent],{type:"text/javascript"}));' +
    'function gasRun(fn,arg){return new Promise(function(res,rej){google.script.run.withSuccessHandler(res).withFailureHandler(rej)[fn](arg);});}' +
    'function b64ToBytes(b64){var bin=atob(b64);var a=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return a;}' +
    // ブラウザ側の行復元（genfix と同等: |Δy|<=2 を同一行, 行内 x 昇順, 連結 "", ページ "\\n"）。
    'function reconstruct(items){var lines=[];for(var k=0;k<items.length;k++){var it=items[k];if(!it.str)continue;' +
    'var x=it.transform[4],y=it.transform[5],line=null;for(var m=0;m<lines.length;m++){if(Math.abs(lines[m].y-y)<=2){line=lines[m];break;}}' +
    'if(!line){line={y:y,parts:[]};lines.push(line);}line.parts.push({x:x,str:it.str});}' +
    'lines.sort(function(a,b){return b.y-a.y;});' +
    'return lines.map(function(l){l.parts.sort(function(a,b){return a.x-b.x;});return l.parts.map(function(p){return p.str;}).join("");}).join("\\n");}' +
    'async function extractText(bytes){var doc=await pdfjsLib.getDocument({data:bytes}).promise;var pages=[];' +
    'for(var p=1;p<=doc.numPages;p++){var tc=await (await doc.getPage(p)).getTextContent();pages.push(reconstruct(tc.items));}return pages.join("\\n");}' +
    'async function parseOne(link){var fetched=await gasRun("Kuj_fetchPdfBase64_",link);' +
    'if(!fetched||!fetched.ok)return {ok:false,filename:link,error:(fetched&&fetched.error)||"取得失敗"};' +
    'var text;try{text=await extractText(b64ToBytes(fetched.base64));}catch(e){return {ok:false,filename:fetched.name||link,error:"pdf.js 抽出失敗: "+((e&&e.message)||e)};}' +
    'if(!text||!text.replace(/\\s/g,""))return {ok:false,filename:fetched.name||link,error:"テキストを抽出できません（スキャン画像 PDF の可能性）。"};' +
    'var built=await gasRun("Kuj_parseTextToRecords_",text);if(built&&!built.filename)built.filename=fetched.name||link;return built;}' +
    // CSV: ローカルファイルをバイト読み → 文字コード自動判定 → GAS が列ヘッダ駆動でマッピング。
    // 判定: ①UTF-8 BOM なら UTF-8。②fatal:true の UTF-8 デコードが成功すれば UTF-8（妥当な UTF-8 列）。
    //       ③失敗すれば Shift-JIS（shift_jis は不正バイトでも例外を投げず文字化けするので、UTF-8 妥当性で先に判定する）。
    'function decodeCsv(buf){var u=new Uint8Array(buf);if(u.length>=3&&u[0]===0xEF&&u[1]===0xBB&&u[2]===0xBF)return new TextDecoder("utf-8").decode(buf);' +
    'try{return new TextDecoder("utf-8",{fatal:true}).decode(buf);}catch(e){return new TextDecoder("shift_jis").decode(buf);}}' +
    'async function parseCsvOne(file){var buf;try{buf=await file.arrayBuffer();}catch(e){return {ok:false,filename:file.name,error:"ファイル読込失敗: "+((e&&e.message)||e)};}' +
    'var text=decodeCsv(buf);if(!text||!text.replace(/\\s/g,""))return {ok:false,filename:file.name,error:"CSV が空です。"};' +
    'var built=await gasRun("Kuj_parseCsvToRecords_",text);if(built&&!built.filename)built.filename=file.name;return built;}' +
    '$("go").onclick=async function(){var raw=$("links").value.split(/[\\r\\n]+/);var links=[];for(var i=0;i<raw.length;i++){var s=raw[i].replace(/^\\s+|\\s+$/g,"");if(s)links.push(s);}' +
    'var files=($("csv").files)?Array.prototype.slice.call($("csv").files):[];' +
    'if(!links.length&&!files.length){setStatus("PDF リンクか CSV ファイルを指定してください");return;}$("go").disabled=true;$("preview").innerHTML="";$("out").value="";' +
    'var total=links.length+files.length,done=0,results=[];' +
    'for(var i=0;i<links.length;i++){done++;setStatus("処理中... ("+done+"/"+total+")");' +
    'try{results.push(await parseOne(links[i]));}catch(e){results.push({ok:false,filename:links[i],error:(e&&e.message)||String(e)});}}' +
    'for(var c=0;c<files.length;c++){done++;setStatus("処理中... ("+done+"/"+total+")");' +
    'try{results.push(await parseCsvOne(files[c]));}catch(e){results.push({ok:false,filename:files[c].name,error:(e&&e.message)||String(e)});}}' +
    'finish(results);$("go").disabled=false;};' +
    // finish: 全入力(PDF/CSV)の uploadRecords をマージ。CSV は dedupKey でファイル横断の重複も排除（PDF は dedupKey="" で対象外）。
    'function finish(results){var records=[],formId="",previews=[],warns=[],okCount=0,seen={},dupCount=0;' +
    'for(var i=0;i<results.length;i++){var res=results[i];' +
    'if(res&&res.ok){okCount++;if(res.parent&&res.parent.formId)formId=res.parent.formId;' +
    'var ur=(res.parent&&res.parent.uploadRecords)||[];var pv=res.preview||[];' +
    'for(var j=0;j<ur.length;j++){var dk=(pv[j]&&pv[j].dedupKey)||"";' +
    'if(dk&&seen[dk]){dupCount++;continue;}if(dk)seen[dk]=true;' +
    'records.push(ur[j]);if(pv[j]){pv[j].file=res.filename;previews.push(pv[j]);}}' +
    'if(res.warnings)for(var w=0;w<res.warnings.length;w++)warns.push(esc(res.filename)+": "+esc(res.warnings[w]));}' +
    'else{warns.push(esc((res&&res.filename)||"?")+": "+esc((res&&res.error)||"失敗"));}}' +
    'if(dupCount)warns.push("ファイル横断の重複 "+dupCount+" 件をスキップしました（現在の振分先〜内容が一致）。");' +
    'var payload={parentFormId:formId,parentRecordId:"",parent:{formId:formId,uploadRecords:records}};' +
    '$("out").value=JSON.stringify(payload,null,2);renderPreview(previews,warns,okCount,records.length);}' +
    'function renderPreview(previews,warns,okCount,recCount){var h="<p>パース完了: 入力 "+okCount+" 件 / レコード "+recCount+" 件</p>";' +
    'if(previews.length){h+="<table class=\\"pv\\"><thead><tr><th>#</th><th>ファイル</th><th>様式</th><th>問合せ方法</th><th>受付日</th><th>相談詳細(冒頭)</th></tr></thead><tbody>";' +
    'for(var i=0;i<previews.length;i++){var p=previews[i],d=p.data||{};' +
    'var lay=p.layout||"";var layCls=(lay&&lay!=="不明")?"":"low";' +
    'var sd=String(d["相談詳細"]||"");if(sd.length>60)sd=sd.slice(0,60)+"…";' +
    'h+="<tr><td>"+(i+1)+"</td><td>"+esc(p.file)+"</td><td class=\\""+layCls+"\\">"+esc(lay||"(不明)")+"</td><td>"+esc(d["問合せ方法"]||"")+"</td><td>"+esc(d["受付日"]||"")+"</td><td>"+esc(sd)+"</td></tr>";}' +
    'h+="</tbody></table><p class=\\"err\\">※ 相談大分類・対象種・相談種類・区などは自動では入りません。JSON を直接編集して補完してください。</p>";}' +
    'if(warns.length){h+="<div class=\\"warn\\"><strong>警告 "+warns.length+" 件</strong><ul>";for(var k=0;k<warns.length;k++)h+="<li>"+warns[k]+"</li>";h+="</ul></div>";}' +
    '$("preview").innerHTML=h;setStatus("完了");}' +
    '$("copy").onclick=function(){$("out").select();document.execCommand("copy");setStatus("コピーしました");};' +
    '</script></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle("苦情・通報の取り込み（PDF / CSV）").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// #############################################################################
// ## date.gs — 受付日の canonical 化（"YYYY-MM-DD"・西暦/和暦両対応）
// #############################################################################

// 全角数字 → 半角。
function Kuj_toHankaku_(s) {
  return String(s == null ? "" : s).replace(/[０-９]/g, function (ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30);
  });
}

function Kuj_pad2_(n) { return (n < 10 ? "0" + n : "" + n); }
function Kuj_dateParts_(y, mo, d) {
  if (!isFinite(y) || !isFinite(mo) || !isFinite(d)) return "";
  return y + "-" + Kuj_pad2_(mo) + "-" + Kuj_pad2_(d);
}

// 西暦/和暦の文字列 → "YYYY-MM-DD"。解釈不能なら ""（呼び出し側で warning）。
function Kuj_toCanonicalDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Kuj_dateToCanonical_(value);
  var s = Kuj_toHankaku_(String(value == null ? "" : value)).replace(/^\s+|\s+$/g, "");
  if (!s) return "";
  // 和暦（令和/平成/昭和。元年対応）
  var wm = s.match(/^(令和|平成|昭和)\s*(元|\d+)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (wm) {
    var ey = wm[2] === "元" ? 1 : Number(wm[2]);
    var base = wm[1] === "令和" ? 2018 : (wm[1] === "平成" ? 1988 : 1925);
    return Kuj_dateParts_(base + ey, Number(wm[3]), Number(wm[4]));
  }
  // 西暦（区切り: - / 年月日 .）
  var m = s.match(/^(\d{4})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/);
  if (m) return Kuj_dateParts_(Number(m[1]), Number(m[2]), Number(m[3]));
  return "";
}

// Date → "YYYY-MM-DD"。Date 以外は素通し（choju 移植）。
function Kuj_dateToCanonical_(value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) return String(value == null ? "" : value);
  return Kuj_dateParts_(value.getFullYear(), value.getMonth() + 1, value.getDate());
}


// #############################################################################
// ## setup.gs — 一次セットアップ（GAS エディタから手動実行）
// #############################################################################

// Script Property を登録する。外部 AI/API は使わないので API キー/モデルは不要。
//   formId       : このフォームの formId（任意。出力 JSON の整合用。Playground でフォームを選ぶため必須ではない）
//   accessKey    : パースページの ?k= アクセスキー（任意。空なら無効）
//   extActionSecret: 誤送信防止プローブの共有シークレット（任意。本体 NFB_EXT_ACTION_SECRET と同値。
//                    引数を渡したときだけ更新する＝省略時は既存値を据え置く）。
function Kuj_registerSettings(formId, accessKey, extActionSecret) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(KUJ_PROP_FORM_ID_, String(formId || ""));
  props.setProperty(KUJ_PROP_ACCESS_KEY_, String(accessKey || ""));
  if (typeof extActionSecret !== "undefined") {
    props.setProperty(KUJ_PROP_EXT_ACTION_SECRET_, String(extActionSecret || ""));
  }
  Logger.log("登録: formId=%s accessKey=%s secret=%s",
    String(formId || "(なし)"), accessKey ? "(あり)" : "(なし)",
    Kuj_prop_(KUJ_PROP_EXT_ACTION_SECRET_) ? "(あり)" : "(なし)");
}

// セットアップ状態をログ出力。
function Kuj_checkSetup() {
  Logger.log("フォーム ID: %s", KUJ_FORM_ID_() || "(未設定)");
  Logger.log("アクセスキー: %s", Kuj_prop_(KUJ_PROP_ACCESS_KEY_) ? "設定済み" : "(なし)");
  Logger.log("誤送信防止シークレット: %s", Kuj_prop_(KUJ_PROP_EXT_ACTION_SECRET_) ? "設定済み" : "(なし)");
  return {
    formId: KUJ_FORM_ID_(),
    hasAccessKey: !!Kuj_prop_(KUJ_PROP_ACCESS_KEY_),
    hasExtActionSecret: !!Kuj_prop_(KUJ_PROP_EXT_ACTION_SECRET_)
  };
}


// #############################################################################
// ## Test.gs — デプロイ不要テスト（GAS エディタで testMapping を実行しログ確認）
// #############################################################################
// 純ロジック（様式判定・ラベル抽出・候補→data・日付・uploadRecords 形）のみ検証。Drive/HtmlService 不使用。
// 同等の検証を node でも: node scripts/test_mapping.mjs（fixture テキストを Kuj_textToCandidate_ に流す）。

function testMapping() {
  var errs = [];
  function exp(l, a, e) { if (String(a) !== String(e)) errs.push(l + ": got=" + a + " want=" + e); }
  function truthy(l, v) { if (!v) errs.push(l + ": falsy"); }
  function falsy(l, v) { if (v) errs.push(l + ": truthy（出力されてはいけない）"); }

  // 1. エスケープ
  var d1 = Kuj_candidateToData_({ keizokuKanketsu: "継続中" }).data;
  exp("escape 継続/完結", d1["継続\\/完結"], "継続中");

  // 2. 複数値連結
  var d2 = Kuj_candidateToData_({ soudanDaibunrui: ["野生鳥獣", "生物多様性"] }).data;
  exp("multi join", d2["相談大分類"], "野生鳥獣, 生物多様性");

  // 3. ゲーティング ON / 4. OFF
  var d3 = Kuj_candidateToData_({ soudanDaibunrui: ["野生鳥獣"], taishoSpecies: ["カラス", "ハト"] }).data;
  exp("gate ON 対象種", d3["相談大分類/野生鳥獣/対象種"], "カラス, ハト");
  var d4 = Kuj_candidateToData_({ soudanDaibunrui: ["生物多様性"], taishoSpecies: ["カラス"] }).data;
  falsy("gate OFF 対象種", d4.hasOwnProperty("相談大分類/野生鳥獣/対象種"));

  // 5. 日付
  exp("date 和暦", Kuj_toCanonicalDate_("令和8年6月23日"), "2026-06-23");
  exp("date 西暦", Kuj_toCanonicalDate_("2026/06/23"), "2026-06-23");

  // 6. enum 防御
  var conv6 = Kuj_candidateToData_({ soudanDaibunrui: ["宇宙"] });
  falsy("enum 防御 破棄", conv6.data.hasOwnProperty("相談大分類"));
  truthy("enum 防御 warning", conv6.warnings.length > 0);

  // 7. 様式判定（最小サンプル）
  exp("detect ホームページ", Kuj_detectLayout_("問い合わせ日:2026/06/26\nメールアドレス a@b.c"), "ホームページ");
  exp("detect 市政相談対応票", Kuj_detectLayout_("市政提案\n00-12-2264令和8年6月23日\n【内容】テスト"), "市政相談対応票");

  // 8. 様式A 抽出（受付番号隣接の受付日・匿名・相談詳細）
  var a = Kuj_textToCandidate_("市政提案\n00-12-2264令和8年6月23日\n匿名\n【内容】\nカラスが威嚇する\n対策して");
  exp("様式A 方法", a.toiawaseHoho, "市政相談対応票");
  exp("様式A 受付日(raw)", a.ukeotsukeDate, "令和8年6月23日");
  exp("様式A 問合せ元", a.toiawaseMoto, "匿名");
  exp("様式A 備考", a.bikou, "受付番号 00-12-2264");
  exp("様式A 相談詳細", a.soudanShosai, "カラスが威嚇する対策して");

  // 9. 様式B 抽出（ラベル走査・連絡先連結・件名+内容）
  var b = Kuj_textToCandidate_("問い合わせ日:2026/06/26 08:44\nメールアドレス a@b.c\n氏名 山田\n電話番号\n住所 札幌市\n件名 件名X\n内容 本文Y");
  exp("様式B 方法", b.toiawaseHoho, "ホームページ");
  exp("様式B 受付日(raw)", b.ukeotsukeDate, "2026/06/26 08:44");
  exp("様式B 問合せ元", b.toiawaseMoto, "山田");
  exp("様式B 連絡先", b.toiawaseMotoRenraku, "a@b.c, 札幌市");
  exp("様式B 相談詳細", b.soudanShosai, "件名X\n本文Y");

  // 10. 様式A→data（受付日が canonical 化される）
  var up = Kuj_buildUploadRecords_([a]);
  exp("uploadRecords 件数", up.parent.uploadRecords.length, 1);
  truthy("record id r_", /^r_/.test(up.parent.uploadRecords[0].id));
  exp("受付日 canonical", up.parent.uploadRecords[0].data["受付日"], "2026-06-23");
  exp("問合せ方法 data", up.parent.uploadRecords[0].data["問合せ方法"], "市政相談対応票");

  // 11. CSV パース（引用符内カンマ・改行）と行→候補（お問い合わせフォーム様式）
  var csv = "ステータス,問い合わせ日,返信者,現在の振分先,問い合わせ件名,メールアドレス,氏名,ふりがな,年齢,職業,住所,郵便番号,電話番号,件名,内容\n"
    + "未返信,2026/6/27 12:46,,環境共生,カラス被害,a@b.c,山田太郎,やまだ,40代,会社員,\"札幌市中央区北1\",060-0001,011-222-3333,カラス被害,\"威嚇されます,\n子ガラスもいます\"\n"
    + ",,,,,,,,,,,,,,\n";
  var csvRows = Kuj_parseCsv_(csv);
  exp("CSV 行数(ヘッダ+データ+空)", csvRows.length, 3);
  exp("CSV 引用符内カンマ・改行", csvRows[1][14], "威嚇されます,\n子ガラスもいます");
  var parsed = Kuj_csvToCandidates_(csv);
  truthy("CSV ヘッダ判定 OK", parsed.headerOk);
  exp("CSV 候補数(空行スキップ)", parsed.candidates.length, 1);
  exp("CSV skip 件数", parsed.skipped, 1);
  var cc = parsed.candidates[0];
  exp("CSV 方法", cc.toiawaseHoho, "ホームページ");
  exp("CSV 問合せ元", cc.toiawaseMoto, "山田太郎");
  exp("CSV 連絡先順", cc.toiawaseMotoRenraku, "a@b.c, 011-222-3333, 060-0001, 札幌市中央区北1");
  truthy("CSV 備考にふりがな/年齢/職業", /ふりがな: やまだ/.test(cc.bikou) && /年齢: 40代/.test(cc.bikou) && /職業: 会社員/.test(cc.bikou));
  var upc = Kuj_parseCsvToRecords_(csv, "toiawase.csv");
  truthy("CSV parseCsvToRecords ok", upc.ok === true);
  exp("CSV records 件数", upc.parent.uploadRecords.length, 1);
  exp("CSV 受付日 canonical", upc.parent.uploadRecords[0].data["受付日"], "2026-06-27");
  exp("CSV 問合せ方法 data", upc.parent.uploadRecords[0].data["問合せ方法"], "ホームページ");
  falsy("CSV 相談大分類は自動で入らない", upc.parent.uploadRecords[0].data.hasOwnProperty("相談大分類"));

  // 12. 重複取り込み防止（現在の振分先〜内容が一致なら、ステータス/問い合わせ日/返信者が違っても同一）
  var dupCsv = "ステータス,問い合わせ日,返信者,現在の振分先,問い合わせ件名,メールアドレス,氏名,ふりがな,年齢,職業,住所,郵便番号,電話番号,件名,内容\n"
    + "未返信,2026/6/27 12:46,,環境共生,カラス,a@b.c,山田,やまだ,40代,会社員,中央区,060-0001,011-0,カラス,威嚇された\n"
    + "返信済,2026/6/28 9:00,担当A,環境共生,カラス,a@b.c,山田,やまだ,40代,会社員,中央区,060-0001,011-0,カラス,威嚇された\n"
    + "未返信,2026/6/29 0:00,,環境共生,ハト,a@b.c,山田,やまだ,40代,会社員,中央区,060-0001,011-0,ハト,糞害\n";
  var dup = Kuj_csvToCandidates_(dupCsv);
  exp("CSV 重複除外後の候補数", dup.candidates.length, 2);
  exp("CSV 重複検出数", dup.duplicates, 1);
  truthy("CSV 重複 warning", dup.warnings.length > 0);

  Logger.log(errs.length === 0 ? "[PASS] testMapping 全項目 PASS" : "[FAIL] testMapping — " + errs.join(" / "));
  return errs.length === 0;
}


// #############################################################################
// ## node エクスポート（GAS では module 未定義なので無視される）
// #############################################################################
if (typeof module === "object" && module.exports) {
  module.exports = {
    Kuj_textToCandidate_: Kuj_textToCandidate_,
    Kuj_detectLayout_: Kuj_detectLayout_,
    Kuj_normalizeText_: Kuj_normalizeText_,
    Kuj_scanLabels_: Kuj_scanLabels_,
    Kuj_parseTextToRecords_: Kuj_parseTextToRecords_,
    Kuj_parseCsv_: Kuj_parseCsv_,
    Kuj_csvHeaderIndex_: Kuj_csvHeaderIndex_,
    Kuj_csvCell_: Kuj_csvCell_,
    Kuj_csvRowToCandidate_: Kuj_csvRowToCandidate_,
    Kuj_csvToCandidates_: Kuj_csvToCandidates_,
    Kuj_parseCsvToRecords_: Kuj_parseCsvToRecords_,
    Kuj_candidateToData_: Kuj_candidateToData_,
    Kuj_buildUploadRecords_: Kuj_buildUploadRecords_,
    Kuj_toCanonicalDate_: Kuj_toCanonicalDate_,
    Kuj_joinFieldPath_: Kuj_joinFieldPath_,
    Kuj_escapeSegment_: Kuj_escapeSegment_,
    Kuj_extractDriveId_: Kuj_extractDriveId_,
    Kuj_generateRecordId_: Kuj_generateRecordId_,
    Kuj_candHas_: Kuj_candHas_,
    Kuj_hmacHex_: Kuj_hmacHex_,
    Kuj_buildProbeResponse_: Kuj_buildProbeResponse_,
    KUJ_OPTIONS_: KUJ_OPTIONS_,
    KUJ_FIELDS_: KUJ_FIELDS_
  };
}

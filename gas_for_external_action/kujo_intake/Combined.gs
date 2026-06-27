// #############################################################################
// ## Code.gs
// #############################################################################

// =============================================================================
// 苦情・通報の「お問い合わせフォーム CSV」を取り込み、フォームの Data シートへ直接書き込む外部アクション
//
//   フォーム「R8環境共生担当課_苦情・通報等対応一覧」用のスタンドアロン GAS Web アプリ。
//   本体アプリ（gas/）には一切手を入れない（choju_yoshiki の兄弟）。
//
// 流れ（choju_yoshiki と同方式の直接書き込み）:
//   (1) 検索一覧の外部アクションボタン → 本体 GAS がサーバ間リレーで doPost を叩く。
//       doPost は親フォームの保存先（storage.spreadsheetId/sheetName）を ctx トークンに退避し、
//       取り込み画面の URL（?page=import&ctx=<token>）を openUrl で返す。本体がそれを新タブで開く。
//   (2) doGet(?page=import&ctx=...) → Index.html を配信。画面上部に書き込み先スプレッドシート URL を表示。
//   (3) [取り込み内容を確認] → ブラウザが CSV を読み（Shift-JIS/UTF-8 自動判定）デコード済みテキストを
//       Kuj_previewCsv に渡す → GAS が列ヘッダ駆動でパース＋重複除外（時間込み）＋先頭 30 行 →
//       読みやすいプレビュー表＋行ごとチェックボックス（既定 ON）。
//   (4) [選択分をスプレッドシートへ取り込む] → Kuj_commitImport(csvTexts, 選択index, ctx) が
//       同条件で再パース（ブラウザ送信値は信用しない）→ 選択分だけ Data シート（12 行目以降）へ append。
//       結果に「シートを開く」リンクを返す。
//
// 分類は AI なし＝CSV 列ヘッダ（様式）駆動の固定マッピングのみ自動化。相談大分類などネストの深い
// 意味分類は自動では入らない（書き込み後にシート/本体側で人手補完）。
// 規約: 接頭辞 Kuj_ / 定数 KUJ_ / 内部ヘルパ末尾 _ / var + function（本体 gas/ に合わせる）。
// =============================================================================

// フォームの外部アクション（検索一覧の「末端問い合わせ csv 取り込み」ボタン）から、本体 GAS の
// サーバ間リレーで叩かれる。本体フロント（interpretExternalActionResponse / SearchSidebar.buttons）が
// この JSON を解釈し、openUrl を新しいタブで開く＝ボタン押下で CSV 取り込み画面が開く導線（choju と同方式）。
//   - nfbProbe=1: 本体にシークレット（KUJ_EXT_ACTION_SECRET = 本体 NFB_EXT_ACTION_SECRET）が
//     設定されているとき、本送信の前に誤送信防止プローブが来る。共有シークレットで HMAC(nonce) に
//     署名して返すと、本体が正規受信アプリと認める。シークレット未設定なら本体はプローブを送らない。
//   - それ以外: 親フォームの保存先（payload.data.storage）を自己完結トークン（ctx）に載せ、取り込み画面
//     （?page=import&ctx=）の URL を openUrl で返す。トークン自体に spreadsheetId/sheetName を埋め込むので
//     CacheService に依存せず（TTL 切れ/エビクションで「未解決」になる事故を防ぐ）、ボタン押下で押し出された
//     保存先がそのままトークンとして引き渡る。書き込み先はこのトークンからのみ解決する（管理者リレー一本化）。
function doPost(e) {
  try {
    var params = (e && e.parameter) || {};
    if (String(params.nfbProbe || "") === "1") {
      return Kuj_json_(Kuj_buildProbeResponse_(params.nonce));
    }
    var payload = parsePayload_(e);
    var data = payload.ok ? payload.data : {};
    var ctxToken = Kuj_encodeCtx_(Kuj_extractRelayContext_(data));
    var openUrl = Kuj_buildImportUrl_(ctxToken);
    return Kuj_json_({
      ok: true,
      nfbExternalAction: true,
      title: "苦情・通報の取り込み",
      message: openUrl
        ? "取り込み画面を新しいタブで開きます。お問い合わせフォームの CSV ファイルを選んでください。"
        : "取り込み画面の URL を取得できませんでした。?page=import を直接開いてください。",
      openUrl: openUrl
    });
  } catch (err) {
    return Kuj_json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// 外部アクションリレーの payload（?payload=<JSON>）をパースする（choju parsePayload_ 移植）。
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

// JSON 応答（プローブ署名・openUrl いずれも JSON で返す）。
function Kuj_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj || { ok: false })).setMimeType(ContentService.MimeType.JSON);
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
  if (page === "import" || page === "parse") { // parse は旧 URL 互換
    var keyErr = Kuj_checkAccessKey_(e);
    if (keyErr) return renderHtml_("アクセスエラー", "<p>" + escapeHtml_(keyErr) + "</p>", true);
    return Kuj_renderImportPage_(e);
  }
  var formId = KUJ_FORM_ID_();
  var body = ""
    + "<p>お問い合わせフォームの CSV を取り込み、フォームの Data シートへ直接書き込むスタンドアロン連携です。"
    + "CSV のデコードはブラウザ（TextDecoder）で行うため、外部 AI / API は使いません。</p>"
    + "<ul>"
    + "<li><a href=\"?page=import\">取り込み画面</a> を開く。</li>"
    + "<li>[取り込み内容を確認] → 列ヘッダ駆動でパース・重複除外（時間込み）・先頭 30 行をプレビュー。</li>"
    + "<li>[選択分をスプレッドシートへ取り込む] → チェックした行だけ Data シートへ追加します。</li>"
    + "</ul>"
    + "<table class=\"kv\"><tbody>"
    + "<tr><th>フォーム ID</th><td>" + (formId ? escapeHtml_(formId) : "(未設定・任意)") + "</td></tr>"
    + "<tr><th>書き込み先</th><td>検索画面の『管理者のみ』外部アクションボタンのリレーで自動取得</td></tr>"
    + "<tr><th>取り込み方式</th><td>CSV 列ヘッダ駆動 → Data シートへ直接書き込み（外部 API 不使用）</td></tr>"
    + "</tbody></table>";
  return renderHtml_("苦情・通報の取り込み（CSV）", body, false);
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
var KUJ_MAX_ROWS_ = 30; // 1 回の取り込みで扱う最大行数（重複・空行除外後）

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
//   prop    : 抽出候補のプロパティ名（ascii・一意。Kuj_csvRowToCandidate_ が埋める）
//   kind    : "scalar"（単一・素の値）/ "check"（単一選択→`親/選択肢`列へ"●"）/ "multi"（複数→", "連結）/ "date"（→"YYYY-MM-DD"）
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
  { prop: "toiawaseHoho", kind: "check", enumKey: "hoho", segs: ["問合せ方法"],
    desc: "問い合わせの経路（単一選択＝`問合せ方法/選択肢` 列へ「●」）。札幌市 CMS の Web 問い合わせは「ホームページ」" },
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
// ## text.gs — CSV 共通テキストヘルパ（正規化・連結）
// #############################################################################

// Kangxi / CJK 部首コードポイント（U+2E80–U+2EFF, U+2F00–U+2FDF）を通常の漢字へ。
// 一部フォント由来で「長→⾧」「氏→⽒」等の部首字が混ざるため NFKC で復元する。
// 全角記号（！？（）等）は対象外＝原文の表記を保つ。改行は LF に統一。
function Kuj_normalizeText_(s) {
  var t = String(s == null ? "" : s).replace(/\r\n?/g, "\n");
  return t.replace(/[⺀-⻿⼀-⿟]/g, function (ch) { return ch.normalize("NFKC"); });
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
// 「問い合わせ日」（日時）を含めるので、内容が同じでも日時が違えば別レコード扱い。
// ＝同一内容かつ同一日時の行（同じ CSV を二度取り込んだ等）だけ重複として除外する。
// ステータス・返信者は対象外（受付状況・返信者が違っても、内容と日時が同じなら重複）。
var KUJ_CSV_DEDUP_COLS_ = [
  "問い合わせ日", "現在の振分先", "問い合わせ件名", "メールアドレス", "氏名", "ふりがな",
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

// rows[0]=ヘッダの 1 CSV ぶんの行列から候補を集める共通ループ。seen は呼び出し側で共有する
// （単一 CSV は局所 {}、バッチはファイル横断で共有して重複除外する）。out に候補を push し、
// ctr.skipped / ctr.duplicates を加算する。戻り値: このCSVのヘッダが「お問い合わせフォーム」様式か。
function Kuj_collectCandidatesFromRows_(rows, seen, ctr, out) {
  var idx = Kuj_csvHeaderIndex_(rows[0]);
  var headerOk = Kuj_csvHeaderLooksHomepage_(idx);
  for (var r = 1; r < rows.length; r++) {
    var cand = Kuj_csvRowToCandidate_(idx, rows[r]);
    if (!cand) { ctr.skipped++; continue; }
    var key = cand._dedupKey || "";
    if (key && seen.hasOwnProperty(key)) { ctr.duplicates++; continue; } // 同一内容（＋同一日時）の行は最初の 1 件だけ採用
    if (key) seen[key] = true;
    out.push(cand);
  }
  return headerOk;
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
  result.headerOk = Kuj_collectCandidatesFromRows_(rows, {}, result, result.candidates);
  result.total = result.candidates.length;
  if (!result.headerOk) {
    result.warnings.push("CSV のヘッダが「お問い合わせフォーム」様式に一致しません（問い合わせ日/件名/内容/メールアドレス）。可能な列のみベストエフォートで取り込みます。");
  }
  if (result.duplicates) {
    result.warnings.push("重複 " + result.duplicates + " 行をスキップしました（問い合わせ日〜内容が一致。ステータス/返信者は判定対象外）。");
  }
  return result;
}

// 複数 CSV テキスト → 候補配列（バッチ）。ファイル横断で重複除外（問い合わせ日〜内容が一致）し、
// 空行・重複を除いた後に先頭 KUJ_MAX_ROWS_ 行へ制限する。プレビュー/コミットの共通入口（決定的＝同順）。
//   { candidates, warnings, duplicates, skipped, overflow, headerOk }。
function Kuj_parseCsvBatch_(csvTexts) {
  var texts = (Object.prototype.toString.call(csvTexts) === "[object Array]") ? csvTexts : (csvTexts == null ? [] : [csvTexts]);
  var candidates = [];
  var warnings = [];
  var seen = {};
  var ctr = { skipped: 0, duplicates: 0 };
  var overflow = 0, headerOkAny = false, headerBad = 0;
  for (var t = 0; t < texts.length; t++) {
    var rows = Kuj_parseCsv_(Kuj_normalizeText_(String(texts[t] == null ? "" : texts[t])));
    if (!rows.length) continue;
    if (Kuj_collectCandidatesFromRows_(rows, seen, ctr, candidates)) headerOkAny = true; else headerBad++;
  }
  var duplicates = ctr.duplicates, skipped = ctr.skipped;
  if (headerBad) warnings.push("CSV のヘッダが「お問い合わせフォーム」様式に一致しない行があります（問い合わせ日/件名/内容/メールアドレス）。可能な列のみベストエフォートで取り込みます。");
  if (duplicates) warnings.push("重複 " + duplicates + " 行をスキップしました（問い合わせ日〜内容が一致。ステータス/返信者は判定対象外）。");
  if (skipped) warnings.push("空行 " + skipped + " 件をスキップしました。");
  if (candidates.length > KUJ_MAX_ROWS_) {
    overflow = candidates.length - KUJ_MAX_ROWS_;
    candidates = candidates.slice(0, KUJ_MAX_ROWS_);
    warnings.push(KUJ_MAX_ROWS_ + " 行を超えたため先頭 " + KUJ_MAX_ROWS_ + " 行のみ対象にしました（残り " + overflow + " 行は別 CSV に分けて取り込んでください）。");
  }
  return { candidates: candidates, warnings: warnings, duplicates: duplicates, skipped: skipped, overflow: overflow, headerOk: headerOkAny };
}

// 単一 CSV テキスト → uploadRecords（テスト/後方互換用。バッチ横断 dedup・30 行制限は Kuj_parseCsvBatch_ 側）。
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

    } else if (spec.kind === "check") {
      // 単一選択（radio/select）: 元データ方式で `親/選択肢` 列へマーカー "●" を立てる
      // （collect.js の radio/select と同じ表現）。素の `親` 列は存在しないため値直書きは捨てられる。
      var cv = String(raw == null ? "" : raw).replace(/^\s+|\s+$/g, "");
      if (!cv) continue;
      if (spec.enumKey) {
        var co = KUJ_OPTIONS_[spec.enumKey];
        if (co && co.indexOf(cv) === -1) {
          warnings.push(Kuj_specLabel_(spec) + ": 未知の選択肢「" + cv + "」を破棄しました。");
          continue;
        }
      }
      Kuj_setIf_(data, spec.segs.concat(cv), "●");

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
// ## upload.gs — 候補 → uploadRecords（直接書き込みは write 節）
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

// 取り込み画面（HtmlService）。Index.html を配信し、ctx トークンと上限行数をテンプレートへ渡す。
function Kuj_renderImportPage_(e) {
  var ctxToken = (e && e.parameter && (e.parameter.ctx || "")) || "";
  var tpl = HtmlService.createTemplateFromFile("Index");
  tpl.ctxToken = String(ctxToken);
  tpl.maxRows = KUJ_MAX_ROWS_;
  return tpl.evaluate()
    .setTitle("苦情・通報の取り込み（CSV）")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// #############################################################################
// ## crossDedup.gs — シート既存行との cross-sheet 重複チェック
// #############################################################################
// 照合キー: 受付日（YYYY-MM-DD）+ 問合せ元 + 問合せ元　連絡先 + 相談詳細 を \x1F 連結。
// ソフトデリート済み（deletedAt != ""）の行は "存在しない" として扱い、再取り込みを許容する。

// 候補オブジェクト → cross-sheet 照合キー文字列。
// 全フィールドが空の場合は "\x1F\x1F\x1F"（呼び出し側でスキップ判定）。
function Kuj_candidateCrossKey_(cand) {
  var c = cand || {};
  var dateStr = String(Kuj_toCanonicalDate_(c.ukeotsukeDate) || "");
  var nameStr = String(c.toiawaseMoto == null ? "" : c.toiawaseMoto).replace(/^\s+|\s+$/g, "");
  var contactStr = String(c.toiawaseMotoRenraku == null ? "" : c.toiawaseMotoRenraku).replace(/^\s+|\s+$/g, "");
  var detailStr = String(c.soudanShosai == null ? "" : c.soudanShosai).replace(/^\s+|\s+$/g, "");
  return dateStr + "\x1F" + nameStr + "\x1F" + contactStr + "\x1F" + detailStr;
}

// シートを読んで、ソフトデリートされていない行の cross-sheet キーを集合 {} として返す（GAS 専用）。
// シート読み取り失敗時は空 {} を返す（graceful fallback）。
function Kuj_buildSheetCrossKeySet_(spreadsheetId, sheetName) {
  var set = {};
  if (!spreadsheetId) return set;
  var sheet;
  try { sheet = Kuj_getDataSheet_(spreadsheetId, sheetName); } catch (e) { return set; }
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  if (lastRow < NFB_DATA_START_ROW) return set;

  var keyToColumn = Sheets_buildHeaderKeyMap_(sheet);
  var fixedColMap = Sheets_buildFixedColMapFromSheet_(sheet);

  // 0-based 列インデックス（存在しなければ -1）
  var uIdx = (keyToColumn["受付日"] || 0) - 1;
  var mIdx = (keyToColumn["問合せ元"] || 0) - 1;
  var rIdx = (keyToColumn["問合せ元　連絡先"] || 0) - 1; // 全角スペースあり
  var sIdx = (keyToColumn["相談詳細"] || 0) - 1;
  var dIdx = Object.prototype.hasOwnProperty.call(fixedColMap, "deletedAt") ? fixedColMap["deletedAt"] : -1;

  var numRows = lastRow - NFB_DATA_START_ROW + 1;
  var values;
  try { values = sheet.getRange(NFB_DATA_START_ROW, 1, numRows, lastCol).getValues(); }
  catch (e) { return set; }

  var EMPTY_KEY = "\x1F\x1F\x1F";
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    // ソフトデリート済みの行はスキップ（re-import 可能にする）
    if (dIdx >= 0 && row[dIdx] !== "") continue;

    var dateStr = Kuj_dateToCanonical_(uIdx >= 0 ? row[uIdx] : "");
    var nameStr = String(mIdx >= 0 && row[mIdx] != null ? row[mIdx] : "").replace(/^\s+|\s+$/g, "");
    var contactStr = String(rIdx >= 0 && row[rIdx] != null ? row[rIdx] : "").replace(/^\s+|\s+$/g, "");
    var detailStr = String(sIdx >= 0 && row[sIdx] != null ? row[sIdx] : "").replace(/^\s+|\s+$/g, "");

    var key = dateStr + "\x1F" + nameStr + "\x1F" + contactStr + "\x1F" + detailStr;
    if (key !== EMPTY_KEY) set[key] = true;
  }
  return set;
}

// 候補配列をシート既存行で絞り込む。{ candidates: [], sheetDuplicates: <count> } を返す。
function Kuj_filterBySheetDedup_(candidates, spreadsheetId, sheetName) {
  var existingKeys = {};
  if (spreadsheetId) {
    try { existingKeys = Kuj_buildSheetCrossKeySet_(spreadsheetId, sheetName); }
    catch (e) { /* fallback: dedup なしで続行 */ }
  }
  var out = [];
  var dupCount = 0;
  var EMPTY_KEY = "\x1F\x1F\x1F";
  for (var i = 0; i < (candidates || []).length; i++) {
    var key = Kuj_candidateCrossKey_(candidates[i]);
    if (key !== EMPTY_KEY && Object.prototype.hasOwnProperty.call(existingKeys, key)) {
      dupCount++;
    } else {
      out.push(candidates[i]);
    }
  }
  return { candidates: out, sheetDuplicates: dupCount };
}


// #############################################################################
// ## api.gs — プレビュー / コミット（google.script.run 公開関数）
// #############################################################################
// 注: ここの 3 関数（Kuj_getTargets / Kuj_previewCsv / Kuj_commitImport）は google.script.run から
// 呼ぶため末尾アンダースコア不可（Apps Script が末尾 _ を private 扱いにして呼べない＝choju と同じ規約）。

// 書き込み先（管理者リレーの ctx から解決）を返す。画面上部の URL 表示用。
function Kuj_getTargets(ctxToken) {
  try {
    var t = Kuj_resolveTargets_(ctxToken);
    return {
      ok: true,
      spreadsheetId: t.spreadsheetId,
      sheetName: t.sheetName,
      url: t.spreadsheetId ? ("https://docs.google.com/spreadsheets/d/" + t.spreadsheetId) : ""
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// data キー（エスケープ済みパス）→ 人が読めるラベル（"a/b" → "a ＞ b"）。
function Kuj_prettyLabel_(key) {
  var segs = Nfb_splitFieldKey_(key);
  return segs.length ? segs.join(" ＞ ") : String(key == null ? "" : key);
}

// 候補配列 → 読みやすいプレビュー行（index, layout, ラベル＝値, 警告）。
function Kuj_previewRowsFromCandidates_(candidates) {
  var rows = [];
  for (var i = 0; i < (candidates || []).length; i++) {
    var cand = candidates[i] || {};
    var conv = Kuj_candidateToData_(cand);
    var fields = [];
    for (var key in conv.data) {
      if (!Object.prototype.hasOwnProperty.call(conv.data, key)) continue;
      fields.push({ label: Kuj_prettyLabel_(key), value: String(conv.data[key] == null ? "" : conv.data[key]) });
    }
    rows.push({
      index: i,
      layout: String(cand._layout == null ? "" : cand._layout),
      fields: fields,
      warnings: conv.warnings
    });
  }
  return rows;
}

// CSV テキスト群 → 読みやすいプレビュー（行ごと・ラベル＝値）＋警告＋書き込み先 URL。
function Kuj_previewCsv(csvTexts, ctxToken) {
  try {
    var batch = Kuj_parseCsvBatch_(csvTexts);
    var targets = Kuj_resolveTargets_(ctxToken);
    // cross-sheet dedup: シートの既存行（ソフトデリート除く）と照合してプレビューから除外
    var crossFiltered = Kuj_filterBySheetDedup_(batch.candidates, targets.spreadsheetId, targets.sheetName);
    if (crossFiltered.sheetDuplicates) {
      batch.warnings.push("既存レコードと重複する " + crossFiltered.sheetDuplicates + " 件をスキップしました（ソフトデリート済みを除く）。");
    }
    return {
      ok: true,
      rows: Kuj_previewRowsFromCandidates_(crossFiltered.candidates),
      warnings: batch.warnings,
      count: crossFiltered.candidates.length,
      duplicates: batch.duplicates,
      sheetDuplicates: crossFiltered.sheetDuplicates,
      skipped: batch.skipped,
      overflow: batch.overflow,
      headerOk: batch.headerOk,
      spreadsheetId: targets.spreadsheetId,
      sheetName: targets.sheetName,
      url: targets.spreadsheetId ? ("https://docs.google.com/spreadsheets/d/" + targets.spreadsheetId) : ""
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// 選択 index（JSON 配列文字列）→ 範囲内の昇順ユニーク配列。
function Kuj_parseIndexes_(selectedIndexesJson, count) {
  var arr = [];
  try { arr = JSON.parse(String(selectedIndexesJson || "[]")); } catch (e) { arr = []; }
  if (Object.prototype.toString.call(arr) !== "[object Array]") arr = [];
  var seen = {};
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var n = Number(arr[i]);
    if (!isFinite(n)) continue;
    n = Math.floor(n);
    if (n < 0 || n >= count) continue;
    if (seen[n]) continue;
    seen[n] = true;
    out.push(n);
  }
  out.sort(function (a, b) { return a - b; });
  return out;
}

// 選択された行だけを Data シートへ直接書き込む。ブラウザ送信値は信用せず CSV を再パースする。
function Kuj_commitImport(csvTexts, selectedIndexesJson, ctxToken) {
  try {
    var targets = Kuj_resolveTargets_(ctxToken);
    if (!targets.spreadsheetId) {
      return { ok: false, error: "書き込み先スプレッドシートが未解決です。検索画面の『管理者のみ』外部アクションボタンを管理者で押して取り込み画面を開いてください。" };
    }
    var batch = Kuj_parseCsvBatch_(csvTexts);
    // cross-sheet dedup: プレビューと同じ絞り込みをコミット時にも適用（インデックス空間を一致させる）
    var crossFiltered = Kuj_filterBySheetDedup_(batch.candidates, targets.spreadsheetId, targets.sheetName);
    var candidates = crossFiltered.candidates;
    var selected = Kuj_parseIndexes_(selectedIndexesJson, candidates.length);
    if (!selected.length) return { ok: false, error: "取り込む行が選択されていません。" };
    var result = Kuj_withLock_("取り込み", function () {
      var written = 0;
      var warnings = [];
      if (crossFiltered.sheetDuplicates) {
        warnings.push("既存レコードと重複する " + crossFiltered.sheetDuplicates + " 件をスキップしました（ソフトデリート済みを除く）。");
      }
      for (var s = 0; s < selected.length; s++) {
        var cand = candidates[selected[s]];
        if (!cand) continue;
        var conv = Kuj_candidateToData_(cand);
        for (var w = 0; w < conv.warnings.length; w++) warnings.push("[行" + (selected[s] + 1) + "] " + conv.warnings[w]);
        var rec = { id: Kuj_generateRecordId_(), data: conv.data, pid: "" };
        var res = Kuj_appendRow_(targets.spreadsheetId, targets.sheetName, rec);
        if (res && res.warnings && res.warnings.length) {
          warnings.push("[行" + (selected[s] + 1) + "] 列が見つからず取り込まれなかった項目: " + res.warnings.join(" / "));
        }
        written++;
      }
      return { ok: true, written: written, warnings: warnings };
    });
    if (!result || result.ok === false) return result || { ok: false, error: "取り込みに失敗しました。" };
    result.sheetName = targets.sheetName;
    result.sheetUrl = "https://docs.google.com/spreadsheets/d/" + targets.spreadsheetId;
    return result;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}


// #############################################################################
// ## write.gs — Data シートへ直接書き込み（本体 gas/ + choju_yoshiki から移植）
// #############################################################################
// NFB レイアウト: ヘッダ 1–11 行、データは 12 行目以降。列はヘッダパス（"/" 連結・可逆エスケープ）で照合。
// kujo の data キーは Kuj_joinFieldPath_、列キーは Sheets_pathKey_(=Nfb_joinFieldPath_) で同一アルゴリズム＝一致する。

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

// ----- パスコーデック（本体 gas/pathCodec.gs 移植・可逆エスケープ "/" 連結）-----
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
function Nfb_splitEscaped_(text, sep) {
  var str = String(text === null || text === undefined ? "" : text);
  var tokens = [];
  var current = "";
  var escaping = false;
  var i = 0;
  while (i < str.length) {
    var ch = str[i];
    if (escaping) { current += ch; escaping = false; i++; continue; }
    if (ch === "\\") { escaping = true; i++; continue; }
    if (ch === sep) { tokens.push(current); current = ""; i++; continue; }
    current += ch; i++;
  }
  if (escaping) current += "\\";
  tokens.push(current);
  return tokens;
}
function Nfb_joinFieldPath_(segments) { return Nfb_joinEscaped_(segments, NFB_PATH_SEP); }
function Nfb_splitFieldKey_(key) {
  if (key === null || key === undefined || key === "") return [];
  return Nfb_splitEscaped_(key, NFB_PATH_SEP);
}

// ----- ヘッダ → 列マップ（本体 gas/sheetsHeaders.gs 移植）-----
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
function Sheets_pathKey_(path) { return Nfb_joinFieldPath_(Sheets_normalizeHeaderPath_(path)); }
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

// ----- セル整形（本体 gas/sheetsRowOps.gs / sheetsDatetime.gs 移植）-----
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
function Sheets_unixMsToSheetDate_(unixMs) {
  if (typeof unixMs !== "number" || !isFinite(unixMs)) return null;
  var d = new Date(unixMs);
  return isNaN(d.getTime()) ? null : d;
}
// canonical 文字列 → シート用 Date（"YYYY-MM-DD" / "HH:mm" 等）。解釈不能なら null。
function Kuj_canonicalToSheetDate_(canonical, kind) {
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
function Kuj_resolveCell_(value) {
  if (value === undefined || value === null || value === "") {
    return { value: "", numberFormat: NFB_SHEETS_TEXT_FORMAT };
  }
  if (typeof value === "string") {
    var s = value.replace(/^\s+|\s+$/g, "");
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
      var d = Kuj_canonicalToSheetDate_(s, "date");
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
// 新規行（rowData / rowFormats）を組み立てる純関数（GAS 非依存・node テスト可能）。
function Kuj_buildNewRow_(keyToColumn, fixedColMap, lastColumn, rec, maxNo, now, email) {
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
    var norm = Kuj_resolveCell_(normData[key]);
    rowData[colIdx] = norm.value;
    if (norm.numberFormat) rowFormats[colIdx] = norm.numberFormat;
  }
  return { rowData: rowData, rowFormats: rowFormats };
}
// data のキーのうち、ヘッダ列に存在せず取り込まれなかった（非空の）キーを列挙する。
function Kuj_collectDroppedKeys_(data, keyToColumn) {
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

// ----- I/O（SpreadsheetApp）-----
function Kuj_activeEmail_() {
  try { return Session.getActiveUser().getEmail() || ""; } catch (e) { return ""; }
}
function Kuj_getDataSheet_(spreadsheetId, sheetName) {
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
function Kuj_appendRow_(spreadsheetId, sheetName, rec) {
  var sheet = Kuj_getDataSheet_(spreadsheetId, sheetName);
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

  var built = Kuj_buildNewRow_(keyToColumn, fixedColMap, lastColumn, rec, maxNo, (new Date()).getTime(), Kuj_activeEmail_());
  var warnings = Kuj_collectDroppedKeys_(rec && rec.data, keyToColumn);

  var targetRow = (lastRow >= NFB_DATA_START_ROW) ? lastRow + 1 : NFB_DATA_START_ROW;
  Sheets_ensureRowCapacity_(sheet, targetRow);
  var range = sheet.getRange(targetRow, 1, 1, lastColumn);
  range.setNumberFormats([built.rowFormats]); // 値より先に書式（"1-1"→日付等の自動変換を防ぐ）
  range.setValues([built.rowData]);
  return { ok: true, row: targetRow, id: rec && rec.id, warnings: warnings };
}
// スクリプトロックで直列化（このスタンドアロンアプリ自身のロック。本体とは別プロジェクト）。
function Kuj_withLock_(label, fn) {
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


// #############################################################################
// ## ctx.gs — リレー文脈の橋渡し + 書き込み先解決（choju 移植・親のみ）
// #############################################################################

// 本体 payload から書き込み先（親フォームの保存先）を抜き出す。子フォームは無いので親のみ。
function Kuj_extractRelayContext_(data) {
  var storage = (data && data.storage && typeof data.storage === "object") ? data.storage : {};
  return {
    spreadsheetId: typeof storage.spreadsheetId === "string" ? storage.spreadsheetId : "",
    sheetName: typeof storage.sheetName === "string" ? storage.sheetName : "",
    formId: (data && typeof data.formId === "string") ? data.formId : ""
  };
}
// ── ctx トークン（自己完結方式）─────────────────────────────────────────────
// 書き込み先（親フォームの storage）を URL-safe base64 の JSON にしてトークンへ載せる。doPost と doGet
// は別リクエストなので橋渡しが要るが、CacheService に退避する旧方式は TTL 切れ/エビクションで「未解決」に
// なる事故があった。トークン自体が保存先を持てば、ボタン押下で押し出された storage が確実に引き渡る。
// 旧キャッシュ方式トークン（"r_..."）も Kuj_readCtx_ でフォールバック解決する（後方互換）。
var KUJ_CTX_PREFIX_ = "c1."; // 自己完結トークンの目印（base64url・"r_..." キャッシュキーと衝突しない）

function Kuj_encodeCtx_(ctx) {
  try {
    if (typeof Utilities !== "undefined" && Utilities.base64EncodeWebSafe) {
      // 末尾の "=" パディングは URL で %3D に化けるので落とす（base64DecodeWebSafe はパディング無しを許容）。
      return KUJ_CTX_PREFIX_ + Utilities.base64EncodeWebSafe(JSON.stringify(ctx || {}), Utilities.Charset.UTF_8).replace(/=+$/, "");
    }
  } catch (e) { /* fall through */ }
  return "";
}
function Kuj_decodeCtx_(token) {
  var t = String(token == null ? "" : token);
  if (t.indexOf(KUJ_CTX_PREFIX_) !== 0) return null; // 自己完結トークンでなければ旧方式へ委譲
  try {
    if (typeof Utilities === "undefined" || !Utilities.base64DecodeWebSafe) return null;
    var json = Utilities.newBlob(Utilities.base64DecodeWebSafe(t.slice(KUJ_CTX_PREFIX_.length))).getDataAsString("UTF-8");
    var obj = JSON.parse(json);
    return (obj && typeof obj === "object") ? obj : null;
  } catch (e) { return null; }
}
// 旧方式: ctx をスクリプトキャッシュから読む（自己完結トークンでないとき＝過去に発行された "r_..." 用の後方互換）。
function Kuj_readCtx_(token) {
  try { var s = CacheService.getScriptCache().get("kujctx_" + String(token)); return s ? JSON.parse(s) : null; }
  catch (e) { return null; }
}
// 取り込み画面の URL（?page=import&ctx=<token>）。デプロイ URL は ScriptApp から解決する。
function Kuj_buildImportUrl_(token) {
  var base = "";
  try { base = ScriptApp.getService().getUrl() || ""; } catch (e) { base = ""; }
  if (!base) return "";
  var sep = base.indexOf("?") >= 0 ? "&" : "?";
  return base + sep + "page=import" + (token ? "&ctx=" + encodeURIComponent(token) : "");
}
// 書き込み先を解決する。管理者リレーの ctx（自己完結トークン）からのみ解決する（Script Property フォールバックは廃止）。
// ctx は自己完結トークン（新・キャッシュ非依存）を最優先で解き、駄目なら旧キャッシュ方式を試す。
function Kuj_resolveTargets_(ctxToken) {
  var ctx = null;
  if (ctxToken) {
    ctx = Kuj_decodeCtx_(ctxToken);          // 自己完結トークン（新）
    if (!ctx) ctx = Kuj_readCtx_(ctxToken);  // 旧キャッシュ方式トークン（後方互換）
  }
  return Kuj_targetsFromCtx_(ctx);
}
// ctx（リレーで受けた現在フォームの保存先）から書き込み先を組む純関数（GAS 非依存・node テスト可能）。
// spreadsheetId が無ければ未解決（""）、sheetName 既定は "Data"。
function Kuj_targetsFromCtx_(ctx) {
  return {
    spreadsheetId: (ctx && ctx.spreadsheetId) ? ctx.spreadsheetId : "",
    sheetName: (ctx && ctx.sheetName) ? ctx.sheetName : NFB_DEFAULT_SHEET_NAME
  };
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
// ## Test.gs — デプロイ不要テスト（GAS エディタで testMapping を実行しログ確認）
// #############################################################################
// 純ロジック（CSV パース・候補→data・日付・dedup・30 行制限・行組み立て）のみ検証。Sheets/HtmlService 不使用。
// 同等の検証を node でも: node scripts/test_mapping.mjs。

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

  // 7. 直接書き込み行の組み立て（固定列配置・受付日の日付化・数式中和）
  var keyToColumn = { "受付日": 10, "問合せ方法": 11, "相談詳細": 12 };
  var fixedColMap = { "id": 0, "No.": 1, "createdAt": 2, "modifiedAt": 3, "pid": 8 };
  var recRow = Kuj_buildNewRow_(keyToColumn, fixedColMap, 13,
    { id: "r_x", data: { "受付日": "2026-06-27", "問合せ方法": "ホームページ", "相談詳細": "=SUM(A1)" } },
    4, 1700000000000, "me@example.com");
  exp("buildNewRow id", recRow.rowData[0], "r_x");
  exp("buildNewRow No.", recRow.rowData[1], 5);
  truthy("buildNewRow 受付日 Date 化", recRow.rowData[9] instanceof Date);
  exp("buildNewRow 受付日 書式", recRow.rowFormats[9], NFB_SHEETS_DATE_FORMAT);
  exp("buildNewRow 問合せ方法", recRow.rowData[10], "ホームページ");
  exp("buildNewRow 数式中和", recRow.rowData[11], "'=SUM(A1)");

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

  // 12. 重複取り込み防止（問い合わせ日込み。同一内容＋同一日時のみ重複。日時が違えば別物）
  var dupCsv = "ステータス,問い合わせ日,返信者,現在の振分先,問い合わせ件名,メールアドレス,氏名,ふりがな,年齢,職業,住所,郵便番号,電話番号,件名,内容\n"
    + "未返信,2026/6/27 12:46,,環境共生,カラス,a@b.c,山田,やまだ,40代,会社員,中央区,060-0001,011-0,カラス,威嚇された\n"
    + "返信済,2026/6/27 12:46,担当A,環境共生,カラス,a@b.c,山田,やまだ,40代,会社員,中央区,060-0001,011-0,カラス,威嚇された\n"
    + "未返信,2026/6/28 9:00,,環境共生,カラス,a@b.c,山田,やまだ,40代,会社員,中央区,060-0001,011-0,カラス,威嚇された\n";
  var dup = Kuj_csvToCandidates_(dupCsv);
  exp("CSV 重複除外後の候補数(日時込み)", dup.candidates.length, 2);
  exp("CSV 重複検出数", dup.duplicates, 1);
  truthy("CSV 重複 warning", dup.warnings.length > 0);

  // 13. 30 行制限（重複・空行除外後に先頭 KUJ_MAX_ROWS_ 行・超過は warning）
  var hdr31 = "問い合わせ日,氏名,件名,内容\n";
  var body31 = "";
  for (var t31 = 0; t31 < KUJ_MAX_ROWS_ + 1; t31++) body31 += ("2026/6/27 " + t31 + ":00,氏名" + t31 + ",件名" + t31 + ",内容" + t31 + "\n");
  var batch31 = Kuj_parseCsvBatch_([hdr31 + body31]);
  exp("30 行制限後の候補数", batch31.candidates.length, KUJ_MAX_ROWS_);
  exp("30 行 overflow", batch31.overflow, 1);

  // 14. Kuj_candidateCrossKey_（cross-sheet dedup キー生成）
  var ck1 = Kuj_candidateCrossKey_({ ukeotsukeDate: "2026/06/27", toiawaseMoto: "山田太郎", toiawaseMotoRenraku: "a@b.c", soudanShosai: "カラス被害\n内容" });
  truthy("crossKey 非空", ck1 && ck1.length > 0);
  var ck2 = Kuj_candidateCrossKey_({ ukeotsukeDate: "2026/06/27", toiawaseMoto: "山田太郎", toiawaseMotoRenraku: "a@b.c", soudanShosai: "カラス被害\n内容" });
  exp("crossKey 同一入力で同一キー", ck1, ck2);
  var ckDiffDate = Kuj_candidateCrossKey_({ ukeotsukeDate: "2026/06/28", toiawaseMoto: "山田太郎", toiawaseMotoRenraku: "a@b.c", soudanShosai: "カラス被害\n内容" });
  truthy("crossKey 日付違いは別キー", ck1 !== ckDiffDate);
  var ckEmpty = Kuj_candidateCrossKey_({});
  exp("crossKey 全空は EMPTY_KEY", ckEmpty, "\x1F\x1F\x1F");

  Logger.log(errs.length === 0 ? "[PASS] testMapping 全項目 PASS" : "[FAIL] testMapping — " + errs.join(" / "));
  return errs.length === 0;
}


// #############################################################################
// ## node エクスポート（GAS では module 未定義なので無視される）
// #############################################################################
if (typeof module === "object" && module.exports) {
  module.exports = {
    Kuj_normalizeText_: Kuj_normalizeText_,
    Kuj_joinNonEmpty_: Kuj_joinNonEmpty_,
    Kuj_parseCsv_: Kuj_parseCsv_,
    Kuj_csvHeaderIndex_: Kuj_csvHeaderIndex_,
    Kuj_csvCell_: Kuj_csvCell_,
    Kuj_csvRowToCandidate_: Kuj_csvRowToCandidate_,
    Kuj_csvToCandidates_: Kuj_csvToCandidates_,
    Kuj_parseCsvBatch_: Kuj_parseCsvBatch_,
    Kuj_parseCsvToRecords_: Kuj_parseCsvToRecords_,
    Kuj_candidateToData_: Kuj_candidateToData_,
    Kuj_buildUploadRecords_: Kuj_buildUploadRecords_,
    Kuj_previewRowsFromCandidates_: Kuj_previewRowsFromCandidates_,
    Kuj_prettyLabel_: Kuj_prettyLabel_,
    Kuj_parseIndexes_: Kuj_parseIndexes_,
    Kuj_toCanonicalDate_: Kuj_toCanonicalDate_,
    Kuj_joinFieldPath_: Kuj_joinFieldPath_,
    Kuj_escapeSegment_: Kuj_escapeSegment_,
    Kuj_generateRecordId_: Kuj_generateRecordId_,
    Kuj_candHas_: Kuj_candHas_,
    Kuj_hmacHex_: Kuj_hmacHex_,
    Kuj_buildProbeResponse_: Kuj_buildProbeResponse_,
    Kuj_extractRelayContext_: Kuj_extractRelayContext_,
    Kuj_encodeCtx_: Kuj_encodeCtx_,
    Kuj_decodeCtx_: Kuj_decodeCtx_,
    Kuj_targetsFromCtx_: Kuj_targetsFromCtx_,
    Kuj_buildNewRow_: Kuj_buildNewRow_,
    Kuj_resolveCell_: Kuj_resolveCell_,
    Kuj_canonicalToSheetDate_: Kuj_canonicalToSheetDate_,
    Kuj_collectDroppedKeys_: Kuj_collectDroppedKeys_,
    Nfb_joinFieldPath_: Nfb_joinFieldPath_,
    Nfb_splitFieldKey_: Nfb_splitFieldKey_,
    Sheets_pathKey_: Sheets_pathKey_,
    Sheets_normalizeHeaderKey_: Sheets_normalizeHeaderKey_,
    Sheets_normalizeRecordDataKeys_: Sheets_normalizeRecordDataKeys_,
    Sheets_extractColumnPaths_: Sheets_extractColumnPaths_,
    Sheets_buildFixedColMapFromPaths_: Sheets_buildFixedColMapFromPaths_,
    Sheets_neutralizeFormulaPrefix_: Sheets_neutralizeFormulaPrefix_,
    KUJ_MAX_ROWS_: KUJ_MAX_ROWS_,
    KUJ_OPTIONS_: KUJ_OPTIONS_,
    KUJ_FIELDS_: KUJ_FIELDS_,
    Kuj_candidateCrossKey_: Kuj_candidateCrossKey_,
    Kuj_buildSheetCrossKeySet_: Kuj_buildSheetCrossKeySet_,
    Kuj_filterBySheetDedup_: Kuj_filterBySheetDedup_
  };
}

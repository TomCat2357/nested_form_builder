/**
 * GAS テンプレート置換のテスト（新構文 {{expr}} 対応版）
 *
 * 旧パイプ構文（{@field|pipe:arg}）は PR-5 で廃止され、alasql 互換の単行式
 * （{{UPPER(`field`)}} 等）に統一された。さらにトークンは連続二重ブレース
 * `{{ ... }}` のみとなり、単一ブレース `{ ... }` はリテラル扱いとなった
 * （元データ形式 `{...}` は廃止、評価は統一 view 行 1 本で行う）。ここでは
 * expressionEvaluator.gs + templateEvaluator.gs を組み込んだ driveTemplate.gs の
 * 挙動を、Google Doc テンプレート差し込み・ファイル名解決・フォルダ自動命名まで
 * 含めて確認する。
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

function createTextElement(initialText) {
  let text = initialText;
  return {
    editAsText() { return this; },
    getText() { return text; },
    replaceText(pattern, replacement) {
      text = text.replace(new RegExp(pattern, "g"), replacement);
      return this;
    },
  };
}

function createContainer(children) {
  return {
    getText() {
      return children
        .map((c) => (typeof c.getText === "function" ? c.getText() : ""))
        .join("\n");
    },
    replaceText(pattern, replacement) {
      children.forEach((c) => {
        if (typeof c.replaceText === "function") c.replaceText(pattern, replacement);
      });
      return this;
    },
    getNumChildren() { return children.length; },
    getChild(index) { return children[index]; },
  };
}

function loadGasContext() {
  const formatLookup = {
    "yyyy-MM-dd_HH:mm:ss": "2026-04-04_10:20:30",
    "yyyy-MM-dd HH:mm:ss": "2026-04-04 10:20:30",
    "yyyy-MM-dd": "2026-04-04",
  };
  const context = {
    console,
    JSON,
    Date,
    Math,
    NFB_RECORD_TEMP_FOLDER_PREFIX: "NFB_RECORD_TEMP_",
    Logger: { log() {} },
    Session: { getScriptTimeZone() { return "Asia/Tokyo"; } },
    Utilities: {
      formatDate(_d, _tz, format) { return formatLookup[format] || format; },
      getUuid() { return "uuid-test-1234"; },
    },
    nfbSafeCall_(fn) {
      try { return fn(); }
      catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
    },
    nfbErrorToString_(error) { return error && error.message ? error.message : String(error); },
    // 文字列化＋trim（本体は gas/constants.gs）。
    Nfb_trimStr_(value) { return value ? String(value).trim() : ""; },
    Forms_parseGoogleDriveUrl_(url) {
      const match = String(url).match(/\/d\/([^/]+)/);
      return { type: "file", id: match ? match[1] : "" };
    },
    // 標準フォルダ未解決の環境を模す（テストは nfbResolveRootFolder_ をスタブして経路を指定する）。
    StdFolders_autoFileFolderOrNull_() { return null; },
  };

  return loadGasFiles(context, [
    "vendor/alasql.min.js",
    "generated/nfbAlasqlUdfs.gs",
    "pathCodec.gs", "expressionEvaluator.gs",
    "templateEvaluator.gs",
    "driveTemplate.gs",
    "drivePrintDocument.gs",
    "driveFolder.gs",
    "driveOutput.gs",
    "driveOutputDocument.gs",
    "driveGmailOutput.gs",
    "driveFile.gs",
  ]);
}

// ---------------------------------------------------------------------------
// nfbResolveTemplateTokens_ — 単一文字列のテンプレート解決
// ---------------------------------------------------------------------------

test("nfbResolveTemplateTokens_: バッククォート識別子で fieldValues を解決する", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f1: "氏名", f2: "部署" },
    fieldValues: { f1: "山田 太郎", f2: "営業一課" },
    responses:   { f1: "山田太郎", f2: "営業" },
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{`氏名`}}_{{`部署`}}", ctx), "山田 太郎_営業一課");
});

test("nfbResolveTemplateTokens_: {{}} は dataValues があればそれを引き、単一 {} はリテラル", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { g: "性別" },
    fieldValues: { g: "男(ビュー)" },        // dataValues がある限り使われない
    dataValues: { "性別": "男(データ)" },    // 統一 row の基底（非空なら優先）
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 二重ブレース → dataValues が非空なら dataValues を基底に解決
  assert.equal(gas.nfbResolveTemplateTokens_("{{`性別`}}", ctx), "男(データ)");
  // 単一ブレースはトークンではなくリテラル（評価しない）
  assert.equal(gas.nfbResolveTemplateTokens_("x={`性別`}", ctx), "x={`性別`}");
  // 混在: {{}} のみ評価され、{} は原文のまま残る
  assert.equal(
    gas.nfbResolveTemplateTokens_("単一:{`性別`}/二重:{{`性別`}}", ctx),
    "単一:{`性別`}/二重:男(データ)",
  );
});

test("nfbResolveTemplateTokens_: dataValues 未指定なら {{}} は fieldValues（ラベル map）を引く", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f1: "氏名" },
    fieldValues: { f1: "山田 太郎" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // dataValues が無いので fieldValues 由来の labelValueMap にフォールバック
  assert.equal(gas.nfbResolveTemplateTokens_("{{`氏名`}}", ctx), "山田 太郎");
  // 単一ブレースはリテラル（評価しない）
  assert.equal(gas.nfbResolveTemplateTokens_("x={`氏名`}", ctx), "x={`氏名`}");
});

test("nfbResolveTemplateTokens_: パイプ含みラベルもバッククォートで解決される（メール・印刷様式・ファイル名共通経路）", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f1: "基本情報|区", f2: "親|子" },
    fieldValues: { f1: "中央", f2: "太郎" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  // 単一参照
  assert.equal(gas.nfbResolveTemplateTokens_("{{`基本情報|区`}}", ctx), "中央");
  // 複合参照（連結）— Gmail 本文・PDF テンプレ・ファイル名で頻出パターン
  assert.equal(
    gas.nfbResolveTemplateTokens_("住所:{{`基本情報|区`}}/担当:{{`親|子`}}", ctx),
    "住所:中央/担当:太郎",
  );
  // || 連結
  assert.equal(
    gas.nfbResolveTemplateTokens_("{{`基本情報|区` || '-' || `親|子`}}", ctx),
    "中央-太郎",
  );
});

test("nfbResolveTemplateTokens_: ネスト子質問は 親|子 フルパスでのみ解決され、葉ラベル単独は空文字", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: {
      f_loc: "設置場所",
      f_start: "設置場所|設置開始日",
    },
    fieldValues: {
      f_loc: "ああ",
      f_start: "2026-05-08",
    },
    responses: {},
    now: new Date("2026-05-08T10:00:00+09:00"),
  };
  // フルパス参照は解決される
  assert.equal(gas.nfbResolveTemplateTokens_("{{`設置場所|設置開始日`}}", ctx), "2026-05-08");
  assert.equal(gas.nfbResolveTemplateTokens_("{{`設置場所`}}", ctx), "ああ");
  // 葉ラベル単独 (`設置開始日`) は row に存在しないので空文字
  assert.equal(gas.nfbResolveTemplateTokens_("{{`設置開始日`}}", ctx), "");
});

test("nfbResolveTemplateTokens_: UPPER / LOWER / TRIM", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f: "コード" },
    fieldValues: { f: "  aBcD  " },
    responses:   {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{TRIM(`コード`)}}", ctx), "aBcD");
  assert.equal(gas.nfbResolveTemplateTokens_("{{UPPER(TRIM(`コード`))}}", ctx), "ABCD");
  assert.equal(gas.nfbResolveTemplateTokens_("{{LOWER(TRIM(`コード`))}}", ctx), "abcd");
});

test("nfbResolveTemplateTokens_: LEFT / RIGHT / SUBSTRING", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f1: "備考" },
    fieldValues: { f1: "あいうえお" },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{LEFT(`備考`,3)}}", ctx), "あいう");
  assert.equal(gas.nfbResolveTemplateTokens_("{{RIGHT(`備考`,2)}}", ctx), "えお");
  // 1-origin: 2文字目から3文字
  assert.equal(gas.nfbResolveTemplateTokens_("{{SUBSTRING(`備考`,2,3)}}", ctx), "いうえ");
});

test("nfbResolveTemplateTokens_: TIME_FORMAT で日付整形（西暦・和暦・曜日）", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { dob: "生年月日" },
    fieldValues: { dob: "2000-01-15" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{TIME_FORMAT(`生年月日`,'YYYY')}}", ctx), "2000");
  assert.equal(gas.nfbResolveTemplateTokens_("{{TIME_FORMAT(`生年月日`,'YYYY/MM/DD')}}", ctx), "2000/01/15");
  assert.equal(gas.nfbResolveTemplateTokens_("{{TIME_FORMAT(`生年月日`,'gge年MM月DD日')}}", ctx), "平成12年01月15日");
  // 曜日（2000-01-15 は土曜日）
  assert.equal(gas.nfbResolveTemplateTokens_("{{TIME_FORMAT(`生年月日`,'YYYY/MM/DD(ddd)')}}", ctx), "2000/01/15(土)");
  assert.equal(gas.nfbResolveTemplateTokens_("{{TIME_FORMAT(`生年月日`,'dddd')}}", ctx), "土曜日");
});

test("nfbResolveTemplateTokens_: 令和への和暦変換", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { d: "入社日" },
    fieldValues: { d: "2026-04-01" },
    responses: {},
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{TIME_FORMAT(`入社日`,'gge年')}}", ctx), "令和8年");
});

test("nfbResolveTemplateTokens_: 連結 (||) と関数の組合せ", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f: "氏名" },
    fieldValues: { f: "tanaka" },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{UPPER(`氏名`) || ' SAN'}}", ctx), "TANAKA SAN");
});

test("nfbResolveTemplateTokens_: DEFAULT で空値フォールバック", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { tel: "電話" },
    fieldValues: { tel: "" },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{DEFAULT(`電話`,'未入力')}}", ctx), "未入力");
});

test("nfbResolveTemplateTokens_: DEFAULT は値があれば素通し", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { tel: "電話" },
    fieldValues: { tel: "03-1234" },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{DEFAULT(`電話`,'未入力')}}", ctx), "03-1234");
});

test("nfbResolveTemplateTokens_: REPLACE で文字列を全置換", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { addr: "住所" },
    fieldValues: { addr: "東京都-新宿区-西新宿" },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{REPLACE(`住所`,'-','/')}}", ctx), "東京都/新宿区/西新宿");
});

test("nfbResolveTemplateTokens_: NOW() を TIME_FORMAT で整形", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: {},
    fieldValues: {},
    responses: {},
  };
  // NOW() は呼び出し時の壁時計時刻を返すので、年は今年・形式の検証だけ行う。
  const yyyy = gas.nfbResolveTemplateTokens_("{{TIME_FORMAT(NOW(),'YYYY')}}", ctx);
  assert.match(yyyy, /^\d{4}$/);
  const ymd = gas.nfbResolveTemplateTokens_("{{TIME_FORMAT(NOW(),'YYYY-MM-DD')}}", ctx);
  assert.match(ymd, /^\d{4}-\d{2}-\d{2}$/);
  // ミリ秒まで取れる
  const sss = gas.nfbResolveTemplateTokens_("{{TIME_FORMAT(NOW(),'SSS')}}", ctx);
  assert.match(sss, /^\d{3}$/);
});

test("nfbResolveTemplateTokens_: REGEXP_MATCH でキャプチャ抽出", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f: "メール" },
    fieldValues: { f: "user@example.com" },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{REGEXP_MATCH(`メール`,'(.+)@(.+)',1)}}", ctx), "user");
  assert.equal(gas.nfbResolveTemplateTokens_("{{REGEXP_MATCH(`メール`,'(.+)@(.+)',2)}}", ctx), "example.com");
  // マッチしないケース（groupIdx 省略時は fullMatch なので、一致しなければ ""）
  assert.equal(gas.nfbResolveTemplateTokens_("{{REGEXP_MATCH(`メール`,'\\\\d+',0)}}", ctx), "");
});

test("nfbResolveTemplateTokens_: REGEXP_REPLACE で $1 バックリファレンス置換", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f: "メール" },
    fieldValues: { f: "user@example.com" },
    responses: {},
    now: new Date(),
  };
  assert.equal(
    gas.nfbResolveTemplateTokens_("{{REGEXP_REPLACE(`メール`,'(.+)@(.+)','$2/$1')}}", ctx),
    "example.com/user"
  );
});

test("nfbResolveTemplateTokens_: IIF で条件分岐", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f: "報道（予定）等" },
    fieldValues: { f: "記事掲載" },
    responses: {},
    now: new Date(),
  };
  assert.equal(
    gas.nfbResolveTemplateTokens_("報告{{IIF(LENGTH(`報道（予定）等`)>0, '（' || `報道（予定）等` || '）', '')}}", ctx),
    "報告（記事掲載）"
  );
  // 空時
  ctx.fieldValues.f = "";
  assert.equal(
    gas.nfbResolveTemplateTokens_("報告{{IIF(LENGTH(`報道（予定）等`)>0, '（' || `報道（予定）等` || '）', '')}}", ctx),
    "報告"
  );
});

test("nfbResolveTemplateTokens_: CASE WHEN ... THEN ... END", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f: "年齢" },
    fieldValues: { f: 15 },
    responses: {},
    now: new Date(),
  };
  const tpl = "{{CASE WHEN `年齢`<10 THEN '子供' WHEN `年齢`<20 THEN '青少年' ELSE '大人' END}}";
  assert.equal(gas.nfbResolveTemplateTokens_(tpl, ctx), "青少年");
  ctx.fieldValues.f = 25;
  assert.equal(gas.nfbResolveTemplateTokens_(tpl, ctx), "大人");
});

test("nfbResolveTemplateTokens_: _record_url は allowGmailOnlyTokens=true のときだけ展開", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: {},
    fieldValues: {},
    responses: {},
    recordUrl: "https://example.com/r/rec001",
    formUrl: "https://example.com/f",
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("url={{`_record_url`}}", ctx), "url=");
  assert.equal(
    gas.nfbResolveTemplateTokens_("url={{`_record_url`}}", ctx, { allowGmailOnlyTokens: true }),
    "url=https://example.com/r/rec001"
  );
});

test("nfbResolveTemplateTokens_: 評価エラー時はトークン原文を残す", () => {
  const gas = loadGasContext();
  const ctx = { fieldPaths: {}, fieldValues: {}, responses: {}, now: new Date() };
  // 未知の関数 → エラー → 原文残し
  assert.equal(gas.nfbResolveTemplateTokens_("[{{unknown_xyz()}}]", ctx), "[{{unknown_xyz()}}]");
});

test("nfbResolveTemplateTokens_: \\{ \\} はリテラル（評価しない）", () => {
  const gas = loadGasContext();
  const ctx = { fieldPaths: {}, fieldValues: {}, responses: {}, now: new Date() };
  const tpl = String.raw`literal \{not_evaluated\} end`;
  assert.equal(gas.nfbResolveTemplateTokens_(tpl, ctx), "literal {not_evaluated} end");
});

test("nfbResolveTemplateTokens_: { を含まない文字列はそのまま返す", () => {
  const gas = loadGasContext();
  const ctx = { fieldPaths: {}, fieldValues: {}, responses: {}, now: new Date() };
  assert.equal(gas.nfbResolveTemplateTokens_("plain text", ctx), "plain text");
});

// ---------------------------------------------------------------------------
// カンマ列リスト構文 ({ e1, e2, ... } で複数値をカンマ連結)
// ---------------------------------------------------------------------------

test("nfbResolveTemplateTokens_: カンマ列リスト基本 — 複数フィールドをカンマ連結", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f1: "売上日", f2: "担当者" },
    fieldValues: { f1: "2026-04-04", f2: "山田太郎" },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{`売上日`,`担当者`}}", ctx), "2026-04-04,山田太郎");
});

test("nfbResolveTemplateTokens_: カンマ列リスト — 空白付きカンマ区切りも分割される", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f1: "A", f2: "B" },
    fieldValues: { f1: "X", f2: "Y" },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{`A`, `B`}}", ctx), "X,Y");
});

test("nfbResolveTemplateTokens_: || と , の混在 — || は部分式内に閉じる", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f1: "姓", f2: "名", f3: "所属" },
    fieldValues: { f1: "山田", f2: "太郎", f3: "営業" },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{`姓` || `名`, `所属`}}", ctx), "山田太郎,営業");
});

test("nfbResolveTemplateTokens_: カンマ列リスト — 関数引数のカンマは保護される", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f1: "a", f2: "b" },
    fieldValues: { f1: 1, f2: "B値" },
    responses: {},
    now: new Date(),
  };
  assert.equal(
    gas.nfbResolveTemplateTokens_("{{IIF(`a`>0,'pos','neg'), `b`}}", ctx),
    "pos,B値"
  );
});

test("nfbResolveTemplateTokens_: カンマ列リスト — 末尾カンマは空要素を保持", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f1: "A" },
    fieldValues: { f1: "X" },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{`A`,}}", ctx), "X,");
});

test("nfbResolveTemplateTokens_: カンマ列リスト — 連続カンマは空要素を保持", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f1: "A", f2: "B" },
    fieldValues: { f1: "X", f2: "Y" },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{`A`,,`B`}}", ctx), "X,,Y");
});

test("nfbResolveTemplateTokens_: カンマ列リスト — 空値は空文字として連結（区切り子は保持）", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f1: "A", f2: "B" },
    fieldValues: { f1: "X", f2: "" },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{`A`,`B`}}", ctx), "X,");
});

test("nfbResolveTemplateTokens_: カンマ列リスト — 文字列リテラル内のカンマは保護される", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f1: "c" },
    fieldValues: { f1: "C値" },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{'a,b', `c`}}", ctx), "a,b,C値");
});

test("nfbResolveTemplateTokens_: カンマ列リスト — 数値の和は単一値（カンマで割れない）", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f1: "売上数量", f2: "売掛数量" },
    fieldValues: { f1: 3, f2: 4 },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{`売上数量` + `売掛数量`}}", ctx), "7");
});

test("nfbResolveTemplateTokens_: カンマ列リスト — Google Doc 置換でも複合トークンが解決される", () => {
  const gas = loadGasContext();
  const bodyText = createTextElement("一覧: {{`氏名`,`部署`}}");
  const doc = {
    getBody() { return createContainer([bodyText]); },
    getHeader() { return null; },
    getFooter() { return null; },
  };
  const ctx = {
    responses: {},
    fieldPaths: { f1: "氏名", f2: "部署" },
    fieldValues: { f1: "山田", f2: "営業" },
    recordId: "rec001",
    now: new Date(),
  };
  gas.nfbApplyTemplateReplacementsToGoogleDocument_(doc, ctx);
  assert.equal(bodyText.getText(), "一覧: 山田,営業");
});

// ---------------------------------------------------------------------------
// nfbApplyTemplateReplacementsToGoogleDocument_ — Google Doc 置換
// ---------------------------------------------------------------------------

test("nfbApplyTemplateReplacementsToGoogleDocument_ は body / header / footer のトークンを置換する", () => {
  const gas = loadGasContext();
  const bodyText = createTextElement("本文 {{`氏名`}} {{`_id`}} {{TIME_FORMAT(NOW(),'YYYY')}}");
  const tableCellText = createTextElement("セル {{`部署`}}");
  const headerText = createTextElement("header {{`氏名`}}");
  const footerText = createTextElement("footer {{`_id`}}");
  const doc = {
    getBody() { return createContainer([bodyText, createContainer([tableCellText])]); },
    getHeader() { return createContainer([headerText]); },
    getFooter() { return createContainer([footerText]); },
  };

  const ctx = {
    responses: { name: "山田太郎(生データ)", dept: "営業" },
    fieldPaths: { name: "氏名", dept: "部署" },
    fieldValues: { name: "山田 太郎", dept: "営業一課" },
    recordId: "rec001",
    now: new Date("2026-04-04T10:20:30+09:00"),
  };

  gas.nfbApplyTemplateReplacementsToGoogleDocument_(doc, ctx);

  // NOW() は実行時の年（now ctx は無視される — 関数として実時刻を返す）
  const expectedYear = String(new Date().getFullYear());
  assert.equal(bodyText.getText(), "本文 山田 太郎 rec001 " + expectedYear);
  assert.equal(tableCellText.getText(), "セル 営業一課");
  assert.equal(headerText.getText(), "header 山田 太郎");
  assert.equal(footerText.getText(), "footer rec001");
});

test("nfbApplyTemplateReplacementsToGoogleDocument_ は IIF + 連結 でサブテンプレート相当を解決する", () => {
  const gas = loadGasContext();
  const withValue = createTextElement("報告{{IIF(LENGTH(`報道（予定）等`)>0,'（' || `報道（予定）等` || '）','')}}");
  const withoutValue = createTextElement("報告{{IIF(LENGTH(`報道（予定）等`)>0,'（' || `報道（予定）等` || '）','')}}");

  function makeDoc(textEl) {
    return {
      getBody() { return createContainer([textEl]); },
      getHeader() { return null; },
      getFooter() { return null; },
    };
  }

  const ctxWith = {
    responses: { f1: "記事掲載" },
    fieldPaths: { f1: "報道（予定）等" },
    fieldValues: { f1: "記事掲載" },
    fileUploadMeta: {},
    recordId: "rec001",
    now: new Date("2026-04-04T10:20:30+09:00"),
  };
  const ctxEmpty = Object.assign({}, ctxWith, { fieldValues: { f1: "" } });

  gas.nfbApplyTemplateReplacementsToGoogleDocument_(makeDoc(withValue), ctxWith);
  gas.nfbApplyTemplateReplacementsToGoogleDocument_(makeDoc(withoutValue), ctxEmpty);

  assert.equal(withValue.getText(), "報告（記事掲載）");
  assert.equal(withoutValue.getText(), "報告");
});

// ---------------------------------------------------------------------------
// nfbCreateGoogleDocumentFromTemplate — テンプレートコピー + ファイル名差し込み
// ---------------------------------------------------------------------------

test("nfbCreateGoogleDocumentFromTemplate は同名ファイルを上書きしファイル名テンプレを解決する", () => {
  const gas = loadGasContext();
  const existingFile = {
    trashed: false,
    setTrashed(v) { this.trashed = v; },
  };
  const folder = {
    getUrl() { return "https://drive.google.com/drive/folders/folder123"; },
    getFilesByName(fileName) {
      let used = false;
      return {
        hasNext() { return !used && fileName === "rec001_山田 太郎"; },
        next() { used = true; return existingFile; },
      };
    },
  };

  const bodyText = createTextElement("Hello {{`氏名`}}");
  const doc = {
    saved: false,
    getBody() { return createContainer([bodyText]); },
    getHeader() { return null; },
    getFooter() { return null; },
    saveAndClose() { this.saved = true; },
  };
  const copiedFile = {
    getId() { return "copied123"; },
    getUrl() { return "https://docs.google.com/document/d/copied123/edit"; },
    getName() { return "rec001_山田 太郎"; },
  };
  const sourceFile = {
    getName() { return "テンプレート"; },
    makeCopy(name, target) {
      assert.equal(name, "rec001_山田 太郎");
      assert.equal(target, folder);
      return copiedFile;
    },
  };

  gas.DriveApp = { getFileById(id) { assert.equal(id, "template123"); return sourceFile; } };
  gas.DocumentApp = { openById(id) { assert.equal(id, "copied123"); return doc; } };
  gas.nfbResolveUploadFolder_ = function() { return { folder, autoCreated: true }; };

  const result = gas.nfbCreateGoogleDocumentFromTemplate({
    sourceUrl: "https://docs.google.com/document/d/template123/edit",
    fileNameTemplate: "{{`_id`}}_{{`氏名`}}",
    driveSettings: {
      recordId: "rec001",
      responses: { name: "山田太郎(生データ)" },
      fieldPaths: { name: "氏名" },
      fieldValues: { name: "山田 太郎" },
    },
  });

  assert.equal(existingFile.trashed, true);
  assert.equal(bodyText.getText(), "Hello 山田 太郎");
  assert.equal(doc.saved, true);
  assert.equal(result.ok, true);
  assert.equal(result.fileName, "rec001_山田 太郎");
  assert.equal(result.fileId, "copied123");
  assert.equal(result.autoCreated, true);
});

// ---------------------------------------------------------------------------
// nfbResolveRecordOutputFileNameTemplate_
// ---------------------------------------------------------------------------

test("nfbResolveRecordOutputFileNameTemplate_ は標準ファイル名未設定時に新構文の既定値へフォールバックする", () => {
  const gas = loadGasContext();
  const expected = "{{`_id`}}_{{TIME_FORMAT(NOW(), 'YYYY-MM-DD')}}";
  assert.equal(
    gas.nfbResolveRecordOutputFileNameTemplate_(
      { settings: {} },
      { outputType: "pdf", fileNameTemplate: "" },
      "pdf",
    ),
    expected
  );
  assert.equal(
    gas.nfbResolveRecordOutputFileNameTemplate_(
      { settings: { standardPrintFileNameTemplate: "   " } },
      { outputType: "pdf", fileNameTemplate: "" },
      "pdf",
    ),
    expected
  );
  assert.equal(
    gas.nfbResolveRecordOutputFileNameTemplate_(
      { settings: {} },
      { outputType: "gmail", fileNameTemplate: "", gmailAttachPdf: true },
      "gmail",
    ),
    expected
  );
});

// ---------------------------------------------------------------------------
// nfbResolveUploadFolder_ — 自動作成時のテンプレ命名
// ---------------------------------------------------------------------------

test("nfbResolveUploadFolder_ は自動作成した一時フォルダ名をテンプレートで更新する", () => {
  const gas = loadGasContext();
  const createdFolder = {
    name: "NFB_RECORD_TEMP_rec001_temp",
    getName() { return this.name; },
    setName(next) { this.name = next; },
    getUrl() { return "https://drive.google.com/drive/folders/temp001"; },
  };
  const rootFolder = {
    createFolder(name) { createdFolder.name = name; return createdFolder; },
  };

  gas.nfbResolveRootFolder_ = () => rootFolder;

  const result = gas.nfbResolveUploadFolder_({
    recordId: "rec001",
    folderNameTemplate: "案件_{{`_id`}}",
    fieldPaths: {},
    fieldValues: {},
    responses: {},
  });

  assert.equal(result.autoCreated, true);
  assert.equal(result.folder, createdFolder);
  assert.equal(createdFolder.getName(), "案件_rec001");
});

test("nfbResolveUploadFolder_ は通常フォルダをテンプレートで改名しない", () => {
  const gas = loadGasContext();
  const folder = {
    name: "通常フォルダ",
    getName() { return this.name; },
    setName(next) { this.name = next; },
    getUrl() { return "https://drive.google.com/drive/folders/fixed001"; },
  };
  gas.nfbResolveFolderFromInput_ = () => folder;

  const result = gas.nfbResolveUploadFolder_({
    folderUrl: "https://drive.google.com/drive/folders/fixed001",
    folderNameTemplate: "案件_{{`_id`}}",
    recordId: "rec001",
    fieldPaths: {},
    fieldValues: {},
    responses: {},
  });

  assert.equal(result.autoCreated, false);
  assert.equal(result.folder, folder);
  assert.equal(folder.getName(), "通常フォルダ");
});

// ---------------------------------------------------------------------------
// fileUpload UDF (FILE_NAMES / FILE_URLS / FOLDER_NAME / FOLDER_URL)
// ---------------------------------------------------------------------------

test("nfbResolveTemplateTokens_: FILE_NAMES で fileUpload 名を結合", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f: "添付" },
    fieldValues: {},
    responses: {},
    fileUploadMeta: {
      f: {
        fileNames: ["a.pdf", "b.pdf"],
        fileUrls: ["https://drive/1", "https://drive/2"],
        folderName: "案件001",
        folderUrl: "https://drive/folder",
      },
    },
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{FILE_NAMES(`添付`)}}", ctx), "a.pdf, b.pdf");
  assert.equal(gas.nfbResolveTemplateTokens_("{{FILE_URLS(`添付`)}}", ctx), "https://drive/1, https://drive/2");
  assert.equal(gas.nfbResolveTemplateTokens_("{{FOLDER_NAME(`添付`)}}", ctx), "案件001");
  assert.equal(gas.nfbResolveTemplateTokens_("{{FOLDER_URL(`添付`)}}", ctx), "https://drive/folder");
});

test("nfbResolveTemplateTokens_: NOEXT で拡張子を除去", () => {
  const gas = loadGasContext();
  const ctx = {
    fieldPaths: { f: "ファイル名" },
    fieldValues: { f: "report.pdf, image.png" },
    responses: {},
    now: new Date(),
  };
  assert.equal(gas.nfbResolveTemplateTokens_("{{NOEXT(`ファイル名`)}}", ctx), "report, image");
});

// ---------------------------------------------------------------------------
// nfbCreateGoogleDocumentFromTemplate — エラーパス
// ---------------------------------------------------------------------------

test("nfbCreateGoogleDocumentFromTemplate は driveSettings 不在で例外", () => {
  const gas = loadGasContext();
  const result = gas.nfbCreateGoogleDocumentFromTemplate({});
  assert.equal(result.ok, false);
  assert.match(String(result.error), /出力先設定が不足/);
});

// ---------------------------------------------------------------------------
// nfbResolveRecordOutputTemplateSourceUrl_ — カード別テンプレ URL の解決
// ---------------------------------------------------------------------------

test("nfbResolveRecordOutputTemplateSourceUrl_ はカード URL を優先し、未指定なら標準テンプレへフォールバックする", () => {
  const gas = loadGasContext();
  const settings = { settings: { standardPrintTemplateUrl: "https://docs.google.com/document/d/standard999/edit" } };

  // useCustomTemplate ON + URL あり（前後空白は trim）→ カード URL
  assert.equal(
    gas.nfbResolveRecordOutputTemplateSourceUrl_(settings, {
      useCustomTemplate: true,
      templateUrl: "  https://docs.google.com/document/d/card123/edit  ",
    }),
    "https://docs.google.com/document/d/card123/edit"
  );

  // useCustomTemplate ON + URL 空白のみ → 標準テンプレへフォールバック
  assert.equal(
    gas.nfbResolveRecordOutputTemplateSourceUrl_(settings, { useCustomTemplate: true, templateUrl: "   " }),
    "https://docs.google.com/document/d/standard999/edit"
  );

  // useCustomTemplate OFF → 残骸 templateUrl は無視して標準テンプレ
  assert.equal(
    gas.nfbResolveRecordOutputTemplateSourceUrl_(settings, {
      useCustomTemplate: false,
      templateUrl: "https://docs.google.com/document/d/leftover/edit",
    }),
    "https://docs.google.com/document/d/standard999/edit"
  );

  // 標準テンプレも無ければ ""（自動生成へ）
  assert.equal(
    gas.nfbResolveRecordOutputTemplateSourceUrl_({ settings: {} }, { useCustomTemplate: false, templateUrl: "" }),
    ""
  );
});

// ---------------------------------------------------------------------------
// nfbExecuteRecordOutputAction — googleDoc / pdf 出力とカード別テンプレ URL
// ---------------------------------------------------------------------------

function mockTemplateDocEnv(gas, opts) {
  opts = opts || {};
  const templateFileId = opts.templateFileId || "template123";
  const copiedFileId = opts.copiedFileId || "copied123";
  const copiedFileName = opts.copiedFileName || "出力ドキュメント";
  const copiedFileUrl = opts.copiedFileUrl || ("https://docs.google.com/document/d/" + copiedFileId + "/edit");
  const bodyText = createTextElement("Hello");
  const doc = {
    saved: false,
    getBody() { return createContainer([bodyText]); },
    getHeader() { return null; },
    getFooter() { return null; },
    saveAndClose() { this.saved = true; },
  };
  const copiedFile = {
    trashed: false,
    copyName: "",
    getId() { return copiedFileId; },
    getUrl() { return copiedFileUrl; },
    getName() { return this.copyName || copiedFileName; },
    setName(n) { this.copyName = n; return this; },
    setTrashed(v) { this.trashed = v; },
    getBlob() {
      return {
        getAs() {
          return {
            blobName: "",
            setName(n) { this.blobName = n; return this; },
            getBytes() { return [1, 2, 3]; },
            getName() { return this.blobName; },
          };
        },
      };
    },
  };
  const sourceFile = {
    getName() { return "テンプレート"; },
    makeCopy(name) { copiedFile.copyName = name; return copiedFile; },
  };
  const rootFolder = {
    getUrl() { return "https://drive.google.com/drive/my-drive"; },
    getFilesByName() { return { hasNext() { return false; }, next() { return null; } }; },
  };
  const getFileByIdCalls = [];
  gas.DriveApp = {
    getRootFolder() { return rootFolder; },
    getFileById(id) { getFileByIdCalls.push(id); return id === templateFileId ? sourceFile : copiedFile; },
  };
  gas.DocumentApp = { openById() { return doc; } };
  gas.MimeType = { PDF: "application/pdf" };
  gas.ScriptApp = { getService() { return { getUrl() { return "https://script.google.com/macros/s/abc/exec"; } }; } };
  gas.Utilities.base64Encode = function() { return "BASE64DATA"; };
  return { doc, copiedFile, rootFolder, getFileByIdCalls, bodyText };
}

function basePayload(action) {
  return {
    action,
    settings: { standardPrintTemplateUrl: "https://docs.google.com/document/d/standard999/edit" },
    recordContext: {
      formId: "form1",
      formTitle: "申請フォーム",
      recordId: "rec001",
      recordNo: "1",
      printPayload: { records: [], formTitle: "申請フォーム", formId: "form1", recordId: "rec001" },
    },
    driveSettings: {
      folderUrl: "",
      rootFolderUrl: "",
      folderNameTemplate: "",
      useTemporaryFolder: false,
      formId: "form1",
      recordId: "rec001",
      responses: {},
      fieldPaths: {},
      fieldValues: {},
      fileUploadMeta: {},
      fileNameTemplate: "出力ドキュメント",
    },
  };
}

test("nfbExecuteRecordOutputAction: googleDoc はカード URL のテンプレからマイドライブ直下に Doc を作りリンクを返す", () => {
  const gas = loadGasContext();
  const env = mockTemplateDocEnv(gas, { templateFileId: "card123" });
  const result = gas.nfbExecuteRecordOutputAction(basePayload({
    enabled: true,
    outputType: "googleDoc",
    useCustomTemplate: true,
    templateUrl: "https://docs.google.com/document/d/card123/edit",
    fileNameTemplate: "出力ドキュメント",
  }));

  assert.equal(result.ok, true);
  assert.equal(result.outputType, "googleDoc");
  assert.equal(result.openUrl, "https://docs.google.com/document/d/copied123/edit");
  assert.equal(result.fileUrl, "https://docs.google.com/document/d/copied123/edit");
  assert.equal(result.fileName, "出力ドキュメント");
  // googleDoc は永続ファイルなのでゴミ箱に入れない / レコードフォルダ系の戻り値を出さない
  assert.equal(env.copiedFile.trashed, false);
  assert.equal("folderUrl" in result, false);
  assert.equal("fileId" in result, false);
  // カード側テンプレ（card123）が使われている
  assert.ok(env.getFileByIdCalls.includes("card123"));
});

test("nfbExecuteRecordOutputAction: googleDoc はカード URL 未指定なら標準テンプレ（standard999）を使う", () => {
  const gas = loadGasContext();
  const env = mockTemplateDocEnv(gas, { templateFileId: "standard999" });
  const result = gas.nfbExecuteRecordOutputAction(basePayload({
    enabled: true,
    outputType: "googleDoc",
    useCustomTemplate: false,
    templateUrl: "",
    fileNameTemplate: "出力ドキュメント",
  }));

  assert.equal(result.ok, true);
  assert.equal(result.outputType, "googleDoc");
  assert.ok(env.getFileByIdCalls.includes("standard999"));
});

test("nfbExecuteRecordOutputAction: pdf はカード URL のテンプレを尊重する（旧クローン撤去の確認）", () => {
  const gas = loadGasContext();
  const env = mockTemplateDocEnv(gas, { templateFileId: "card123" });
  const result = gas.nfbExecuteRecordOutputAction(basePayload({
    enabled: true,
    outputType: "pdf",
    useCustomTemplate: true,
    templateUrl: "https://docs.google.com/document/d/card123/edit",
    fileNameTemplate: "出力PDF",
  }));

  assert.equal(result.ok, true);
  assert.equal(result.outputType, "pdf");
  assert.equal(result.pdfBase64, "BASE64DATA");
  assert.equal(result.fileName, "出力PDF.pdf");
  // 一時 Doc はゴミ箱へ
  assert.equal(env.copiedFile.trashed, true);
  // 標準テンプレ（standard999）ではなくカードのテンプレ（card123）が使われている
  assert.ok(env.getFileByIdCalls.includes("card123"));
  assert.ok(!env.getFileByIdCalls.includes("standard999"));
});

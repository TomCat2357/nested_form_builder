import assert from "node:assert/strict";
import test from "node:test";
import { buildLabelValueMap, resolveTemplateTokens } from "./tokenReplacer.js";
import pipeEngine from "../../../gas/pipeEngine.js";

test("buildLabelValueMap は fieldValues を優先する", () => {
  const fieldLabels = { f1: "添付ファイル", f2: "名前" };
  const fieldValues = { f1: "見積書, 申請書", f2: "山田 太郎" };
  const responses = {
    f1: [
      { name: "見積書.pdf", driveFileUrl: "https://drive.google.com/file/d/abc" },
      { name: "申請書.docx", driveFileUrl: "https://drive.google.com/file/d/def" },
    ],
    f2: "山田 太郎",
  };

  const map = buildLabelValueMap(fieldLabels, fieldValues, responses);
  assert.equal(map["添付ファイル"], "見積書, 申請書");
  assert.equal(map["名前"], "山田 太郎");
});

test("buildLabelValueMap は fieldValues がない場合 responses からファイル名を抽出する", () => {
  const fieldLabels = { f1: "添付ファイル" };
  const fieldValues = {};
  const responses = {
    f1: [
      { name: "見積書.pdf", driveFileUrl: "https://drive.google.com/file/d/abc" },
    ],
  };

  const map = buildLabelValueMap(fieldLabels, fieldValues, responses);
  assert.equal(map["添付ファイル"], "見積書.pdf");
});

test("resolveTemplateTokens で fileUpload トークンが fieldValues の値を使う", () => {
  const template = "添付: {@添付ファイル}";
  const context = {
    labelValueMap: { "添付ファイル": "見積書, 申請書" },
  };
  assert.equal(resolveTemplateTokens(template, context), "添付: 見積書, 申請書");
});

test("resolveTemplateTokens で noext パイプが拡張子を除去する", () => {
  const template = "{@添付ファイル|noext}";
  const context = {
    labelValueMap: { "添付ファイル": "見積書.pdf, 申請書.docx" },
  };
  assert.equal(resolveTemplateTokens(template, context), "見積書, 申請書");
});

test("resolveTemplateTokens で @ なしはリテラル文字列（新仕様）", () => {
  const context = { labelValueMap: { "名前": "山田" } };
  // 新仕様: {foo} は式言語の bare word リテラルとしてそのまま出力される
  assert.equal(resolveTemplateTokens("{名前}", context), "名前");
  assert.equal(resolveTemplateTokens("{@名前}", context), "山田");
});

// ---------------------------------------------------------------------------
// @ prefix（強制フィールド参照）
// ---------------------------------------------------------------------------

test("@ プレフィックスでフィールド値を取得する", () => {
  const context = { labelValueMap: { "テスト１": "値A" } };
  assert.equal(resolveTemplateTokens("{@テスト１}", context), "値A");
});

// ---------------------------------------------------------------------------
// if パイプ変換（GAS互換）
// ---------------------------------------------------------------------------

test("if: フォールバックパターン — 値があればそのまま返す", () => {
  const context = { labelValueMap: { "テスト１": "値A", "テスト２": "値B" } };
  assert.equal(
    resolveTemplateTokens("{@テスト１|if:@テスト１,_,@テスト２}", context),
    "値A"
  );
});

test("if: フォールバックパターン — 値が空なら代替フィールドを返す", () => {
  const context = { labelValueMap: { "テスト１": "", "テスト２": "値B" } };
  assert.equal(
    resolveTemplateTokens("{@テスト１|if:@テスト１,_,@テスト２}", context),
    "値B"
  );
});

test("if: == 比較演算子", () => {
  const context = { labelValueMap: { "ステータス": "承認済" } };
  assert.equal(
    resolveTemplateTokens("{@ステータス|if:@ステータス==承認済,_,却下}", context),
    "承認済"
  );
  const context2 = { labelValueMap: { "ステータス": "保留" } };
  assert.equal(
    resolveTemplateTokens("{@ステータス|if:@ステータス==承認済,_,却下}", context2),
    "却下"
  );
});

test("if: != 比較演算子", () => {
  const context = { labelValueMap: { "値": "A" } };
  assert.equal(
    resolveTemplateTokens("{@値|if:@値!=A,_,代替}", context),
    "代替"
  );
  const context2 = { labelValueMap: { "値": "B" } };
  assert.equal(
    resolveTemplateTokens("{@値|if:@値!=A,_,代替}", context2),
    "B"
  );
});

test("if: 数値比較 (>, <)", () => {
  const context = { labelValueMap: { "スコア": "85" } };
  assert.equal(
    resolveTemplateTokens("{@スコア|if:@スコア>50,_,不合格}", context),
    "85"
  );
  const context2 = { labelValueMap: { "スコア": "30" } };
  assert.equal(
    resolveTemplateTokens("{@スコア|if:@スコア>50,_,不合格}", context2),
    "不合格"
  );
});

test("if: not 否定", () => {
  const context = { labelValueMap: { "フラグ": "" } };
  assert.equal(
    resolveTemplateTokens("{@フラグ|if:not @フラグ,_,デフォルト}", context),
    ""
  );
  const context2 = { labelValueMap: { "フラグ": "ON" } };
  assert.equal(
    resolveTemplateTokens("{@フラグ|if:not @フラグ,_,デフォルト}", context2),
    "デフォルト"
  );
});

test("if: in 演算子", () => {
  const context = { labelValueMap: { "部署": "営業部", "対象部署": "営業部,企画部,総務部" } };
  assert.equal(
    resolveTemplateTokens("{@部署|if:@部署 in @対象部署,_,対象外}", context),
    "営業部"
  );
  const context2 = { labelValueMap: { "部署": "開発部", "対象部署": "営業部,企画部,総務部" } };
  assert.equal(
    resolveTemplateTokens("{@部署|if:@部署 in @対象部署,_,対象外}", context2),
    "対象外"
  );
});

test("if: _ でパイプ値を参照", () => {
  const context = { labelValueMap: { "名前": "" } };
  assert.equal(
    resolveTemplateTokens("{@名前|if:@名前,_,_}", context),
    ""
  );
  const context2 = { labelValueMap: { "名前": "太郎" } };
  assert.equal(
    resolveTemplateTokens("{@名前|if:@名前,_,_}", context2),
    "太郎"
  );
});

test("if: ダブルクォートでリテラル文字列を指定", () => {
  const context = { labelValueMap: { "タイプ": "A" } };
  assert.equal(
    resolveTemplateTokens('{@タイプ|if:@タイプ=="A",_,Bです}', context),
    "A"
  );
  const context2 = { labelValueMap: { "タイプ": "B" } };
  assert.equal(
    resolveTemplateTokens('{@タイプ|if:@タイプ=="A",_,Bです}', context2),
    "Bです"
  );
});

// ---------------------------------------------------------------------------
// 予約トークン @ プレフィックス必須
// ---------------------------------------------------------------------------

test("{@_id} で recordId を取得する", () => {
  const context = { recordId: "rec001" };
  assert.equal(resolveTemplateTokens("{@_id}", context), "rec001");
});

test("{@_NOW} で現在日時を取得する", () => {
  const context = { now: new Date(2026, 3, 13, 10, 30, 0) };
  assert.equal(resolveTemplateTokens("{@_NOW}", context), "2026-04-13 10:30:00");
});

test("{@_NOW|time:YYYY-MM-DD} でフォーマットできる", () => {
  const context = { now: new Date(2026, 3, 13, 10, 30, 0) };
  assert.equal(resolveTemplateTokens("{@_NOW|time:YYYY-MM-DD}", context), "2026-04-13");
});

test("{@<欄>|folder_url} で欄ごとのフォルダURLを取得する", () => {
  const context = {
    fieldLabels: { f1: "添付" },
    fileUploadMeta: { f1: { folderUrl: "https://drive.google.com/drive/folders/abc" } },
  };
  assert.equal(resolveTemplateTokens("{@添付|folder_url}", context), "https://drive.google.com/drive/folders/abc");
});

test("{@<欄>|file_urls} で欄ごとのファイルURLを取得する", () => {
  const context = {
    fieldLabels: { f1: "添付" },
    fileUploadMeta: { f1: { fileUrls: ["https://drive.google.com/file/d/a", "https://drive.google.com/file/d/b"] } },
  };
  assert.equal(
    resolveTemplateTokens("{@添付|file_urls}", context),
    "https://drive.google.com/file/d/a, https://drive.google.com/file/d/b"
  );
});

test("@ なしの {_NOW} はリテラル（新仕様: @ なしは bare word）", () => {
  const context = { now: new Date(2026, 3, 13, 10, 30, 0), labelValueMap: {} };
  assert.equal(resolveTemplateTokens("{_NOW}", context), "_NOW");
});

test("@ なしの {_id} はリテラル（新仕様: @ なしは bare word）", () => {
  const context = { recordId: "rec001", labelValueMap: {} };
  assert.equal(resolveTemplateTokens("{_id}", context), "_id");
});

// ---------------------------------------------------------------------------
// if条件での予約トークン
// ---------------------------------------------------------------------------

test("if: else値に予約トークン @_form_url を使う", () => {
  const ctx = { formUrl: "https://example.com/?form=f1", labelValueMap: { "テキスト": "" } };
  assert.equal(
    resolveTemplateTokens("{@テキスト|if:@テキスト,_,@_form_url}", ctx),
    "https://example.com/?form=f1"
  );
});

// ---------------------------------------------------------------------------
// 共有エンジン経由でフロント/バック仕様を揃えたもの (以前はフロントで未実装)
// ---------------------------------------------------------------------------

test("if: 3引数 — 条件一致で真の値、不一致で偽の値", () => {
  const ctx1 = { labelValueMap: { "対応": "来庁" } };
  assert.equal(
    resolveTemplateTokens('{@対応|if:@対応=="来庁",■,□}', ctx1),
    "■"
  );
  const ctx2 = { labelValueMap: { "対応": "電話" } };
  assert.equal(
    resolveTemplateTokens('{@対応|if:@対応=="来庁",■,□}', ctx2),
    "□"
  );
});

test("if: 3引数 in 演算子でチェックボックス部分一致", () => {
  const ctx = { labelValueMap: { "結果": "記事掲載, ネット掲載" } };
  assert.equal(
    resolveTemplateTokens("{@結果|if:記事掲載 in _,■,□}", ctx),
    "■"
  );
  assert.equal(
    resolveTemplateTokens("{@結果|if:放送予定 in _,■,□}", ctx),
    "□"
  );
});

test("サブテンプレート: if 3引数の真の値位置で {...} 再帰解決", () => {
  const ctxFilled = { labelValueMap: { "報道": "記事掲載" } };
  assert.equal(
    resolveTemplateTokens("{@報道|if:_,（{@報道}）,}", ctxFilled),
    "（記事掲載）"
  );
  const ctxEmpty = { labelValueMap: { "報道": "" } };
  assert.equal(
    resolveTemplateTokens("{@報道|if:_,（{@報道}）,}", ctxEmpty),
    ""
  );
});

test("サブテンプレート: {_} でパイプ入力値をサブテンプレート内から参照", () => {
  const ctx = { labelValueMap: { "報道": "記事掲載" } };
  assert.equal(
    resolveTemplateTokens("{@報道|if:_,（{_}）,}", ctx),
    "（記事掲載）"
  );
});

test("サブテンプレート: default のフォールバック値に {...} ネスト", () => {
  const ctx = {
    now: new Date(2026, 3, 13, 10, 30, 0),
    labelValueMap: { "納期": "" }
  };
  assert.equal(
    resolveTemplateTokens("{@納期|default:未定（{@_NOW|time:M月D日}時点）}", ctx),
    "未定（4月13日時点）"
  );
});

test("replace: 値位置に , を含めても {} で誤分割されない", () => {
  const ctx = { labelValueMap: { "電話": "090-1234-5678" } };
  assert.equal(
    resolveTemplateTokens("{@電話|replace:-,}", ctx),
    "09012345678"
  );
});

// ---------------------------------------------------------------------------
// 新構文: 式言語（+ 演算子 / parseINT / parseFLOAT / quoted field / if 関数形式 / ネスト）
// ---------------------------------------------------------------------------

test("式言語: @ なし bare word はリテラル", () => {
  const ctx = { labelValueMap: {} };
  assert.equal(resolveTemplateTokens("{aaa}", ctx), "aaa");
});

test("式言語: 文字列リテラル {\"hello\"}", () => {
  const ctx = { labelValueMap: {} };
  assert.equal(resolveTemplateTokens('{"hello world"}', ctx), "hello world");
});

test("式言語: 数値リテラル {42}", () => {
  const ctx = { labelValueMap: {} };
  assert.equal(resolveTemplateTokens("{42}", ctx), "42");
  assert.equal(resolveTemplateTokens("{3.14}", ctx), "3.14");
});

test("式言語: + 演算子（両辺文字列 → 連結）", () => {
  const ctx = { labelValueMap: { "所属": "営業", "氏名": "山田" } };
  assert.equal(resolveTemplateTokens("{@所属+@氏名}", ctx), "営業山田");
});

test("式言語: {...} 内の + は常に文字列連結（数値同士でも）", () => {
  const ctx = { labelValueMap: { "年齢": "30" } };
  // 旧仕様では "31" だったが、新仕様では {...} 内の + は純粋連結
  assert.equal(resolveTemplateTokens("{{@年齢|parseINT}+1}", ctx), "301");
});

test("式言語: 数値計算は [...] で行う", () => {
  const ctx = { labelValueMap: { "年齢": "30" } };
  assert.equal(resolveTemplateTokens("[{@年齢}+1]", ctx), "31");
});

test("式言語: [...] で parseFLOAT 相当の自動変換", () => {
  const ctx = { labelValueMap: { "単価": "1.25" } };
  assert.equal(resolveTemplateTokens("[{@単価}+0.5]", ctx), "1.75");
});

test("式言語: 数値 + 文字列 → 文字列連結", () => {
  const ctx = { labelValueMap: { "年齢": "30" } };
  assert.equal(resolveTemplateTokens('{{@年齢|parseINT}+" years"}', ctx), "30 years");
});

test("式言語: ネスト {{}} で評価順を明示", () => {
  const ctx = { labelValueMap: { "a": "Hi", "b": "WORLD" } };
  assert.equal(resolveTemplateTokens("{{@a|upper}+{@b|lower}}", ctx), "HIworld");
});

test("式言語: if 関数形式 {if:cond,true,false}", () => {
  const ctx1 = { labelValueMap: { "x": "1" } };
  assert.equal(resolveTemplateTokens('{if:@x=="1",one,other}', ctx1), "one");
  const ctx2 = { labelValueMap: { "x": "2" } };
  assert.equal(resolveTemplateTokens('{if:@x=="1",one,other}', ctx2), "other");
});

test("式言語: フィールド名のダブルクォート", () => {
  const ctx = { labelValueMap: { "a+b": "plus-value", "日 本": "nihon" } };
  assert.equal(resolveTemplateTokens('{@"a+b"}', ctx), "plus-value");
  assert.equal(resolveTemplateTokens('{@"日 本"}', ctx), "nihon");
});

test("式言語: フィールド名のバックスラッシュエスケープ", () => {
  const ctx = { labelValueMap: { "a+b": "plus-value" } };
  assert.equal(resolveTemplateTokens("{@a\\+b}", ctx), "plus-value");
});

test("式言語: パース不能時は原トークンを残す + console.warn", () => {
  const ctx = { labelValueMap: { "氏名": "山田" } };
  // @氏名in 田中 は in を区切れず、in の後ろの 田中 が浮く → error
  const origWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    assert.equal(
      resolveTemplateTokens("{@氏名in 田中}", ctx),
      "{@氏名in 田中}"
    );
    assert.equal(warned, true);
  } finally {
    console.warn = origWarn;
  }
});

test("式言語: [...] atom を {...} 内で pipe チェーン可能", () => {
  const ctx = { labelValueMap: { "金額1": "1000", "金額2": "2000" } };
  assert.equal(
    resolveTemplateTokens("{[{@金額1}+{@金額2}]|number:#,##0}", ctx),
    "3,000"
  );
});

// ---------------------------------------------------------------------------
// [...] bracket expression (JavaScript 式)
// ---------------------------------------------------------------------------

test("bracket: 数値 + 数値 → 算術加算", () => {
  const ctx = { labelValueMap: { "身長": "170" } };
  assert.equal(resolveTemplateTokens("[{@身長}+4]", ctx), "174");
});

test("bracket: 四則演算すべて", () => {
  const ctx = { labelValueMap: { "a": "10", "b": "3" } };
  assert.equal(resolveTemplateTokens("[{@a}-{@b}]", ctx), "7");
  assert.equal(resolveTemplateTokens("[{@a}*{@b}]", ctx), "30");
  assert.equal(resolveTemplateTokens("[{@a}/{@b}*3]", ctx), "10");
  assert.equal(resolveTemplateTokens("[{@a}%{@b}]", ctx), "1");
  assert.equal(resolveTemplateTokens("[{@b}**2]", ctx), "9");
});

test("bracket: JS 演算子優先順位", () => {
  const ctx = { labelValueMap: { "x": "1", "y": "2" } };
  assert.equal(resolveTemplateTokens("[{@x}+{@y}*3]", ctx), "7");
});

test("bracket: 括弧で評価順指定", () => {
  const ctx = { labelValueMap: { "a": "2", "b": "3" } };
  assert.equal(resolveTemplateTokens("[({@a}+{@b})*2]", ctx), "10");
});

test("bracket: 三項演算子", () => {
  const ctx = { labelValueMap: { "age": "20" } };
  assert.equal(resolveTemplateTokens("[{@age}>=18?1:0]", ctx), "1");
});

test("bracket: 比較演算子", () => {
  const ctx = { labelValueMap: { "x": "5" } };
  assert.equal(resolveTemplateTokens("[{@x}>3]", ctx), "true");
  assert.equal(resolveTemplateTokens("[{@x}==5]", ctx), "true");
});

test("bracket: Math.* が使える", () => {
  const ctx = { labelValueMap: { "r": "2" } };
  assert.equal(
    resolveTemplateTokens("[Math.round(Math.PI*{@r}*{@r}*100)/100]", ctx),
    "12.57"
  );
});

test("bracket: ネストした [...]", () => {
  const ctx = { labelValueMap: { "x": "10" } };
  assert.equal(resolveTemplateTokens("[[{@x}+5]*2]", ctx), "30");
});

test("bracket: 文字の '1' も数値として計算", () => {
  const ctx = { labelValueMap: { "v": "1" } };
  assert.equal(resolveTemplateTokens("[{@v}+2]", ctx), "3");
});

test("bracket: 空フィールドは error → 原トークン残存", () => {
  const ctx = { labelValueMap: {} };
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(resolveTemplateTokens("[{@nope}+1]", ctx), "[{@nope}+1]");
  } finally {
    console.warn = origWarn;
  }
});

test("bracket: 非数値フィールドは error → 原トークン残存", () => {
  const ctx = { labelValueMap: { "name": "Alice" } };
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(resolveTemplateTokens("[{@name}+1]", ctx), "[{@name}+1]");
  } finally {
    console.warn = origWarn;
  }
});

test("bracket: JS 構文エラーは原トークン残存", () => {
  const ctx = { labelValueMap: {} };
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(resolveTemplateTokens("[1++2]", ctx), "[1++2]");
  } finally {
    console.warn = origWarn;
  }
});

test("bracket: 0 割りの NaN は原トークン残存", () => {
  const ctx = { labelValueMap: { "x": "0" } };
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(resolveTemplateTokens("[0/{@x}]", ctx), "[0/{@x}]");
  } finally {
    console.warn = origWarn;
  }
});

test("bracket: \\[ \\] でリテラルにエスケープ", () => {
  const ctx = { labelValueMap: {} };
  assert.equal(resolveTemplateTokens("\\[not a bracket\\]", ctx), "[not a bracket]");
});

test("bracket: トップレベル・{...} 内の両方で使える", () => {
  const ctx = { labelValueMap: { "a": "10", "b": "20" } };
  assert.equal(resolveTemplateTokens("[{@a}+{@b}]", ctx), "30");
  assert.equal(resolveTemplateTokens("合計: {[{@a}+{@b}]|number:#,##0}円", ctx), "合計: 30円");
});

test("bracket: 内側 {...} でのパイプは OK", () => {
  const ctx = { labelValueMap: { "h": " 170 " } };
  assert.equal(resolveTemplateTokens("[{@h|trim}+1]", ctx), "171");
});

test("extractFieldRefs: [...] 内の @ も拾う", () => {
  assert.deepEqual(
    pipeEngine.extractFieldRefs("[{@身長}+4] / [{@体重}*2]"),
    ["身長", "体重"]
  );
});

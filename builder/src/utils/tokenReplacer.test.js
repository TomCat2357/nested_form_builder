import assert from "node:assert/strict";
import test from "node:test";
import { buildLabelValueMap, resolveTemplateTokens } from "./tokenReplacer.js";

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

test("resolveTemplateTokens で @ なしのフィールド参照は空文字になる", () => {
  const context = { labelValueMap: { "名前": "山田" } };
  assert.equal(resolveTemplateTokens("{名前}", context), "");
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
    resolveTemplateTokens("{@テスト１|if:@テスト１,@テスト２}", context),
    "値A"
  );
});

test("if: フォールバックパターン — 値が空なら代替フィールドを返す", () => {
  const context = { labelValueMap: { "テスト１": "", "テスト２": "値B" } };
  assert.equal(
    resolveTemplateTokens("{@テスト１|if:@テスト１,@テスト２}", context),
    "値B"
  );
});

test("if: == 比較演算子", () => {
  const context = { labelValueMap: { "ステータス": "承認済" } };
  assert.equal(
    resolveTemplateTokens("{@ステータス|if:@ステータス==承認済,却下}", context),
    "承認済"
  );
  const context2 = { labelValueMap: { "ステータス": "保留" } };
  assert.equal(
    resolveTemplateTokens("{@ステータス|if:@ステータス==承認済,却下}", context2),
    "却下"
  );
});

test("if: != 比較演算子", () => {
  const context = { labelValueMap: { "値": "A" } };
  assert.equal(
    resolveTemplateTokens("{@値|if:@値!=A,代替}", context),
    "代替"
  );
  const context2 = { labelValueMap: { "値": "B" } };
  assert.equal(
    resolveTemplateTokens("{@値|if:@値!=A,代替}", context2),
    "B"
  );
});

test("if: 数値比較 (>, <)", () => {
  const context = { labelValueMap: { "スコア": "85" } };
  assert.equal(
    resolveTemplateTokens("{@スコア|if:@スコア>50,不合格}", context),
    "85"
  );
  const context2 = { labelValueMap: { "スコア": "30" } };
  assert.equal(
    resolveTemplateTokens("{@スコア|if:@スコア>50,不合格}", context2),
    "不合格"
  );
});

test("if: not 否定", () => {
  const context = { labelValueMap: { "フラグ": "" } };
  assert.equal(
    resolveTemplateTokens("{@フラグ|if:not @フラグ,デフォルト}", context),
    ""
  );
  const context2 = { labelValueMap: { "フラグ": "ON" } };
  assert.equal(
    resolveTemplateTokens("{@フラグ|if:not @フラグ,デフォルト}", context2),
    "デフォルト"
  );
});

test("if: in 演算子", () => {
  const context = { labelValueMap: { "部署": "営業部", "対象部署": "営業部,企画部,総務部" } };
  assert.equal(
    resolveTemplateTokens("{@部署|if:@部署 in @対象部署,対象外}", context),
    "営業部"
  );
  const context2 = { labelValueMap: { "部署": "開発部", "対象部署": "営業部,企画部,総務部" } };
  assert.equal(
    resolveTemplateTokens("{@部署|if:@部署 in @対象部署,対象外}", context2),
    "対象外"
  );
});

test("if: _ でパイプ値を参照", () => {
  const context = { labelValueMap: { "名前": "" } };
  assert.equal(
    resolveTemplateTokens("{@名前|if:@名前,_}", context),
    ""
  );
  const context2 = { labelValueMap: { "名前": "太郎" } };
  assert.equal(
    resolveTemplateTokens("{@名前|if:@名前,_}", context2),
    "太郎"
  );
});

test("if: ダブルクォートでリテラル文字列を指定", () => {
  const context = { labelValueMap: { "タイプ": "A" } };
  assert.equal(
    resolveTemplateTokens('{@タイプ|if:@タイプ=="A",Bです}', context),
    "A"
  );
  const context2 = { labelValueMap: { "タイプ": "B" } };
  assert.equal(
    resolveTemplateTokens('{@タイプ|if:@タイプ=="A",Bです}', context2),
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

test("@ なしの {_NOW} は予約トークンとして解決されない", () => {
  const context = { now: new Date(2026, 3, 13, 10, 30, 0), labelValueMap: {} };
  assert.equal(resolveTemplateTokens("{_NOW}", context), "");
});

test("@ なしの {_id} は予約トークンとして解決されない", () => {
  const context = { recordId: "rec001", labelValueMap: {} };
  assert.equal(resolveTemplateTokens("{_id}", context), "");
});

// ---------------------------------------------------------------------------
// if条件での予約トークン
// ---------------------------------------------------------------------------

test("if: else値に予約トークン @_form_url を使う", () => {
  const ctx = { formUrl: "https://example.com/?form=f1", labelValueMap: { "テキスト": "" } };
  assert.equal(
    resolveTemplateTokens("{@テキスト|if:@テキスト,@_form_url}", ctx),
    "https://example.com/?form=f1"
  );
});

// ---------------------------------------------------------------------------
// 共有エンジン経由でフロント/バック仕様を揃えたもの (以前はフロントで未実装)
// ---------------------------------------------------------------------------

test("ifv: 3引数版 — 条件一致で真の値、不一致で偽の値", () => {
  const ctx1 = { labelValueMap: { "対応": "来庁" } };
  assert.equal(
    resolveTemplateTokens('{@対応|ifv:@対応=="来庁",■,□}', ctx1),
    "■"
  );
  const ctx2 = { labelValueMap: { "対応": "電話" } };
  assert.equal(
    resolveTemplateTokens('{@対応|ifv:@対応=="来庁",■,□}', ctx2),
    "□"
  );
});

test("ifv: in 演算子でチェックボックス部分一致", () => {
  const ctx = { labelValueMap: { "結果": "記事掲載, ネット掲載" } };
  assert.equal(
    resolveTemplateTokens("{@結果|ifv:記事掲載 in _,■,□}", ctx),
    "■"
  );
  assert.equal(
    resolveTemplateTokens("{@結果|ifv:放送予定 in _,■,□}", ctx),
    "□"
  );
});

test("サブテンプレート: ifv の真の値位置で {...} 再帰解決", () => {
  const ctxFilled = { labelValueMap: { "報道": "記事掲載" } };
  assert.equal(
    resolveTemplateTokens("{@報道|ifv:_,（{@報道}）,}", ctxFilled),
    "（記事掲載）"
  );
  const ctxEmpty = { labelValueMap: { "報道": "" } };
  assert.equal(
    resolveTemplateTokens("{@報道|ifv:_,（{@報道}）,}", ctxEmpty),
    ""
  );
});

test("サブテンプレート: {_} でパイプ入力値をサブテンプレート内から参照", () => {
  const ctx = { labelValueMap: { "報道": "記事掲載" } };
  assert.equal(
    resolveTemplateTokens("{@報道|ifv:_,（{_}）,}", ctx),
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

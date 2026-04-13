import assert from "node:assert/strict";
import test from "node:test";
import { buildLabelValueMap, resolveTemplateTokens } from "./tokenReplacer.js";

test("buildLabelValueMap は fileUpload で fieldValues を優先する", () => {
  const schema = [
    { id: "f1", type: "fileUpload", label: "添付ファイル" },
    { id: "f2", type: "text", label: "名前" },
  ];
  const fieldLabels = { f1: "添付ファイル", f2: "名前" };
  const fieldValues = { f1: "見積書, 申請書", f2: "山田 太郎" };
  const responses = {
    f1: [
      { name: "見積書.pdf", driveFileUrl: "https://drive.google.com/file/d/abc" },
      { name: "申請書.docx", driveFileUrl: "https://drive.google.com/file/d/def" },
    ],
    f2: "山田 太郎",
  };

  const map = buildLabelValueMap(fieldLabels, fieldValues, responses, schema);
  assert.equal(map["添付ファイル"], "見積書, 申請書");
  assert.equal(map["名前"], "山田 太郎");
});

test("buildLabelValueMap は fileUpload で fieldValues がない場合 extractFileUrls にフォールバック", () => {
  const schema = [
    { id: "f1", type: "fileUpload", label: "添付ファイル" },
  ];
  const fieldLabels = { f1: "添付ファイル" };
  const fieldValues = {};
  const responses = {
    f1: [
      { name: "見積書.pdf", driveFileUrl: "https://drive.google.com/file/d/abc" },
    ],
  };

  const map = buildLabelValueMap(fieldLabels, fieldValues, responses, schema);
  assert.equal(map["添付ファイル"], "https://drive.google.com/file/d/abc");
});

test("resolveTemplateTokens で fileUpload トークンが fieldValues の値を使う", () => {
  const template = "添付: {添付ファイル}";
  const context = {
    labelValueMap: { "添付ファイル": "見積書, 申請書" },
  };
  assert.equal(resolveTemplateTokens(template, context), "添付: 見積書, 申請書");
});

test("resolveTemplateTokens で noext パイプが拡張子を除去する", () => {
  const template = "{添付ファイル|noext}";
  const context = {
    labelValueMap: { "添付ファイル": "見積書.pdf, 申請書.docx" },
  };
  assert.equal(resolveTemplateTokens(template, context), "見積書, 申請書");
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

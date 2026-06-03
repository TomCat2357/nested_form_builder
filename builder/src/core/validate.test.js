import test from "node:test";
import assert from "node:assert/strict";
import { checkNumberFieldConfig, isNumberInputDraftAllowed, validateByPattern } from "./validate.js";

test("validateByPattern は text の最大文字数制限を検証する", () => {
  const field = { type: "text", inputRestrictionMode: "maxLength", maxLength: 5 };
  assert.equal(validateByPattern(field, "abcde").ok, true);
  assert.equal(validateByPattern(field, "abcdef").code, "max_length");
});

test("validateByPattern は text の不正な正規表現設定を検出する", () => {
  const field = { type: "text", inputRestrictionMode: "pattern", pattern: "(" };
  const result = validateByPattern(field, "");
  assert.equal(result.ok, false);
  assert.equal(result.code, "pattern_invalid");
});

test("isNumberInputDraftAllowed はモードごとに入力中の文字を絞り込む", () => {
  // unrestricted（制限なし）: 小数・負数を許可
  assert.equal(isNumberInputDraftAllowed("-.5", "unrestricted"), true);
  assert.equal(isNumberInputDraftAllowed("1.", "unrestricted"), true);
  assert.equal(isNumberInputDraftAllowed("1e3", "unrestricted"), false);
  assert.equal(isNumberInputDraftAllowed("+1", "unrestricted"), false);
  // integer（整数）: 負数は可・小数は不可
  assert.equal(isNumberInputDraftAllowed("-12", "integer"), true);
  assert.equal(isNumberInputDraftAllowed("12.3", "integer"), false);
  // nonNegativeInteger / naturalNumber: マイナス・小数を入力中から弾く
  assert.equal(isNumberInputDraftAllowed("5", "nonNegativeInteger"), true);
  assert.equal(isNumberInputDraftAllowed("-5", "nonNegativeInteger"), false);
  assert.equal(isNumberInputDraftAllowed("1.2", "naturalNumber"), false);
});

test("validateByPattern は数値の形式と範囲を検証する", () => {
  const field = { type: "number", numberMode: "unrestricted", minValue: -1.5, maxValue: 2.5 };
  assert.equal(validateByPattern(field, "-.5").ok, true);
  assert.equal(validateByPattern(field, "abc").code, "number_invalid");
  assert.equal(validateByPattern(field, "-2").code, "number_min");
  assert.equal(validateByPattern(field, "3").code, "number_max");
});

test("validateByPattern は整数モードで整数のみを許可する", () => {
  const field = { type: "number", numberMode: "integer" };
  assert.equal(validateByPattern(field, "-12").ok, true);
  assert.equal(validateByPattern(field, "1.5").code, "number_integer_invalid");
  assert.equal(validateByPattern(field, "1e3").code, "number_invalid");
});

test("validateByPattern は０と自然数・自然数モードを下限で検証する", () => {
  // ０と自然数: 最小値0で整数のみ。負数は number_min、小数は number_integer_invalid。
  const nonNeg = { type: "number", numberMode: "nonNegativeInteger", minValue: 0 };
  assert.equal(validateByPattern(nonNeg, "0").ok, true);
  assert.equal(validateByPattern(nonNeg, "-1").code, "number_min");
  assert.equal(validateByPattern(nonNeg, "2.5").code, "number_integer_invalid");
  // 自然数: 最小値1。0は number_min。
  const natural = { type: "number", numberMode: "naturalNumber", minValue: 1 };
  assert.equal(validateByPattern(natural, "1").ok, true);
  assert.equal(validateByPattern(natural, "0").code, "number_min");
});

test("checkNumberFieldConfig はモード別のフィールド設定を検証する", () => {
  // 制限なし: 小数の最小/最大も可、min<=max のみ
  assert.equal(checkNumberFieldConfig({ numberMode: "unrestricted", minValue: -1.5, maxValue: 2.5 }).ok, true);
  assert.equal(checkNumberFieldConfig({ numberMode: "unrestricted", minValue: 5, maxValue: 1 }).ok, false);
  // 整数: 最小/最大は整数のみ・任意
  assert.equal(checkNumberFieldConfig({ numberMode: "integer" }).ok, true);
  assert.equal(checkNumberFieldConfig({ numberMode: "integer", minValue: 1.5 }).ok, false);
  // ０と自然数: 最小値必須・0以上の整数
  assert.equal(checkNumberFieldConfig({ numberMode: "nonNegativeInteger", minValue: 0 }).ok, true);
  assert.equal(checkNumberFieldConfig({ numberMode: "nonNegativeInteger" }).ok, false);
  assert.equal(checkNumberFieldConfig({ numberMode: "nonNegativeInteger", minValue: -1 }).ok, false);
  // 自然数: 最小値必須・1以上の整数
  assert.equal(checkNumberFieldConfig({ numberMode: "naturalNumber", minValue: 1 }).ok, true);
  assert.equal(checkNumberFieldConfig({ numberMode: "naturalNumber", minValue: 0 }).ok, false);
});

test("validateByPattern はメールアドレスの独自ルールを検証する", () => {
  const field = { type: "email" };
  const tooLong = `${"a".repeat(247)}@example.com`;

  assert.equal(validateByPattern(field, "User#1@example-domain.com").ok, true);
  assert.equal(validateByPattern(field, "ab..cd@example.com").code, "email_invalid");
  assert.equal(validateByPattern(field, "ab__cd@example.com").code, "email_invalid");
  assert.equal(validateByPattern(field, "-user@example.com").code, "email_invalid");
  assert.equal(validateByPattern(field, "user-@example.com").code, "email_invalid");
  assert.equal(validateByPattern(field, "usér@example.com").code, "email_invalid");
  assert.equal(validateByPattern(field, "user@例え.テスト").code, "email_invalid");
  assert.equal(validateByPattern(field, tooLong).code, "email_invalid");
});

test("validateByPattern は URL 形式を検証する", () => {
  const field = { type: "url" };
  assert.equal(validateByPattern(field, "https://example.com/path").ok, true);
  assert.equal(validateByPattern(field, "example.com/path").code, "url_invalid");
});

test("validateByPattern は電話番号形式を設定に応じて検証する", () => {
  const hyphenField = {
    type: "phone",
    phoneFormat: "hyphen",
    allowFixedLineOmitAreaCode: false,
    allowMobile: true,
    allowIpPhone: true,
    allowTollFree: true,
  };
  assert.equal(validateByPattern(hyphenField, "090-1234-5678").ok, true);
  assert.equal(validateByPattern(hyphenField, "09012345678").code, "phone_invalid");

  const localField = {
    type: "phone",
    phoneFormat: "plain",
    allowFixedLineOmitAreaCode: true,
    allowMobile: false,
    allowIpPhone: false,
    allowTollFree: false,
  };
  assert.equal(validateByPattern(localField, "12345678").ok, true);
  assert.equal(validateByPattern(localField, "09012345678").code, "phone_invalid");
});

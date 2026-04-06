import test from "node:test";
import assert from "node:assert/strict";
import { isNumberInputDraftAllowed, validateByPattern } from "./validate.js";

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

test("isNumberInputDraftAllowed は数値入力中に許可する文字だけを通す", () => {
  assert.equal(isNumberInputDraftAllowed("-.5", false), true);
  assert.equal(isNumberInputDraftAllowed("1.", false), true);
  assert.equal(isNumberInputDraftAllowed("1e3", false), false);
  assert.equal(isNumberInputDraftAllowed("+1", false), false);
  assert.equal(isNumberInputDraftAllowed("12.3", true), false);
});

test("validateByPattern は数値の形式と範囲を検証する", () => {
  const field = { type: "number", minValue: -1.5, maxValue: 2.5 };
  assert.equal(validateByPattern(field, "-.5").ok, true);
  assert.equal(validateByPattern(field, "abc").code, "number_invalid");
  assert.equal(validateByPattern(field, "-2").code, "number_min");
  assert.equal(validateByPattern(field, "3").code, "number_max");
});

test("validateByPattern は整数のみを検証する", () => {
  const field = { type: "number", integerOnly: true };
  assert.equal(validateByPattern(field, "-12").ok, true);
  assert.equal(validateByPattern(field, "1.5").code, "number_integer_invalid");
  assert.equal(validateByPattern(field, "1e3").code, "number_invalid");
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

import test from "node:test";
import assert from "node:assert/strict";
import { asString, asTrimmedString } from "./strings.js";

test("asString は文字列をそのまま返す", () => {
  assert.equal(asString("abc"), "abc");
  assert.equal(asString(""), "");
});

test("asString は非文字列を fallback へ畳む（既定は空文字）", () => {
  assert.equal(asString(null), "");
  assert.equal(asString(undefined), "");
  assert.equal(asString(0), "");
  assert.equal(asString(false), "");
  assert.equal(asString({}), "");
  assert.equal(asString(123, "x"), "x");
});

test("asTrimmedString は文字列を trim して返す", () => {
  assert.equal(asTrimmedString("  abc  "), "abc");
  assert.equal(asTrimmedString("abc"), "abc");
  assert.equal(asTrimmedString("   "), "");
});

test("asTrimmedString は非文字列を空文字へ畳む", () => {
  assert.equal(asTrimmedString(null), "");
  assert.equal(asTrimmedString(undefined), "");
  assert.equal(asTrimmedString(42), "");
});

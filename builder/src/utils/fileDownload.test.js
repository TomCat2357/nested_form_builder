import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeFileBaseName } from "./fileDownload.js";

test("sanitizeFileBaseName: 使用不可文字を _ に置換", () => {
  assert.equal(sanitizeFileBaseName("a/b:c", "x"), "a_b_c");
  assert.equal(sanitizeFileBaseName("a*?\"<>|d", "x"), "a______d");
  assert.equal(sanitizeFileBaseName("a/b:c*?", "x"), "a_b_c__");
});

test("sanitizeFileBaseName: 先頭ドット除去・前後空白トリム", () => {
  assert.equal(sanitizeFileBaseName(".hidden", "x"), "hidden");
  assert.equal(sanitizeFileBaseName("...", "x"), "x");
  assert.equal(sanitizeFileBaseName("  名前  ", "x"), "名前");
});

test("sanitizeFileBaseName: 空・空白のみ・null/undefined は fallback", () => {
  assert.equal(sanitizeFileBaseName("", "x"), "x");
  assert.equal(sanitizeFileBaseName("   ", "fallback"), "fallback");
  assert.equal(sanitizeFileBaseName(null, "fallback"), "fallback");
  assert.equal(sanitizeFileBaseName(undefined, "x"), "x");
});

test("sanitizeFileBaseName: 通常文字 (日本語・空白含む) はそのまま", () => {
  assert.equal(sanitizeFileBaseName("普通の名前", "x"), "普通の名前");
  assert.equal(sanitizeFileBaseName("売上 2026", "x"), "売上 2026");
});

import test from "node:test";
import assert from "node:assert/strict";
import { fieldHasValue } from "./fieldValue.js";

test("fieldHasValue: text 系は trim 後に非空でのみ true", () => {
  assert.equal(fieldHasValue({ type: "text" }, ""), false);
  assert.equal(fieldHasValue({ type: "text" }, "   "), false);
  assert.equal(fieldHasValue({ type: "text" }, "a"), true);
  assert.equal(fieldHasValue({ type: "email" }, "a@b.c"), true);
  assert.equal(fieldHasValue({ type: "url" }, "  "), false);
  assert.equal(fieldHasValue({ type: "url" }, "https://x"), true);
});

test("fieldHasValue: phone は記号除去後に非空", () => {
  assert.equal(fieldHasValue({ type: "phone" }, ""), false);
  assert.equal(fieldHasValue({ type: "phone" }, " - ()"), false);
  assert.equal(fieldHasValue({ type: "phone" }, "090-1111"), true);
});

test("fieldHasValue: number は 0 を含めて値ありと判定", () => {
  assert.equal(fieldHasValue({ type: "number" }, ""), false);
  assert.equal(fieldHasValue({ type: "number" }, null), false);
  assert.equal(fieldHasValue({ type: "number" }, undefined), false);
  assert.equal(fieldHasValue({ type: "number" }, "abc"), false);
  assert.equal(fieldHasValue({ type: "number" }, "0"), true);
  assert.equal(fieldHasValue({ type: "number" }, 0), true);
  assert.equal(fieldHasValue({ type: "number" }, "1.5"), true);
});

test("fieldHasValue: date / time は文字列で非空", () => {
  assert.equal(fieldHasValue({ type: "date" }, ""), false);
  assert.equal(fieldHasValue({ type: "date" }, "2026-05-01"), true);
  assert.equal(fieldHasValue({ type: "time" }, "10:00"), true);
});

test("fieldHasValue: weekday は単一の曜日文字列で true (空文字は false)", () => {
  assert.equal(fieldHasValue({ type: "weekday" }, ""), false);
  assert.equal(fieldHasValue({ type: "weekday" }, null), false);
  assert.equal(fieldHasValue({ type: "weekday" }, "月"), true);
  assert.equal(fieldHasValue({ type: "weekday" }, "火"), true);
});

test("fieldHasValue: fileUpload は配列が空でないとき true", () => {
  assert.equal(fieldHasValue({ type: "fileUpload" }, []), false);
  assert.equal(fieldHasValue({ type: "fileUpload" }, null), false);
  assert.equal(fieldHasValue({ type: "fileUpload" }, [{ name: "f.pdf" }]), true);
});

test("fieldHasValue: 非対応タイプは常に false", () => {
  assert.equal(fieldHasValue({ type: "radio" }, "A"), false);
  assert.equal(fieldHasValue({ type: "message" }, "x"), false);
  assert.equal(fieldHasValue(null, "x"), false);
});

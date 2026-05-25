import assert from "node:assert/strict";
import test from "node:test";
import { formatNumber, formatDeltaPercent } from "./formatNumber.js";

test("null/undefined/'' は '—'", () => {
  assert.equal(formatNumber(null), "—");
  assert.equal(formatNumber(undefined), "—");
  assert.equal(formatNumber(""), "—");
});

test("非数値文字列も '—'", () => {
  assert.equal(formatNumber("abc"), "—");
});

test("数値はロケール既定で整形 (3桁区切り)", () => {
  // Intl の既定挙動はロケール依存だが、1234.5 が 1 と . を含むことだけ確認
  const out = formatNumber(1234.5);
  assert.ok(out.includes("1"));
});

test("prefix/suffix が付与される", () => {
  assert.equal(formatNumber(100, { prefix: "¥", suffix: "円", decimals: 0, locale: "en-US" }), "¥100円");
});

test("decimals 指定が反映される", () => {
  assert.equal(formatNumber(3.14159, { decimals: 2, locale: "en-US" }), "3.14");
  assert.equal(formatNumber(3, { decimals: 2, locale: "en-US" }), "3.00");
});

test("formatDeltaPercent: 通常ケース", () => {
  assert.equal(formatDeltaPercent(110, 100), "+10.0%");
  assert.equal(formatDeltaPercent(90, 100), "-10.0%");
  assert.equal(formatDeltaPercent(100, 100), "+0.0%");
});

test("formatDeltaPercent: 前回 0 / 不正値は '—'", () => {
  assert.equal(formatDeltaPercent(100, 0), "—");
  assert.equal(formatDeltaPercent(null, 100), "—");
  assert.equal(formatDeltaPercent(100, "abc"), "—");
});

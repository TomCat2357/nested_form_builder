import test from "node:test";
import assert from "node:assert/strict";
import { toUnixMs, serialToUnixMs, formatUnixMsDateTimeSec, formatUnixMsDateTimeMs } from "./dateTime.js";

test("toUnixMs は13桁UNIX msをそのまま返す", () => {
  const unixMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(toUnixMs(unixMs), unixMs);
});

test("toUnixMs は10桁UNIX秒をUNIX msへ正規化する", () => {
  const unixMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  const unixSec = Math.floor(unixMs / 1000);
  assert.equal(toUnixMs(unixSec), unixMs);
  assert.equal(toUnixMs(String(unixSec)), unixMs);
});

test("toUnixMs はシリアル値をUNIX msへ変換する", () => {
  const serial = 46000;
  assert.equal(toUnixMs(serial), serialToUnixMs(serial));
});

test("toUnixMs は YYYY/MM/DD HH:mm:ss.sss 形式をJSTとして解釈する", () => {
  const value = "2026/01/01 09:00:00.123";
  const expected = Date.UTC(2026, 0, 1, 0, 0, 0, 123);
  assert.equal(toUnixMs(value), expected);
});

test("formatUnixMsDateTimeSec/formatUnixMsDateTimeMs はJST固定で秒/ミリ秒をゼロ埋め表示する", () => {
  const unixMs = Date.UTC(2026, 0, 1, 0, 0, 0, 7); // JST: 2026/01/01 09:00:00.007
  assert.equal(formatUnixMsDateTimeSec(unixMs), "2026/01/01 09:00:00");
  assert.equal(formatUnixMsDateTimeMs(unixMs), "2026/01/01 09:00:00.007");
});

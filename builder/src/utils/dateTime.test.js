import test from "node:test";
import assert from "node:assert/strict";
import {
  toUnixMs,
  serialToUnixMs,
  formatUnixMsDateTimeSec,
  formatUnixMsDateTimeMs,
  toStrictUnixMs,
  resolveStrictUnixMs,
} from "./dateTime.js";

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

test("toStrictUnixMs は13桁のUnix msをそのまま返す", () => {
  const unixMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(toStrictUnixMs(unixMs), unixMs);
});

test("toStrictUnixMs は12桁のUnix ms（境界値以上）を通す", () => {
  // 1e11 = 1973-03-03 ごろ。境界値は inclusive
  assert.equal(toStrictUnixMs(100000000000), 100000000000);
  // 1桁削った値（≈1.74e11、1975年頃）も ms としてそのまま
  assert.equal(toStrictUnixMs(174608640000), 174608640000);
});

test("toStrictUnixMs は10〜11桁の値（Unix秒相当）を null にする（×1000 への再解釈をしない）", () => {
  assert.equal(toStrictUnixMs(99999999999), null); // 1e11 未満
  assert.equal(toStrictUnixMs(1746086400), null); // Unix 秒
  assert.equal(toStrictUnixMs(17460864000), null);
});

test("toStrictUnixMs は1〜9桁の値（Excel シリアル値相当）を null にする", () => {
  assert.equal(toStrictUnixMs(46000), null); // serial 値相当
  assert.equal(toStrictUnixMs(17460864), null); // 5桁削った値
  assert.equal(toStrictUnixMs(1), null);
  assert.equal(toStrictUnixMs(0), null);
});

test("toStrictUnixMs は Date オブジェクトをそのまま getTime() で返す", () => {
  const d = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
  assert.equal(toStrictUnixMs(d), d.getTime());
});

test("toStrictUnixMs は ISO/YYYY-MM-DD 文字列を ms に変換する", () => {
  const expected = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(toStrictUnixMs("2026-01-01T00:00:00.000Z"), expected);
  // 数字のみの文字列は数値ルールで判定される
  assert.equal(toStrictUnixMs(String(expected)), expected);
  assert.equal(toStrictUnixMs("17460864"), null);
});

test("toStrictUnixMs は不正値・空文字・null・undefined を null にする", () => {
  assert.equal(toStrictUnixMs(null), null);
  assert.equal(toStrictUnixMs(undefined), null);
  assert.equal(toStrictUnixMs(""), null);
  assert.equal(toStrictUnixMs("   "), null);
  assert.equal(toStrictUnixMs("not a date"), null);
  assert.equal(toStrictUnixMs(NaN), null);
});

test("resolveStrictUnixMs は最初に Unix ms 範囲に該当する候補を返す", () => {
  const expected = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(resolveStrictUnixMs(null, undefined, "", expected), expected);
  // サブ閾値の値は通らずに次の候補へ
  assert.equal(resolveStrictUnixMs(17460864, expected), expected);
  assert.equal(resolveStrictUnixMs(17460864, "not a date"), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { toUnixMs, serialToUnixMs } from "./dateTime.js";

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


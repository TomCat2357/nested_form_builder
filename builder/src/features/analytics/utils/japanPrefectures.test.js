import assert from "node:assert/strict";
import test from "node:test";
import { JAPAN_PREFECTURES, findPrefecture, countPrefectureMatches } from "./japanPrefectures.js";

test("47 都道府県すべて含む", () => {
  assert.equal(JAPAN_PREFECTURES.length, 47);
});

test("各 prefecture に code/name/region/lat/lng がある", () => {
  for (const p of JAPAN_PREFECTURES) {
    assert.ok(p.code && p.name && p.region);
    assert.ok(Number.isFinite(p.lat));
    assert.ok(Number.isFinite(p.lng));
  }
});

test("findPrefecture: 完全一致", () => {
  const p = findPrefecture("東京都");
  assert.equal(p.code, "13");
});

test("findPrefecture: 省略名 (都道府県を取り除いた形)", () => {
  assert.equal(findPrefecture("東京").code, "13");
  assert.equal(findPrefecture("北海道").code, "01");
  assert.equal(findPrefecture("大阪").code, "27");
});

test("findPrefecture: 一致しないと null", () => {
  assert.equal(findPrefecture("不存在"), null);
  assert.equal(findPrefecture(""), null);
  assert.equal(findPrefecture(null), null);
});

test("countPrefectureMatches: 件数をカウント", () => {
  const rows = [
    { p: "東京都" },
    { p: "大阪" },
    { p: "海外" },
    { p: null },
  ];
  assert.equal(countPrefectureMatches(rows, "p"), 2);
});

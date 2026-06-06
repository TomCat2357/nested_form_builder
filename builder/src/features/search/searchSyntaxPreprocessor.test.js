import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeFullWidthSearchOperators,
  SQL_MODE_RE,
} from "./searchSyntaxPreprocessor.js";

test("normalizeFullWidthSearchOperators: 記号一式を半角化しクォート内は保護", () => {
  assert.equal(
    normalizeFullWidthSearchOperators("年齢 ＞＝ 20 ＜ 30 ！＝ 40 ：（，）"),
    "年齢 >= 20 < 30 != 40 :(,)"
  );
  assert.equal(normalizeFullWidthSearchOperators('氏名＝"田中：太郎"'), '氏名="田中：太郎"');
  assert.equal(normalizeFullWidthSearchOperators("氏名＝'田中：太郎'"), "氏名='田中：太郎'");
});

test("SQL_MODE_RE: 先頭 SELECT（大小無視・先頭空白許容）だけ SQL モード判定", () => {
  assert.ok(SQL_MODE_RE.test("SELECT * FROM _"));
  assert.ok(SQL_MODE_RE.test("  select [id] from _"));
  assert.ok(!SQL_MODE_RE.test("田中"));
  assert.ok(!SQL_MODE_RE.test("年齢 >= 20"));
  // 旧厳密モードのプレフィックスは SQL モードではない（素の簡易検索テキスト扱い）。
  assert.ok(!SQL_MODE_RE.test("WHERE 年齢 >= 20"));
  assert.ok(!SQL_MODE_RE.test("SEARCH 氏名 = '田中'"));
});

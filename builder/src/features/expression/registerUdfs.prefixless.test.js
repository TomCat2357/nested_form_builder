import assert from "node:assert/strict";
import test from "node:test";
import { ensureNfbUdfsRegistered } from "./registerNfbUdfs.js";

function setup() {
  const alasql = { fn: {} };
  ensureNfbUdfsRegistered(alasql);
  return alasql.fn;
}

test("TIME: canonical な HH:mm:ss.sss 文字列を返す（datetime からは時刻成分のみ、ms までゼロ埋め）", () => {
  const fn = setup().TIME;
  assert.equal(fn("2025-05-06 14:35:48"), "14:35:48.000");
  // Date リテラルは JST 解釈で固定する（`new Date(2024, 5, 1, 9, 0, 0)` は
  // 実行環境 TZ に依存して別の瞬間を指してしまうので、TZ 指定子付き ISO で渡す）。
  assert.equal(fn(new Date("2024-06-01T09:00:00+09:00")), "09:00:00.000");
  assert.equal(fn("13:01"), "13:01:00.000");
  // 文字列なので `=` 比較がそのまま機能
  assert.strictEqual(fn("2025-05-06 14:35:48"), fn("1980-01-01 14:35:48"));
  assert.equal(fn(null), null);
  assert.equal(fn(""), null);
  assert.equal(fn("not a date"), null);
});

test("DATE2ERA: 日付のみ・元年表記（ゼロパディングなし）", () => {
  const fn = setup().DATE2ERA;
  assert.equal(fn("2019-05-01"), "令和元年5月1日");
  assert.equal(fn("1989-01-08"), "平成元年1月8日");
  // 改元前日は前元号
  assert.equal(fn("2019-04-30"), "平成31年4月30日");
  // 時刻成分は削除
  assert.equal(fn("2025-05-06 14:35:48"), "令和7年5月6日");
  assert.equal(fn(null), null);
  assert.equal(fn(""), null);
  assert.equal(fn("not a date"), null);
});

test("DATETIME2ERATIME: 和暦 + 時/分/秒（漢字・2 桁パディング・常に表示）", () => {
  const fn = setup().DATETIME2ERATIME;
  assert.equal(fn("2025-05-06 14:35:48"), "令和7年5月6日 14時35分48秒");
  assert.equal(fn("2019-05-01"), "令和元年5月1日 00時00分00秒");
  assert.equal(fn(null), null);
  assert.equal(fn(""), null);
});

test("ERA2DATE: 和暦文字列 → YYYY-MM-DD（時刻は削除）", () => {
  const fn = setup().ERA2DATE;
  assert.equal(fn("令和7年5月6日"), "2025-05-06");
  assert.equal(fn("令和7年5月6日 14:35:48"), "2025-05-06");
  assert.equal(fn("令和元年5月1日"), "2019-05-01");
  assert.equal(fn("R7.5.6"), "2025-05-06");
  assert.equal(fn("H元.1.8"), "1989-01-08");
  assert.equal(fn("S40-1-1"), "1965-01-01");
  assert.equal(fn("R070506"), "2025-05-06");
  assert.equal(fn(null), null);
  assert.equal(fn(""), null);
  assert.equal(fn("not era"), null);
});

test("ERATIME2DATETIME: 和暦文字列 → YYYY-MM-DD_HH:mm:ss.SSS（部分時刻も解釈。DATETIME canonical なのでアンダースコアと ms）", () => {
  const fn = setup().ERATIME2DATETIME;
  assert.equal(fn("令和7年5月6日 14:35:48"), "2025-05-06_14:35:48.000");
  assert.equal(fn("令和7年5月6日 14時35分48秒"), "2025-05-06_14:35:48.000");
  assert.equal(fn("令和元年02月4日 13時"), "2019-02-04_13:00:00.000");
  assert.equal(fn("令和元年5月1日"), "2019-05-01_00:00:00.000");
  // === 互換: 同じ canonical 文字列
  assert.strictEqual(fn("令和7年5月6日"), fn("R7.5.6"));
  assert.equal(fn(null), null);
  assert.equal(fn("not era"), null);
});

test("新 UDF も idempotent: 二度呼んで上書きされない", () => {
  const alasql = { fn: {} };
  ensureNfbUdfsRegistered(alasql);
  const ref = alasql.fn.TIME;
  ensureNfbUdfsRegistered(alasql);
  assert.equal(alasql.fn.TIME, ref);
});

test("Plan P5 完了後: NFB_* は登録されておらず、prefix-less 名のみ存在する", () => {
  const fn = setup();
  // 旧 NFB_* は完全削除
  assert.equal(typeof fn.NFB_LIKE_ANY, "undefined");
  assert.equal(typeof fn.NFB_PARSE_DATE, "undefined");
  assert.equal(typeof fn.NFB_TIME_FORMAT, "undefined");
  assert.equal(typeof fn.NFB_NUMBER_FORMAT, "undefined");
  assert.equal(typeof fn.NFB_KANA, "undefined");
  assert.equal(typeof fn.NFB_ZEN, "undefined");
  assert.equal(typeof fn.NFB_HAN, "undefined");
  assert.equal(typeof fn.NFB_NOEXT, "undefined");
  // PARSE_DATE / PAD_LEFT / PAD_RIGHT も削除済み
  assert.equal(typeof fn.PARSE_DATE, "undefined");
  assert.equal(typeof fn.PAD_LEFT, "undefined");
  assert.equal(typeof fn.PAD_RIGHT, "undefined");
  // 廃止 / 改名された日付 UDF
  assert.equal(typeof fn.DATE_BIN, "undefined");
  assert.equal(typeof fn.TIME_SECONDS, "undefined");
  assert.equal(typeof fn.DATETIME2ERA, "undefined");
  assert.equal(typeof fn.ERA2DATETIME, "undefined");
  // 廃止された正規表現 UDF（PR #164 後継: 自前は REGEXP_MATCH / REGEXP_REPLACE の 2 つだけ）
  assert.equal(typeof fn.REGEX_TEST, "undefined");
  assert.equal(typeof fn.REGEX_MATCH, "undefined");
  assert.equal(typeof fn.REGEX_EXTRACT, "undefined");
  assert.equal(typeof fn.REGEX_EXTRACT_ALL, "undefined");
  // REGEXP_LIKE は AlaSQL ネイティブで提供されるため自前登録しない
  assert.equal(typeof fn.REGEXP_LIKE, "undefined");
  // 残っている prefix-less 正規表現 UDF
  assert.equal(typeof fn.REGEXP_MATCH, "function");
  assert.equal(typeof fn.REGEXP_REPLACE, "function");
  // prefix-less は登録済み
  assert.equal(typeof fn.LIKE_ANY, "function");
  assert.equal(typeof fn.DATE, "function");
  assert.equal(typeof fn.DATETIME, "function");
  assert.equal(typeof fn.TIME, "function");
  assert.equal(typeof fn.TIMESTAMP, "function");
  assert.equal(typeof fn.TIME_FORMAT, "function");
  assert.equal(typeof fn.DATE2ERA, "function");
  assert.equal(typeof fn.DATETIME2ERATIME, "function");
  assert.equal(typeof fn.ERA2DATE, "function");
  assert.equal(typeof fn.ERATIME2DATETIME, "function");
  assert.equal(typeof fn.YEAR, "function");
  assert.equal(typeof fn.MONTH, "function");
  assert.equal(typeof fn.DAY, "function");
  assert.equal(typeof fn.HOUR, "function");
  assert.equal(typeof fn.MINUTE, "function");
  assert.equal(typeof fn.SECOND, "function");
  assert.equal(typeof fn.NUMBER_FORMAT, "function");
  assert.equal(typeof fn.KANA, "function");
  assert.equal(typeof fn.ZEN, "function");
  assert.equal(typeof fn.HAN, "function");
  assert.equal(typeof fn.NOEXT, "function");
  assert.equal(typeof fn.FILE_NAMES, "function");
  assert.equal(typeof fn.FILE_URLS, "function");
  assert.equal(typeof fn.FOLDER_NAME, "function");
  assert.equal(typeof fn.FOLDER_URL, "function");
});

test("prefix-less UDF が実関数として動く", () => {
  const fn = setup();
  // LIKE_ANY
  assert.equal(fn.LIKE_ANY("田中", "山田", "田中の備考"), true);
  // DATE → canonical 文字列
  assert.equal(fn.DATE("2025-01-15T00:00:00Z"), "2025-01-15");
  // KANA
  assert.equal(fn.KANA("あいう"), "アイウ");
  // NUMBER_FORMAT
  assert.equal(fn.NUMBER_FORMAT(1234567, "#,##0"), "1,234,567");
});

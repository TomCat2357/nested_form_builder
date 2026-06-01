import assert from "node:assert/strict";
import test from "node:test";
import { ensureNfbUdfsRegistered } from "./registerNfbUdfs.js";

function setup() {
  const alasql = { fn: {} };
  ensureNfbUdfsRegistered(alasql);
  return alasql.fn;
}

test("KANA: ひらがな → カタカナ", () => {
  const fn = setup().KANA;
  assert.equal(fn("あいうえお"), "アイウエオ");
  assert.equal(fn("たなか たろう"), "タナカ タロウ");
  assert.equal(fn("Hello"), "Hello");
  assert.equal(fn(""), "");
  assert.equal(fn(null), "");
});

test("ZEN: 半角 → 全角", () => {
  const fn = setup().ZEN;
  assert.equal(fn("ABC"), "ＡＢＣ");
  assert.equal(fn("123"), "１２３");
  assert.equal(fn("ｱｲｳ"), "アイウ");
  assert.equal(fn("ｶﾞｷﾞｸﾞ"), "ガギグ");  // 濁点合成
  assert.equal(fn("ﾊﾟﾋﾟﾌﾟ"), "パピプ");  // 半濁点合成
});

test("HAN: 全角 → 半角", () => {
  const fn = setup().HAN;
  assert.equal(fn("ＡＢＣ"), "ABC");
  assert.equal(fn("１２３"), "123");
  assert.equal(fn("アイウ"), "ｱｲｳ");
  assert.equal(fn("ガギグ"), "ｶﾞｷﾞｸﾞ");
});

test("NUMBER_FORMAT: 千区切り + 小数", () => {
  const fn = setup().NUMBER_FORMAT;
  assert.equal(fn(1234567, "#,##0"), "1,234,567");
  assert.equal(fn(1234.5, "#,##0.00"), "1,234.50");
  assert.equal(fn(-1234, "#,##0"), "-1,234");
  assert.equal(fn(0, "#,##0"), "0");
  assert.equal(fn("3.14", "#,##0.00"), "3.14");
  assert.equal(fn(1000, "$#,##0"), "$1,000");
  assert.equal(fn(1000, "#,##0円"), "1,000円");
});

test("NUMBER_FORMAT: 不正値はそのまま", () => {
  const fn = setup().NUMBER_FORMAT;
  assert.equal(fn("abc", "#,##0"), "abc");
  assert.equal(fn("", "#,##0"), "");
  assert.equal(fn(null, "#,##0"), "");
});

test("TIME_FORMAT: ISO 文字列", () => {
  const fn = setup().TIME_FORMAT;
  assert.equal(fn("2025-05-05", "YYYY/MM/DD"), "2025/05/05");
  assert.equal(fn("2025-05-05", "YYYY年MM月DD日"), "2025年05月05日");
});

test("TIME_FORMAT: 和暦 + 曜日", () => {
  const fn = setup().TIME_FORMAT;
  // 2025-05-05 (月) は令和7年
  assert.equal(fn("2025-05-05", "ggee年MM月DD日(ddd)"), "令和07年05月05日(月)");
  assert.equal(fn("2025-05-05", "gge年(dddd)"), "令和7年(月曜日)");
});

test("TIME_FORMAT: 時刻フォーマット", () => {
  const fn = setup().TIME_FORMAT;
  assert.equal(fn("2025-05-05T14:30:45", "HH:mm:ss"), "14:30:45");
  assert.equal(fn("14:30", "HH:mm"), "14:30");
});

test("TIME_FORMAT: TZ 指定子付き ISO はその時差を考慮（→ JST 壁時計）。指定子なしは JST 壁時計のまま", () => {
  const fn = setup().TIME_FORMAT;
  // UTC 05:35:48 = JST 14:35:48
  assert.equal(fn("2026-05-06T05:35:48Z", "YYYY-MM-DD HH:mm:ss"), "2026-05-06 14:35:48");
  assert.equal(fn("2026-05-06T14:35:48+09:00", "YYYY-MM-DD HH:mm:ss"), "2026-05-06 14:35:48");
  assert.equal(fn("2026-05-06T00:35:48-05:00", "HH:mm:ss"), "14:35:48");
  // 指定子なしは壁時計をそのまま
  assert.equal(fn("2026-05-06T05:35:48", "HH:mm:ss"), "05:35:48");
});

test("DATE / DATETIME / TIMESTAMP: TZ 指定子付き ISO はその時差を考慮", () => {
  const fn = setup();
  assert.equal(fn.DATETIME("2026-05-06T05:35:48Z"), "2026-05-06_14:35:48.000");
  assert.equal(fn.DATETIME("2026-05-06T14:35:48+09:00"), "2026-05-06_14:35:48.000");
  assert.equal(fn.DATETIME("2026-05-06T14:35:48"), "2026-05-06_14:35:48.000"); // 指定子なし = JST 壁時計
  assert.equal(fn.DATE("2026-05-05T20:00:00Z"), "2026-05-06"); // UTC 5/5 20:00 = JST 5/6 05:00
  assert.equal(fn.TIMESTAMP("2026-05-06T05:35:48Z"), Date.UTC(2026, 4, 6, 5, 35, 48));
  assert.equal(fn.TIMESTAMP("2026-05-06T14:35:48+09:00"), Date.UTC(2026, 4, 6, 5, 35, 48));
});

test("TIME_FORMAT: 不正値は文字列化して返す", () => {
  const fn = setup().TIME_FORMAT;
  assert.equal(fn("not a date", "YYYY"), "not a date");
  assert.equal(fn(null, "YYYY"), "");
  assert.equal(fn("", "YYYY"), "");
});

test("NOEXT: 拡張子除去", () => {
  const fn = setup().NOEXT;
  assert.equal(fn("見積書.pdf"), "見積書");
  assert.equal(fn("a.pdf, b.docx, c"), "a, b, c");
  assert.equal(fn(".hidden"), ".hidden"); // 先頭ドットは保持
  assert.equal(fn(""), "");
});

// STR_LEFT / STR_RIGHT / STR_DEFAULT は alasql 予約語（LEFT/RIGHT JOIN・DEFAULT VALUES）
// 回避のためのリネーム先 UDF。式中の LEFT()/RIGHT()/DEFAULT() は preprocessAlaSqlExpression が
// これらに書き換える。
test("STR_DEFAULT: 空値フォールバック（式中の DEFAULT() のリネーム先）", () => {
  const fn = setup().STR_DEFAULT;
  assert.equal(fn("値あり", "default"), "値あり");
  assert.equal(fn("", "default"), "default");
  assert.equal(fn(null, "default"), "default");
  assert.equal(fn(undefined, "default"), "default");
  assert.equal(fn(0, "default"), 0); // 0 は値あり扱い
});

test("STR_LEFT / STR_RIGHT: 先頭/末尾 n 文字（式中の LEFT()/RIGHT() のリネーム先）", () => {
  const fn = setup();
  assert.equal(fn.STR_LEFT("あいうえお", 3), "あいう");
  assert.equal(fn.STR_LEFT("abc", 10), "abc");
  assert.equal(fn.STR_LEFT(null, 3), null);
  assert.equal(fn.STR_RIGHT("あいうえお", 2), "えお");
  assert.equal(fn.STR_RIGHT("abc", 10), "abc");
  assert.equal(fn.STR_RIGHT("abc", 0), "");
  assert.equal(fn.STR_RIGHT(null, 2), null);
});

test("LPAD / RPAD: 左/右パディング（alasql 4.x 本体に無いので UDF として登録）", () => {
  const fn = setup();
  assert.equal(fn.LPAD("5", 4, "0"), "0005");
  assert.equal(fn.LPAD("5", 3, " "), "  5");
  assert.equal(fn.LPAD("abcde", 3, "0"), "abcde"); // 既に長い → そのまま
  assert.equal(fn.RPAD("5", 3, "*"), "5**");
  // 旧 PAD_LEFT / PAD_RIGHT は廃止（gas/adminMigrations.gs が LPAD/RPAD に移行）
  assert.equal(typeof fn.PAD_LEFT, "undefined");
  assert.equal(typeof fn.PAD_RIGHT, "undefined");
});

test("REGEXP_MATCH: 2/3 引数互換（旧 REGEX_MATCH 相当）", () => {
  const fn = setup().REGEXP_MATCH;
  assert.equal(fn("田中太郎", "(田中)(.+)", 1), "田中");
  assert.equal(fn("田中太郎", "(田中)(.+)", 2), "太郎");
  assert.equal(fn("田中太郎", "(田中)(.+)", 0), "田中太郎");
  // groupIdx 省略時は 0 = fullMatch（括弧の有無による自動分岐は廃止）
  assert.equal(fn("田中太郎", "(田中)(.+)"), "田中太郎");
  assert.equal(fn("田中太郎", "田.*"), "田中太郎");
  // 非マッチ・不正パターンは空文字
  assert.equal(fn("田中太郎", "no-match"), "");
  assert.equal(fn("田中太郎", "[invalid"), "");
});

test("FILE_NAMES: 配列からファイル名を結合", () => {
  const fn = setup().FILE_NAMES;
  assert.equal(fn([{ name: "a.pdf" }, { name: "b.docx" }]), "a.pdf, b.docx");
  assert.equal(fn([]), "");
  assert.equal(fn(null), "");
  assert.equal(fn("既に文字列"), "既に文字列"); // 文字列フォールバック
});

test("FILE_URLS: driveFileUrl を結合", () => {
  const fn = setup().FILE_URLS;
  assert.equal(
    fn([
      { name: "a.pdf", driveFileUrl: "https://drive/a" },
      { name: "b.pdf", driveFileUrl: "https://drive/b" },
    ]),
    "https://drive/a, https://drive/b"
  );
  assert.equal(fn([{ name: "no-url.pdf" }]), "");
});

test("FOLDER_NAME / FOLDER_URL: 最初に見つかったメタを返す", () => {
  const fnName = setup().FOLDER_NAME;
  const fnUrl = setup().FOLDER_URL;
  const list = [
    { name: "a.pdf" }, // folderName/folderUrl なし
    { name: "b.pdf", folderName: "親フォルダ", folderUrl: "https://drive/folder" },
  ];
  assert.equal(fnName(list), "親フォルダ");
  assert.equal(fnUrl(list), "https://drive/folder");
  assert.equal(fnName({ folderName: "single" }), "single");
  assert.equal(fnName(null), "");
});

// ============================================================================
// 和暦変換 UDF（DATE2ERA / DATETIME2ERATIME / ERA2DATE / ERATIME2DATETIME）
// ============================================================================

test("DATE2ERA: ゼロパディングなし和暦（時刻は削除、令和1年→令和元年）", () => {
  const fn = setup().DATE2ERA;
  assert.equal(fn("2019-05-01"), "令和元年5月1日");
  assert.equal(fn("2020-04-15 10:00:00"), "令和2年4月15日");
  assert.equal(fn("2025-05-05"), "令和7年5月5日");
  assert.equal(fn("1989-01-08"), "平成元年1月8日");
  assert.equal(fn("1989-01-07"), "昭和64年1月7日");
  // 明治より前 / 不正は null
  assert.equal(fn("1800-01-01"), null);
  assert.equal(fn(""), null);
  assert.equal(fn("13:01:00"), null); // TIME-only は暦日を持たない
});

test("DATETIME2ERATIME: 和暦 + 時/分/秒（時刻 2 桁パディング、常に表示）", () => {
  const fn = setup().DATETIME2ERATIME;
  assert.equal(fn("2020-04-15 10:22:00"), "令和2年4月15日 10時22分00秒");
  assert.equal(fn("2020-04-15"), "令和2年4月15日 00時00分00秒"); // 時刻が無くても表示
  assert.equal(fn("2019-05-01 09:05:03"), "令和元年5月1日 09時05分03秒");
  assert.equal(fn(""), null);
});

test("ERA2DATE: 和暦 → YYYY-MM-DD（DATE2ERA の逆。02月/2月・令和1年/令和元年）", () => {
  const fn = setup().ERA2DATE;
  assert.equal(fn("令和元年5月1日"), "2019-05-01");
  assert.equal(fn("令和1年05月1日"), "2019-05-01");
  assert.equal(fn("令和2年4月15日 10時22分00秒"), "2020-04-15"); // 時刻は削除
  assert.equal(fn("R7.5.6"), "2025-05-06");
  assert.equal(fn("令和2年"), "2020-01-01"); // 月日省略は 1
  assert.equal(fn("nope"), null);
  assert.equal(fn(""), null);
});

test("ERATIME2DATETIME: 和暦 → YYYY-MM-DD_HH:mm:ss.SSS（部分時刻も解釈。戻り値は DATETIME canonical なのでアンダースコアと ms）", () => {
  const fn = setup().ERATIME2DATETIME;
  assert.equal(fn("令和元年02月4日 13時"), "2019-02-04_13:00:00.000");
  assert.equal(fn("令和2年4月15日 10時22分00秒"), "2020-04-15_10:22:00.000");
  assert.equal(fn("令和7年5月6日 14:35:48"), "2025-05-06_14:35:48.000");
  assert.equal(fn("令和元年5月1日"), "2019-05-01_00:00:00.000");
  assert.equal(fn("nope"), null);
});

// ============================================================================
// YEAR / MONTH / DAY / HOUR / MINUTE / SECOND（override）
// ============================================================================

test("YEAR/MONTH/DAY/HOUR/MINUTE/SECOND: canonical 文字列 / msunixtime / TIME-only", () => {
  const fn = setup();
  assert.equal(fn.YEAR("2020-04-15"), 2020);
  assert.equal(fn.MONTH("2020-04-15"), 4);
  assert.equal(fn.DAY("2020-04-15"), 15);
  assert.equal(fn.HOUR("2020-04-15 10:22:33"), 10);
  assert.equal(fn.MINUTE("2020-04-15 10:22:33"), 22);
  assert.equal(fn.SECOND("2020-04-15 10:22:33"), 33);
  // date-only 文字列の時刻成分は 0
  assert.equal(fn.HOUR("2020-04-15"), 0);
  // TIME-only: 暦日成分は null、時刻は取れる
  assert.equal(fn.YEAR("13:01:05"), null);
  assert.equal(fn.MONTH("13:01:05"), null);
  assert.equal(fn.HOUR("13:01:05"), 13);
  assert.equal(fn.MINUTE("13:01:05"), 1);
  assert.equal(fn.SECOND("13:01:05"), 5);
  // msunixtime: SECOND はミリ秒成分で小数になる
  const ms = Date.UTC(2026, 0, 1, 0, 0, 20, 123); // JST: 09:00:20.123
  assert.ok(Math.abs(fn.SECOND(ms) - 20.123) < 1e-6);
  assert.equal(fn.HOUR(ms), 9);
  assert.equal(fn.YEAR(ms), 2026);
  // 不正値は null
  assert.equal(fn.YEAR("not a date"), null);
  assert.equal(fn.YEAR(null), null);
  assert.equal(fn.SECOND(""), null);
});

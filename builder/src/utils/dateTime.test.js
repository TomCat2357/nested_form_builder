import test from "node:test";
import assert from "node:assert/strict";
import {
  toUnixMs,
  serialToUnixMs,
  formatUnixMsDateTimeSec,
  toStrictUnixMs,
  resolveStrictUnixMs,
  formatJstString,
  parseJstString,
  nowJstString,
  normalizeDateTimeFieldValue,
  parseTimeStringToMsSinceMidnight,
  extractJstPartsFull,
  toMsUnixTime,
  formatCanonical,
  sortByModifiedDesc,
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

test("toUnixMs は Excel シリアル値を「値による推測」で変換しない（明示の serialToUnixMs のみ）", () => {
  const serial = 46000;
  // 汎用パスはシリアル推測を行わない（小さな数値は null）。
  assert.equal(toUnixMs(serial), null);
  assert.equal(toUnixMs(String(serial)), null);
  assert.equal(toUnixMs(2027), null); // 裸の年も日付化しない
  // シリアル → Unix ms はスプレッドシート読み取り境界で使う serialToUnixMs を明示的に呼ぶ。
  const ms = serialToUnixMs(serial);
  assert.equal(Number.isFinite(ms), true);
  assert.equal(ms >= 1e11, true); // 大きい Unix ms なので汎用パスはそのまま通す
  assert.equal(toUnixMs(ms), ms);
});

test("formatCanonical は裸の数値文字列を Excel シリアル日付と誤解釈しない", () => {
  assert.equal(formatCanonical("2027", "datetime"), null);
  assert.equal(formatCanonical("2026", "date"), null);
  assert.equal(formatCanonical(46000, "date"), null);
});

test("toUnixMs は YYYY/MM/DD HH:mm:ss.sss 形式をJSTとして解釈する", () => {
  const value = "2026/01/01 09:00:00.123";
  const expected = Date.UTC(2026, 0, 1, 0, 0, 0, 123);
  assert.equal(toUnixMs(value), expected);
});

test("toUnixMs: ISO 8601 で TZ 指定子付き（Z / ±HH:MM）はその時差を考慮して同一の瞬間に解釈する", () => {
  const instant = Date.UTC(2026, 4, 6, 5, 35, 48); // = 2026-05-06 14:35:48 JST
  assert.equal(toUnixMs("2026-05-06T05:35:48Z"), instant);
  assert.equal(toUnixMs("2026-05-06T14:35:48+09:00"), instant);
  assert.equal(toUnixMs("2026-05-06T14:35:48+0900"), instant);
  assert.equal(toUnixMs("2026-05-06T00:35:48-05:00"), instant);
  assert.equal(toUnixMs("2026-05-06T05:35:48.250Z"), Date.UTC(2026, 4, 6, 5, 35, 48, 250));
});

test("toUnixMs: TZ 指定子なしの日時文字列（`_` / 半角スペース / `T` 区切り）はすべて JST 壁時計として解釈する", () => {
  const jstWall = Date.UTC(2026, 4, 6, 5, 35, 48); // 2026-05-06 14:35:48 JST
  assert.equal(toUnixMs("2026-05-06_14:35:48"), jstWall);
  assert.equal(toUnixMs("2026-05-06 14:35:48"), jstWall);
  assert.equal(toUnixMs("2026-05-06T14:35:48"), jstWall);
  assert.equal(toUnixMs("2026/05/06 14:35:48"), jstWall);
});

test("formatCanonical / formatJstString: TZ 指定子付き ISO はその時差を考慮して JST 表現にする", () => {
  assert.equal(formatCanonical("2026-05-06T05:35:48Z", "datetime"), "2026-05-06_14:35:48.000");
  assert.equal(formatCanonical("2026-05-06T14:35:48+09:00", "datetime"), "2026-05-06_14:35:48.000");
  assert.equal(formatCanonical("2026-05-06T14:35:48", "datetime"), "2026-05-06_14:35:48.000"); // 指定子なしは JST 壁時計
  assert.equal(formatJstString("2026-05-06T05:35:48Z"), "2026-05-06_14:35:48.000");
  assert.equal(formatCanonical("2026-05-05T20:00:00Z", "date"), "2026-05-06"); // UTC 5/5 20:00 = JST 5/6 05:00
});

test("formatUnixMsDateTimeSec はJST固定で秒をゼロ埋め表示する", () => {
  const unixMs = Date.UTC(2026, 0, 1, 0, 0, 0, 7); // JST: 2026-01-01_09:00:00
  assert.equal(formatUnixMsDateTimeSec(unixMs), "2026-01-01_09:00:00");
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

// ---------------------------------------------------------------------------
// JST 文字列ストレージ形式（Plan P4）
// ---------------------------------------------------------------------------

test("formatJstString: Unix ms から canonical な YYYY-MM-DD_HH:mm:ss.SSS を返す", () => {
  // 2026-05-06 14:35:48 JST = 2026-05-06 05:35:48 UTC
  const ms = Date.UTC(2026, 4, 6, 5, 35, 48);
  assert.equal(formatJstString(ms), "2026-05-06_14:35:48.000");
});

test("formatJstString: Date オブジェクトを受ける", () => {
  const ms = Date.UTC(2026, 0, 1, 0, 0, 0); // = 2026-01-01 09:00:00 JST
  assert.equal(formatJstString(new Date(ms)), "2026-01-01_09:00:00.000");
});

test("formatJstString: 既存 JST 文字列を canonical に再正規化", () => {
  // 旧区切り（`/` / 半角スペース / T）や 1 桁月日の入力も受け付け、出力はハイフン + アンダースコア区切り
  assert.equal(formatJstString("2026/5/6 14:35:48"), "2026-05-06_14:35:48.000");
  assert.equal(formatJstString("2026-05-06_14:35:48"), "2026-05-06_14:35:48.000");
  assert.equal(formatJstString("2026-05-06T14:35:48"), "2026-05-06_14:35:48.000");
  assert.equal(formatJstString("2026-5-6"), "2026-05-06_00:00:00.000");
  // ms 入力もそのまま canonical に反映される
  assert.equal(formatJstString("2026-05-06_14:35:48.123"), "2026-05-06_14:35:48.123");
});

test("formatJstString: null / 不正値は空文字列", () => {
  assert.equal(formatJstString(null), "");
  assert.equal(formatJstString(undefined), "");
  assert.equal(formatJstString(""), "");
  assert.equal(formatJstString("not a date"), "");
});

test("parseJstString: canonical 形式（`_` 区切り）→ Date", () => {
  const d = parseJstString("2026-05-06_14:35:48");
  assert.ok(d instanceof Date);
  assert.equal(d.getTime(), Date.UTC(2026, 4, 6, 5, 35, 48));
});

test("parseJstString: 旧区切り（半角スペース / T / /）も許容", () => {
  assert.equal(parseJstString("2026-05-06 14:35:48").getTime(), Date.UTC(2026, 4, 6, 5, 35, 48));
  assert.equal(parseJstString("2026-05-06T14:35:48").getTime(), Date.UTC(2026, 4, 6, 5, 35, 48));
  assert.equal(parseJstString("2026/05/06 14:35:48").getTime(), Date.UTC(2026, 4, 6, 5, 35, 48));
});

test("parseJstString: 時刻省略時は 00:00:00 JST", () => {
  const d = parseJstString("2026-05-06");
  assert.equal(d.getTime(), Date.UTC(2026, 4, 5, 15, 0, 0));
});

test("parseJstString: 不正値は null", () => {
  assert.equal(parseJstString(""), null);
  assert.equal(parseJstString("not"), null);
  assert.equal(parseJstString("2026-13-01"), null);
  assert.equal(parseJstString(null), null);
});

test("nowJstString: 現在時刻が JST 文字列で得られる（ms 付き）", () => {
  const s = nowJstString();
  assert.match(s, /^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}:\d{2}\.\d{3}$/);
});

test("JST 文字列は辞書順 = 時系列順", () => {
  const a = formatJstString(Date.UTC(2026, 0, 1, 0, 0, 0));
  const b = formatJstString(Date.UTC(2026, 5, 1, 0, 0, 0));
  const c = formatJstString(Date.UTC(2027, 0, 1, 0, 0, 0));
  assert.ok(a < b);
  assert.ok(b < c);
});

// ============================================================================
// normalizeDateTimeFieldValue: レコード保存時の date / time 正規化
// ============================================================================

test("normalizeDateTimeFieldValue: date 型は YYYY-MM-DD を返す", () => {
  assert.equal(normalizeDateTimeFieldValue("2026-03-14", "date"), "2026-03-14");
});

test("normalizeDateTimeFieldValue: date 型は時刻成分を削ぎ落とす", () => {
  // ISO 形式に時刻が混じったケース
  assert.equal(normalizeDateTimeFieldValue("2026-03-14T15:30:45", "date"), "2026-03-14");
  // 旧 YYYY/MM/DD HH:mm:ss 形式の入力も受理
  assert.equal(normalizeDateTimeFieldValue("2026/03/14 15:30:45", "date"), "2026-03-14");
  // JST canonical（YYYY-MM-DD HH:mm:ss）
  assert.equal(normalizeDateTimeFieldValue("2026-03-14 23:59:59", "date"), "2026-03-14");
});

test("normalizeDateTimeFieldValue: time 型は HH:mm:ss を返す", () => {
  assert.equal(normalizeDateTimeFieldValue("09:30", "time"), "09:30:00");
  assert.equal(normalizeDateTimeFieldValue("09:30:45", "time"), "09:30:45");
});

test("normalizeDateTimeFieldValue: time 型は日付成分を削ぎ落とす（基準日は GAS 側で付与）", () => {
  // 日付付きの time 値が入ってきたら時刻のみ残す
  assert.equal(normalizeDateTimeFieldValue("2026-03-14 09:30:00", "time"), "09:30:00");
  assert.equal(normalizeDateTimeFieldValue("1899-12-30 23:59:59", "time"), "23:59:59");
});

test("normalizeDateTimeFieldValue: 空 / null / undefined は空文字を返す", () => {
  assert.equal(normalizeDateTimeFieldValue("", "date"), "");
  assert.equal(normalizeDateTimeFieldValue(null, "date"), "");
  assert.equal(normalizeDateTimeFieldValue(undefined, "date"), "");
  assert.equal(normalizeDateTimeFieldValue("", "time"), "");
});

test("normalizeDateTimeFieldValue: パース不能な値は空文字を返す", () => {
  assert.equal(normalizeDateTimeFieldValue("invalid", "date"), "");
  assert.equal(normalizeDateTimeFieldValue("not-a-time", "time"), "");
});

test("normalizeDateTimeFieldValue: date / time 以外の型は値をそのまま返す", () => {
  assert.equal(normalizeDateTimeFieldValue("hello", "text"), "hello");
  assert.equal(normalizeDateTimeFieldValue("123", "number"), "123");
});

test("normalizeDateTimeFieldValue: TZ 反転がない（JST 解釈）", () => {
  // 23:59 を入れて翌日にずれないこと
  assert.equal(normalizeDateTimeFieldValue("2026-03-14 23:59:59", "date"), "2026-03-14");
  // 00:00 を入れて前日にずれないこと
  assert.equal(normalizeDateTimeFieldValue("2026-03-14 00:00:00", "date"), "2026-03-14");
});

test("normalizeDateTimeFieldValue: 非パディングの YYYY-M-D も補完される", () => {
  assert.equal(normalizeDateTimeFieldValue("2020-1-1", "date"), "2020-01-01");
});

// ============================================================================
// parseTimeStringToMsSinceMidnight / extractJstPartsFull / toMsUnixTime / formatCanonical
// ============================================================================

test("parseTimeStringToMsSinceMidnight: HH:mm[:ss[.SSS]] → ms since midnight", () => {
  assert.equal(parseTimeStringToMsSinceMidnight("00:01:00"), 60000);
  assert.equal(parseTimeStringToMsSinceMidnight("13:01"), 13 * 3600000 + 60000);
  assert.equal(parseTimeStringToMsSinceMidnight("23:59:59"), 23 * 3600000 + 59 * 60000 + 59000);
  assert.equal(parseTimeStringToMsSinceMidnight("01:02:03.500"), 3600000 + 2 * 60000 + 3000 + 500);
});

test("parseTimeStringToMsSinceMidnight: 範囲外・不正は null", () => {
  assert.equal(parseTimeStringToMsSinceMidnight("24:00:00"), null);
  assert.equal(parseTimeStringToMsSinceMidnight("12:60"), null);
  assert.equal(parseTimeStringToMsSinceMidnight("not a time"), null);
  assert.equal(parseTimeStringToMsSinceMidnight("2020-01-01 13:01:00"), null);
  assert.equal(parseTimeStringToMsSinceMidnight(null), null);
});

test("extractJstPartsFull: 数値 msunixtime → JST パーツ", () => {
  // 2026-05-06 14:35:48.123 JST
  const ms = Date.UTC(2026, 4, 6, 5, 35, 48, 123);
  const p = extractJstPartsFull(ms);
  assert.deepEqual(
    { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second, ms: p.ms },
    { y: 2026, mo: 5, d: 6, h: 14, mi: 35, s: 48, ms: 123 },
  );
  assert.equal(p.unixMs, ms);
});

test("extractJstPartsFull: canonical 文字列 → JST パーツ", () => {
  const p = extractJstPartsFull("2020-01-01 22:23:34");
  assert.deepEqual(
    { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second },
    { y: 2020, mo: 1, d: 1, h: 22, mi: 23, s: 34 },
  );
});

test("extractJstPartsFull: 不正値は null", () => {
  assert.equal(extractJstPartsFull("nope"), null);
  assert.equal(extractJstPartsFull(null), null);
});

test("toMsUnixTime: TIME-only 文字列は ms since midnight", () => {
  assert.equal(toMsUnixTime("00:01:00"), 60000);
  assert.equal(toMsUnixTime("13:01"), 13 * 3600000 + 60000);
});

test("toMsUnixTime: date を含む文字列は JST 解釈の unix ms", () => {
  assert.equal(toMsUnixTime("1970-01-01 09:00:00"), 0);
  assert.equal(toMsUnixTime("2020-1-1"), Date.UTC(2020, 0, 1) - 9 * 3600000);
});

test("toMsUnixTime: 数値・Date・不正値", () => {
  const ms = Date.UTC(2026, 0, 1);
  assert.equal(toMsUnixTime(ms), ms);
  assert.equal(toMsUnixTime(new Date(ms)), ms);
  assert.equal(toMsUnixTime("nope"), null);
  assert.equal(toMsUnixTime(""), null);
  assert.equal(toMsUnixTime(null), null);
});

test("formatCanonical: date 型 — 補完と切り落とし", () => {
  assert.equal(formatCanonical("2020-1-1", "date"), "2020-01-01");
  assert.equal(formatCanonical("2020-01-01 23:00:23", "date"), "2020-01-01");
  assert.equal(formatCanonical(Date.UTC(2026, 4, 6, 5, 0, 0), "date"), "2026-05-06");
});

test("formatCanonical: datetime 型 — 補完と切り落とし（日付はハイフン、日付↔時刻はアンダースコア、ms までゼロ埋め）", () => {
  assert.equal(formatCanonical("2020-1-1", "datetime"), "2020-01-01_00:00:00.000");
  assert.equal(formatCanonical("2020-01-01 22:23:34", "datetime"), "2020-01-01_22:23:34.000"); // 旧スペース区切り入力も受理
  assert.equal(formatCanonical("2020-01-01_22:23:34", "datetime"), "2020-01-01_22:23:34.000"); // `_` 区切り canonical 入力
  assert.equal(formatCanonical("2020-01-01_22:23:34.123", "datetime"), "2020-01-01_22:23:34.123");
});

test("formatCanonical: time 型 — TIME-only / datetime / 数値（ms までゼロ埋め）", () => {
  assert.equal(formatCanonical("13:01", "time"), "13:01:00.000");
  assert.equal(formatCanonical("2020-01-01 22:23:34", "time"), "22:23:34.000");
  // 2026-05-06 14:35:48 JST
  assert.equal(formatCanonical(Date.UTC(2026, 4, 6, 5, 35, 48), "time"), "14:35:48.000");
  assert.equal(formatCanonical("13:01:00.456", "time"), "13:01:00.456");
});

test("formatCanonical: date/datetime に TIME-only 文字列を渡すと基準日 1970-01-01 を付与", () => {
  assert.equal(formatCanonical("13:01:00", "date"), "1970-01-01");
  assert.equal(formatCanonical("13:01:00", "datetime"), "1970-01-01_13:01:00.000");
  // 仕様例: DATETIME(TIMEM(T)) → "1970-01-01_12:34:00.000"
  assert.equal(formatCanonical("12:34", "datetime"), "1970-01-01_12:34:00.000");
});

test("formatCanonical: times/timem/timems の切り落とし・合成", () => {
  const T = "2020/04/02 12:34:56.789";
  assert.equal(formatCanonical(T, "times"), "12:34:56");
  assert.equal(formatCanonical(T, "timem"), "12:34");
  assert.equal(formatCanonical(T, "timems"), "12:34:56.789");
  assert.equal(formatCanonical(T, "time"), "12:34:56.789");
  // TIME(TIMEM(T)) → ミリ秒まで 0 埋め
  assert.equal(formatCanonical(formatCanonical(T, "timem"), "time"), "12:34:00.000");
});

test("formatCanonical: 空 / 不正値は null", () => {
  assert.equal(formatCanonical("", "date"), null);
  assert.equal(formatCanonical(null, "datetime"), null);
  assert.equal(formatCanonical(undefined, "time"), null);
  assert.equal(formatCanonical("not a date", "date"), null);
});

test("sortByModifiedDesc: 新しい順に並べ替え、元配列は不変", () => {
  const items = [
    { id: "a", modifiedAt: "2026-01-01_00:00:00.000" },
    { id: "b", modifiedAt: "2026-03-01_00:00:00.000" },
    { id: "c", modifiedAt: "2026-02-01_00:00:00.000" },
  ];
  const sorted = sortByModifiedDesc(items, (it) => it.modifiedAt);
  assert.deepEqual(sorted.map((x) => x.id), ["b", "c", "a"]);
  assert.deepEqual(items.map((x) => x.id), ["a", "b", "c"]);
});

test("sortByModifiedDesc: 既定 getter は modifiedAtUnixMs ?? modifiedAt", () => {
  const items = [
    { id: "x", modifiedAtUnixMs: 100 },
    { id: "y", modifiedAt: "2026-06-01_00:00:00.000" },
    { id: "z", modifiedAtUnixMs: 300 },
  ];
  const sorted = sortByModifiedDesc(items);
  assert.equal(sorted[0].id, "y");
  assert.equal(sorted[1].id, "z");
  assert.equal(sorted[2].id, "x");
});

test("sortByModifiedDesc: 非配列・不正値でも落ちない", () => {
  assert.deepEqual(sortByModifiedDesc(null), []);
  assert.deepEqual(sortByModifiedDesc(undefined), []);
  const out = sortByModifiedDesc([{ id: "a" }, { id: "b", modifiedAt: "2026-01-01_00:00:00.000" }]);
  assert.equal(out[0].id, "b");
});

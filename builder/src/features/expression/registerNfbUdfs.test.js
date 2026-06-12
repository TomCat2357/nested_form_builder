import assert from "node:assert/strict";
import test from "node:test";
import { ensureNfbUdfsRegistered } from "./registerNfbUdfs.js";

function makeFakeAlaSql() {
  return { fn: {} };
}

test("UDF が登録される / 廃止・改名された関数は無い", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  // 残っている / 新規
  for (const name of [
    "DATE", "DATETIME", "TIME", "TIMES", "TIMEM", "TIMEMS", "TIMESTAMP", "TIME_FORMAT",
    "DATE2ERA", "DATETIME2ERATIME", "ERA2DATE", "ERATIME2DATETIME",
    "YEAR", "MONTH", "DAY", "HOUR", "MINUTE", "SECOND", "NENDO",
    "TO_BOOL", "TO_NUMBER", "REGEXP_MATCH", "REGEXP_REPLACE", "LIKE_ANY",
    "MV_EQ", "MV_IN",
  ]) {
    assert.equal(typeof alasql.fn[name], "function", `${name} should be a function`);
  }
  // 廃止 / 改名で消えたもの
  // - REGEX_TEST / REGEX_MATCH / REGEX_EXTRACT / REGEX_EXTRACT_ALL は廃止し、
  //   REGEXP_MATCH / REGEXP_REPLACE の 2 つに集約。判定 (boolean) はネイティブの
  //   REGEXP 演算子 / REGEXP_LIKE 関数を使う。
  for (const name of [
    "DATE_BIN", "TIME_SECONDS", "DATETIME2ERA", "ERA2DATETIME",
    "PARSE_DATE", "PAD_LEFT", "PAD_RIGHT",
    "REGEX_TEST", "REGEX_MATCH", "REGEX_EXTRACT", "REGEX_EXTRACT_ALL", "REGEXP_LIKE",
  ]) {
    assert.equal(typeof alasql.fn[name], "undefined", `${name} should be removed`);
  }
});

test("NENDO: 日本の年度（4 月始まり、1〜3 月は前年）", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.NENDO;
  // 仕様例
  assert.equal(fn("2025-12-01"), 2025);
  assert.equal(fn("2025-03-01"), 2024);
  // 境界: 4/1 はその年、3/31 は前年
  assert.equal(fn("2025-04-01"), 2025);
  assert.equal(fn("2025-03-31"), 2024);
  assert.equal(fn("2025-01-01"), 2024);
  // datetime / 数値 msunixtime も受ける
  assert.equal(fn("2025-12-01_09:30:00.000"), 2025);
  assert.equal(fn(Date.UTC(2026, 4, 6, 5, 0, 0)), 2026); // 2026-05-06 JST
  // 暦日成分なし（TIME-only）/ 空 / 不正は null
  assert.equal(fn("13:01:00"), null);
  assert.equal(fn(""), null);
  assert.equal(fn("not a date"), null);
});

test("idempotent: 二度呼んでも問題なし", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const ref = alasql.fn.DATE;
  ensureNfbUdfsRegistered(alasql);
  assert.equal(alasql.fn.DATE, ref);
});

test("DATE: canonical 文字列 YYYY-MM-DD を返す（補完・切り落とし）", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.DATE;
  assert.equal(fn("2020-1-1"), "2020-01-01");
  assert.equal(fn("2020-01-01 23:00:23"), "2020-01-01");
  assert.equal(fn("2025/01/08"), "2025-01-08"); // 旧スラッシュ入力も受理して canonical 化
  // 数値 msunixtime → その瞬間の JST 日付
  assert.equal(fn(Date.UTC(2026, 4, 6, 5, 0, 0)), "2026-05-06");
  // 文字列比較が時系列比較になる
  assert.ok(fn("2025-01-08") < fn("2025-01-09"));
  // TIME-only 文字列は基準日 1970-01-01 を付与（年月日は適当・UNIX エポック日）
  assert.equal(fn("13:01:00"), "1970-01-01");
  // 空 / 不正は null
  assert.equal(fn(""), null);
  assert.equal(fn("not a date"), null);
});

test("DATETIME: canonical 文字列 YYYY-MM-DD_HH:mm:ss.SSS を返す（補完・切り落とし、ms までゼロ埋め）", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.DATETIME;
  assert.equal(fn("2020-1-1"), "2020-01-01_00:00:00.000");
  assert.equal(fn("2020-01-01 22:23:34"), "2020-01-01_22:23:34.000"); // 旧スペース区切り入力も受理
  assert.equal(fn("2020-01-01_22:23:34"), "2020-01-01_22:23:34.000"); // `_` 区切り canonical 入力
  assert.equal(fn("2020-01-01_22:23:34.567"), "2020-01-01_22:23:34.567");
  // TIME-only 文字列は基準日 1970-01-01 を付与
  assert.equal(fn("13:01:00"), "1970-01-01_13:01:00.000");
  assert.equal(fn(""), null);
});

test("TIMES/TIMEM/TIMEMS: 秒まで / 分まで / ミリ秒まで（TIMEMS は TIME と同義）", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const T = "2020/04/02 12:34:56.789";
  assert.equal(alasql.fn.TIMES(T), "12:34:56");
  assert.equal(alasql.fn.TIMEM(T), "12:34");
  assert.equal(alasql.fn.TIMEMS(T), "12:34:56.789");
  // 合成: TIME(TIMEM(T)) → ミリ秒まで 0 埋め
  assert.equal(alasql.fn.TIME(alasql.fn.TIMEM(T)), "12:34:00.000");
  // 合成: DATETIME(TIMEM(T)) → 基準日 1970-01-01
  assert.equal(alasql.fn.DATETIME(alasql.fn.TIMEM(T)), "1970-01-01_12:34:00.000");
  assert.equal(alasql.fn.TIMES(""), null);
  assert.equal(alasql.fn.TIMEM(null), null);
});

test("TIME: canonical 文字列 HH:mm:ss.sss を返す（ms までゼロ埋め）", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.TIME;
  assert.equal(fn("13:01"), "13:01:00.000");
  assert.equal(fn("2020-01-01 22:23:34"), "22:23:34.000");
  // 数値 msunixtime → その瞬間の JST 時刻
  assert.equal(fn(Date.UTC(2026, 4, 6, 5, 35, 48)), "14:35:48.000");
  assert.equal(fn("13:01:00.456"), "13:01:00.456");
  assert.equal(fn(""), null);
});

test("DATE/DATETIME/TIME は別々の実装（旧 unix ms 統一は廃止）", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  assert.notEqual(alasql.fn.DATE, alasql.fn.DATETIME);
  assert.notEqual(alasql.fn.DATE, alasql.fn.TIME);
  // 同じ canonical 文字列を返すので `=` (=== 相当) が成立
  assert.strictEqual(alasql.fn.DATE("2025-01-08"), alasql.fn.DATE("2025/1/8"));
});

test("TIMESTAMP: 文字列 → msunixtime / TIME-only → ms since midnight", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.TIMESTAMP;
  assert.equal(fn("00:01:00"), 60000);
  assert.equal(fn("01:00:00"), 3600000);
  assert.equal(fn("1970-01-01 09:00:00"), 0); // JST: 1970-01-01 09:00 = epoch
  assert.equal(fn("2020-01-08"), Date.UTC(2020, 0, 8) - 9 * 3600000);
  assert.equal(fn("not a date"), null);
  assert.equal(fn(""), null);
});

test("TO_BOOL: 真偽判定", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.TO_BOOL;
  assert.equal(fn(true), true);
  assert.equal(fn(false), false);
  assert.equal(fn(1), true);
  assert.equal(fn(0), false);
  assert.equal(fn("yes"), true);
  assert.equal(fn(""), false);
  assert.equal(fn("0"), false);
  assert.equal(fn("false"), false);
  assert.equal(fn("FALSE"), false);
  assert.equal(fn("no"), false);
  assert.equal(fn(null), false);
  assert.equal(fn(undefined), false);
});

test("TO_NUMBER: 数値化", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.TO_NUMBER;
  assert.equal(fn(42), 42);
  assert.equal(fn("42"), 42);
  assert.equal(fn("3.14"), 3.14);
  assert.equal(fn("  10  "), 10);
  assert.equal(fn("abc"), null);
  assert.equal(fn(""), null);
  assert.equal(fn(null), null);
});

test("REGEXP_MATCH: groupIdx 省略時はマッチ全体 / 明示時はそのグループ", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.REGEXP_MATCH;
  // groupIdx 省略 = 0 = fullMatch（括弧の有無による自動分岐なし）
  assert.equal(fn("田中太郎", "田.*"), "田中太郎");
  assert.equal(fn("田中太郎", "(田中)(.+)"), "田中太郎"); // 括弧あり 2 引数でも fullMatch
  assert.equal(fn("田中太郎", "(田中)(.+)", 0), "田中太郎");
  assert.equal(fn("田中太郎", "(田中)(.+)", 1), "田中");
  assert.equal(fn("田中太郎", "(田中)(.+)", 2), "太郎");
  // グループ未定義 / 非マッチ → ""
  assert.equal(fn("田中太郎", "(田中)", 5), "");
  assert.equal(fn("田中太郎", "no-match"), "");
  // null/undefined は NULL 伝搬
  assert.equal(fn(null, "x"), null);
  assert.equal(fn(undefined, "x"), null);
  // 不正パターンは ""
  assert.equal(fn("foo", "[invalid"), "");
});

test("REGEXP_REPLACE: 全体置換 + JS 標準のバックリファレンス", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.REGEXP_REPLACE;
  // 全体置換（'g' フラグ）
  assert.equal(fn("a1b2c3", "\\d", "X"), "aXbXcX");
  // $1 バックリファレンス（部分置換は呼び出し側で明示）
  assert.equal(fn("prefix-123-suffix", "(prefix-)(\\d+)(-suffix)", "$1999$3"), "prefix-999-suffix");
  // $& = マッチ全体
  assert.equal(fn("abc", "b", "[$&]"), "a[b]c");
  // $$ = リテラル $
  assert.equal(fn("a", "a", "$$"), "$");
  // 名前付きグループ $<name>
  assert.equal(fn("2026-05-20", "(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})", "$<d>/$<m>/$<y>"), "20/05/2026");
  // 存在しないグループ番号はリテラルとして残る (JS 仕様)
  assert.equal(fn("ab", "(a)(b)", "$1-$5"), "a-$5");
  // null/undefined 伝搬
  assert.equal(fn(null, "x", "y"), null);
  assert.equal(fn(undefined, "x", "y"), null);
  // replacement の null/undefined は "" 扱い
  assert.equal(fn("abc", "b", null), "ac");
  assert.equal(fn("abc", "b", undefined), "ac");
  // 不正パターンは元 text 返却
  assert.equal(fn("foo", "[invalid", "X"), "foo");
});

test("LIKE_ANY: 全列横断 LIKE", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.LIKE_ANY;
  assert.equal(fn("田中", "田中太郎", "備考"), true);
  assert.equal(fn("田中", "山田", "備考"), false);
  assert.equal(fn("田中", "山田", "田中の備考"), true);
  assert.equal(fn("HELLO", "hello world"), true); // 大小無視
  assert.equal(fn("田中", null, "田中"), true);   // null は無視して次列へ
  assert.equal(fn("", "anything"), true);          // 空 needle は常にヒット
  assert.equal(fn(null, "anything"), false);       // null needle は false
});

test("LIKE_ANY: 配列値を結合して評価", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.LIKE_ANY;
  assert.equal(fn("b", ["a", "b", "c"]), true);
});

test("LIKE_ANY: 数値列に対する数値 needle", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.LIKE_ANY;
  assert.equal(fn("25", 25, "備考"), true);
  assert.equal(fn("2", 25, ""), true);
});

test("LIKE_ANY: unix ms 列値は ISO 文字列としても match される", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.LIKE_ANY;
  const ms = Date.UTC(2024, 0, 15);
  assert.equal(fn("2024", ms, ""), true);
  assert.equal(fn("2024-01", ms, ""), true);
  assert.equal(fn("2024-01-15", ms, ""), true);
  assert.equal(fn("2099", ms, ""), false);
});

test("LIKE_ANY: Date オブジェクト列値も日付として match", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.LIKE_ANY;
  const d = new Date(Date.UTC(2025, 4, 5));
  assert.equal(fn("2025-05-05", d, ""), true);
  assert.equal(fn("2025", d, ""), true);
});

// alasql の集計呼び出し規約（stage 1=最初, 2=後続, 3=確定）をシミュレートして 1 グループ分を畳む。
function aggrReduce(fn, values) {
  let acc;
  values.forEach((v, i) => {
    acc = fn(v, i === 0 ? undefined : acc, i === 0 ? 1 : 2);
  });
  return fn(undefined, acc, 3);
}

test("STR_MAX / STR_MIN: alasql.aggr に登録される（fake alasql に aggr が無くても初期化）", () => {
  const alasql = { fn: {} }; // aggr 無し
  ensureNfbUdfsRegistered(alasql);
  assert.equal(typeof alasql.aggr.STR_MAX, "function");
  assert.equal(typeof alasql.aggr.STR_MIN, "function");
});

test("STR_MAX / STR_MIN: 数値・canonical 日付文字列・文字列を辞書順で比較し NULL は無視", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const max = alasql.aggr.STR_MAX;
  const min = alasql.aggr.STR_MIN;
  // 数値（alasql 組み込み MAX/MIN と同じ結果）
  assert.equal(aggrReduce(max, [120, 55, 25000, null]), 25000);
  assert.equal(aggrReduce(min, [120, 55, 25000, null]), 55);
  // canonical 日付文字列（辞書順 = 時系列順）
  assert.equal(aggrReduce(max, ["2026-01-26", "2026-02-10", "2026-01-26"]), "2026-02-10");
  assert.equal(aggrReduce(min, ["2026-01-26", "2026-02-10", "2026-01-26"]), "2026-01-26");
  // 文字列
  assert.equal(aggrReduce(max, ["banana", "apple", null]), "banana");
  assert.equal(aggrReduce(min, ["banana", "apple", null]), "apple");
  // 全 NULL / 空グループ → null
  assert.equal(aggrReduce(max, [null, null]), null);
  assert.equal(aggrReduce(min, []), null);
});

test("MV_EQ: 複数値セルを , で分割し集合一致", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.MV_EQ;
  // 単一値セル → 通常の等価
  assert.equal(fn("カラス", "カラス"), true);
  assert.equal(fn("カラス", "キツネ"), false);
  // 複数値（, 連結 = entriesToViewRows の checkboxes 由来）
  assert.equal(fn("カラス,キタツネ", "キタツネ"), true);
  assert.equal(fn("カラス,キタツネ", "タヌキ"), false);
  assert.equal(fn("カラス,キタツネ", "カラス"), true);
  // ラベル内のカンマはバックスラッシュでエスケープされ、1 ラベルとして一致する（codec splitMultiValue）
  assert.equal(fn("赤\\, 青,カラス", "赤, 青"), true);
  assert.equal(fn("赤\\, 青,カラス", "カラス"), true);
  assert.equal(fn("赤\\, 青,カラス", "赤"), false);
  // 前後空白は保持（trim しない）＝ラベルの一部
  assert.equal(fn("カラス , キタツネ", "キタツネ"), false);
  assert.equal(fn("カラス , キタツネ", " キタツネ"), true);
  // 数値も文字列化して比較
  assert.equal(fn(20, "20"), true);
  // 空 / null セルはトークン無し → false（NOT MV_EQ で「空 != 値」が true になる）
  assert.equal(fn("", "カラス"), false);
  assert.equal(fn(null, "カラス"), false);
  assert.equal(fn(undefined, "カラス"), false);
});

test("MV_IN: 複数値セルを , で分割し集合 IN 判定", () => {
  const alasql = makeFakeAlaSql();
  ensureNfbUdfsRegistered(alasql);
  const fn = alasql.fn.MV_IN;
  assert.equal(fn("カラス", "田中", "カラス"), true);
  assert.equal(fn("カラス", "田中", "鈴木"), false);
  assert.equal(fn("カラス,キタツネ", "キタツネ", "タヌキ"), true);
  assert.equal(fn("カラス,キタツネ", "カラス"), true);
  // 空 / null セル → false（NOT MV_IN で not in が true）
  assert.equal(fn("", "カラス"), false);
  assert.equal(fn(null, "カラス"), false);
});

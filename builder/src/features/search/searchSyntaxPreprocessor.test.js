import assert from "node:assert/strict";
import test from "node:test";
import {
  preprocessSearchQuery,
  normalizeFullWidthSearchOperators,
} from "./searchSyntaxPreprocessor.js";

const COLS = ["氏名", "備考", "年齢"];

test("空クエリは null を返す", () => {
  const r = preprocessSearchQuery("", COLS);
  assert.equal(r.expr, null);
  assert.deepEqual(r.errors, []);
});

test("裸単語は LIKE_ANY に展開される", () => {
  const r = preprocessSearchQuery("田中", COLS);
  assert.equal(r.expr, "LIKE_ANY('田中', `氏名`, `備考`, `年齢`)");
});

test("空白で区切られた裸単語は AND で結合", () => {
  const r = preprocessSearchQuery("田中 山田", COLS);
  assert.equal(
    r.expr,
    "(LIKE_ANY('田中', `氏名`, `備考`, `年齢`)) AND (LIKE_ANY('山田', `氏名`, `備考`, `年齢`))"
  );
});

test("3 トークンの暗黙 AND", () => {
  const r = preprocessSearchQuery("a b c", COLS);
  assert.match(r.expr, /^\(\(LIKE_ANY\('a',.*\)\) AND \(LIKE_ANY\('b',.*\)\)\) AND \(LIKE_ANY\('c',.*\)\)$/);
});

test("OR は明示的に処理される", () => {
  const r = preprocessSearchQuery("田中 OR 山田", COLS);
  assert.equal(
    r.expr,
    "(LIKE_ANY('田中', `氏名`, `備考`, `年齢`)) OR (LIKE_ANY('山田', `氏名`, `備考`, `年齢`))"
  );
});

test("列指定 + 比較演算子", () => {
  const r = preprocessSearchQuery("年齢 >= 20", COLS);
  assert.equal(r.expr, "`年齢` >= 20");
});

test("文字列値の比較", () => {
  const r = preprocessSearchQuery('氏名 = "田中"', COLS);
  assert.equal(r.expr, "`氏名` = '田中'");
});

test("シングルクォート文字列も受け付ける", () => {
  const r = preprocessSearchQuery("氏名 = '田中'", COLS);
  assert.equal(r.expr, "`氏名` = '田中'");
});

test("LIKE 演算", () => {
  const r = preprocessSearchQuery("氏名 LIKE '%田中%'", COLS);
  assert.equal(r.expr, "`氏名` LIKE '%田中%'");
});

test("NOT LIKE 演算", () => {
  const r = preprocessSearchQuery("氏名 NOT LIKE '%田中%'", COLS);
  assert.equal(r.expr, "`氏名` NOT LIKE '%田中%'");
});

test("IN 演算", () => {
  const r = preprocessSearchQuery("氏名 IN ('田中', '山田')", COLS);
  assert.equal(r.expr, "`氏名` IN ('田中', '山田')");
});

test("IS NULL / IS NOT NULL", () => {
  assert.equal(preprocessSearchQuery("備考 IS NULL", COLS).expr, "`備考` IS NULL");
  assert.equal(preprocessSearchQuery("備考 IS NOT NULL", COLS).expr, "`備考` IS NOT NULL");
});

test("AND と暗黙 AND の混在", () => {
  const r = preprocessSearchQuery("年齢 >= 20 AND 性別 = '男'", COLS);
  assert.equal(r.expr, "(`年齢` >= 20) AND (`性別` = '男')");
});

test("括弧と論理演算子", () => {
  const r = preprocessSearchQuery("(年齢 >= 20 OR 役職 = '管理職') AND 性別 = '男'", COLS);
  assert.equal(
    r.expr,
    "(((`年齢` >= 20) OR (`役職` = '管理職'))) AND (`性別` = '男')"
  );
});

test("関数呼び出し", () => {
  const r = preprocessSearchQuery("YEAR(`受付日`) = 2025", COLS);
  assert.equal(r.expr, "YEAR(`受付日`) = 2025");
});

test("関数呼び出し（REGEXP_LIKE）", () => {
  const r = preprocessSearchQuery("REGEXP_LIKE(`氏名`, '田.*', 'i')", COLS);
  // 単独の関数呼び出しは bare として扱われる
  assert.equal(r.expr, "REGEXP_LIKE(`氏名`, '田.*', 'i')");
});

test("バックティック識別子 + 比較", () => {
  const r = preprocessSearchQuery("`基本情報 区` = '新宿区'", COLS);
  assert.equal(r.expr, "`基本情報 区` = '新宿区'");
});

test("ブラケット識別子もバックティックに変換", () => {
  const r = preprocessSearchQuery("[基本情報 区] = '新宿区'", COLS);
  assert.equal(r.expr, "`基本情報 区` = '新宿区'");
});

test("NOT 演算", () => {
  const r = preprocessSearchQuery("NOT 田中", COLS);
  assert.equal(r.expr, "NOT (LIKE_ANY('田中', `氏名`, `備考`, `年齢`))");
});

test("NOT (式)", () => {
  const r = preprocessSearchQuery("NOT (年齢 >= 20)", COLS);
  assert.equal(r.expr, "NOT ((`年齢` >= 20))");
});

test("数値の裸単語", () => {
  const r = preprocessSearchQuery("2025", COLS);
  assert.equal(r.expr, "LIKE_ANY('2025', `氏名`, `備考`, `年齢`)");
});

test("columns 空のときは裸単語が FALSE になる", () => {
  const r = preprocessSearchQuery("田中", []);
  assert.equal(r.expr, "FALSE");
});

test("複合: 裸単語 AND 比較式", () => {
  const r = preprocessSearchQuery("田中 年齢 >= 20", COLS);
  assert.equal(
    r.expr,
    "(LIKE_ANY('田中', `氏名`, `備考`, `年齢`)) AND (`年齢` >= 20)"
  );
});

test("日付リテラル(YYYY-MM-DD) は単一トークンの裸単語", () => {
  const r = preprocessSearchQuery("2025-05-05", COLS);
  assert.equal(r.expr, "LIKE_ANY('2025-05-05', `氏名`, `備考`, `年齢`)");
});

test("日付リテラル(YYYY/MM/DD) も単一トークン", () => {
  const r = preprocessSearchQuery("2025/05/05", COLS);
  assert.equal(r.expr, "LIKE_ANY('2025/05/05', `氏名`, `備考`, `年齢`)");
});

test("日付 + 時刻 ISO 形式", () => {
  const r = preprocessSearchQuery("2025-05-05T14:30", COLS);
  assert.equal(r.expr, "LIKE_ANY('2025-05-05T14:30', `氏名`, `備考`, `年齢`)");
});

test("時刻のみリテラル", () => {
  const r = preprocessSearchQuery("14:30", COLS);
  assert.equal(r.expr, "LIKE_ANY('14:30', `氏名`, `備考`, `年齢`)");
});

test("ピリオドを含む列名は囲わずに使える（No.）", () => {
  const r = preprocessSearchQuery("No. >= 10", COLS);
  assert.equal(r.expr, "`No.` >= 10");
});

test("パイプを含むネスト列名は囲わずに使える（識別子は __ に正規化される）", () => {
  const r = preprocessSearchQuery("親質問|子質問 = '値'", COLS);
  assert.equal(r.expr, "`親質問__子質問` = '値'");
});

test("ピリオド・パイプ混在の比較式（パイプは __ に正規化）", () => {
  const r = preprocessSearchQuery("基本情報|No. >= 5", COLS);
  assert.equal(r.expr, "`基本情報__No.` >= 5");
});

test("バックティック識別子もパイプは __ に正規化", () => {
  const r = preprocessSearchQuery("`親質問|子質問` = '値'", COLS);
  assert.equal(r.expr, "`親質問__子質問` = '値'");
});

// ---------------------------------------------------------------------------
// 日付型列の比較: 列は丸めず、リテラル側のみ canonical 文字列に正規化する（生文字列比較）
// ---------------------------------------------------------------------------
const DATE_COLS = [
  { name: "氏名" },
  { name: "備考" },
  { name: "年齢" },
  { name: "販売日", isDateLike: true },
  { name: "販売時刻", isDateLike: true },
];

test("日付型列 = 日付リテラル → リテラルのみ canonical 化（列は生）", () => {
  const r = preprocessSearchQuery("販売日 = 2026/04/01", DATE_COLS);
  assert.equal(r.expr, "`販売日` = '2026/04/01'");
});

test("日付型列 > 日付リテラル → リテラルのみ canonical 化", () => {
  const r = preprocessSearchQuery("販売日 > 2020/04/01", DATE_COLS);
  assert.equal(r.expr, "`販売日` > '2020/04/01'");
});

test("日付型列 >= ハイフン区切り日付 → スラッシュ canonical に正規化される", () => {
  const r = preprocessSearchQuery("販売日 >= 2020-4-1", DATE_COLS);
  assert.equal(r.expr, "`販売日` >= '2020/04/01'");
});

test("日付型列 = クォート付き日付リテラル → リテラルのみ canonical 化", () => {
  const r = preprocessSearchQuery("販売日 = '2026/04/01'", DATE_COLS);
  assert.equal(r.expr, "`販売日` = '2026/04/01'");
});

test("非日付型列 = 日付リテラル → 通常の文字列比較（正規化しない）", () => {
  const r = preprocessSearchQuery("氏名 = 2026/04/01", DATE_COLS);
  assert.equal(r.expr, "`氏名` = '2026/04/01'");
});

test("時刻型列 = 時刻リテラル → 時刻 canonical (HH:mm:ss.SSS) に正規化", () => {
  const r = preprocessSearchQuery("販売時刻 >= 14:30", DATE_COLS);
  assert.equal(r.expr, "`販売時刻` >= '14:30:00.000'");
});

test("列メタなしの古い API（文字列配列）も従来どおり動く", () => {
  const r = preprocessSearchQuery("年齢 >= 20", ["氏名", "備考", "年齢"]);
  assert.equal(r.expr, "`年齢` >= 20");
});

// ---------------------------------------------------------------------------
// SEARCH / WHERE プレフィックス（strict モード）
// ---------------------------------------------------------------------------

test("strict: WHERE プレフィックス + 通常の比較式", () => {
  const r = preprocessSearchQuery("WHERE 氏名 = '田中'", COLS);
  assert.equal(r.expr, "`氏名` = '田中'");
});

test("strict: SEARCH プレフィックスも WHERE と同義", () => {
  const r = preprocessSearchQuery("SEARCH 氏名 = '田中'", COLS);
  assert.equal(r.expr, "`氏名` = '田中'");
});

test("strict: 大小無視（where / search）", () => {
  assert.equal(preprocessSearchQuery("where 年齢 >= 20", COLS).expr, "`年齢` >= 20");
  assert.equal(preprocessSearchQuery("Search 年齢 >= 20", COLS).expr, "`年齢` >= 20");
});

test("strict: 列無し比較は全列 OR 展開", () => {
  const r = preprocessSearchQuery("SEARCH > 'aaa'", COLS);
  assert.equal(r.expr, "((`氏名` > 'aaa') OR (`備考` > 'aaa') OR (`年齢` > 'aaa'))");
});

test("strict: 列無し LIKE は全列 OR 展開", () => {
  const r = preprocessSearchQuery("SEARCH LIKE '%札幌%'", COLS);
  assert.equal(
    r.expr,
    "((`氏名` LIKE '%札幌%') OR (`備考` LIKE '%札幌%') OR (`年齢` LIKE '%札幌%'))"
  );
});

test("strict: 列無し NOT LIKE", () => {
  const r = preprocessSearchQuery("SEARCH NOT LIKE '%foo%'", COLS);
  assert.equal(
    r.expr,
    "((`氏名` NOT LIKE '%foo%') OR (`備考` NOT LIKE '%foo%') OR (`年齢` NOT LIKE '%foo%'))"
  );
});

test("strict: 列無し IN", () => {
  const r = preprocessSearchQuery("SEARCH IN ('a', 'b')", COLS);
  assert.equal(
    r.expr,
    "((`氏名` IN ('a', 'b')) OR (`備考` IN ('a', 'b')) OR (`年齢` IN ('a', 'b')))"
  );
});

test("strict: 列無し IS NULL", () => {
  const r = preprocessSearchQuery("SEARCH IS NULL", COLS);
  assert.equal(
    r.expr,
    "((`氏名` IS NULL) OR (`備考` IS NULL) OR (`年齢` IS NULL))"
  );
});

test("strict: 列無し IS NOT NULL", () => {
  const r = preprocessSearchQuery("SEARCH IS NOT NULL", COLS);
  assert.equal(
    r.expr,
    "((`氏名` IS NOT NULL) OR (`備考` IS NOT NULL) OR (`年齢` IS NOT NULL))"
  );
});

test("strict: FROM 句は構文エラー", () => {
  const r = preprocessSearchQuery("SEARCH 氏名 = '田中' FROM cities", COLS);
  assert.equal(r.expr, null);
  assert.ok(r.errors.length > 0);
  assert.match(r.errors[0], /FROM/);
});

test("strict: GROUP BY 句は構文エラー", () => {
  const r = preprocessSearchQuery("SEARCH 氏名 = '田中' GROUP BY 氏名", COLS);
  assert.equal(r.expr, null);
  assert.match(r.errors[0], /GROUP/);
});

test("strict: ORDER BY 句は構文エラー", () => {
  const r = preprocessSearchQuery("WHERE 年齢 >= 20 ORDER BY 年齢", COLS);
  assert.equal(r.expr, null);
  assert.match(r.errors[0], /ORDER/);
});

test("strict: 列無し OR 展開は columns 空のとき FALSE", () => {
  const r = preprocessSearchQuery("SEARCH > 'aaa'", []);
  assert.equal(r.expr, "FALSE");
});

test("strict: 列無し述語と列指定述語の AND 連結", () => {
  const r = preprocessSearchQuery("SEARCH > 'a' AND 年齢 >= 20", COLS);
  assert.equal(
    r.expr,
    "(((`氏名` > 'a') OR (`備考` > 'a') OR (`年齢` > 'a'))) AND (`年齢` >= 20)"
  );
});

// strict モードでも列は丸めない。日付/時刻リテラルは canonical 文字列に正規化され、
// 値側 (buildSearchRow / entriesToViewTableRows) は日付/時刻列を canonical 文字列で渡すため
// 文字列としての日付比較になる。

test("strict: 日付列リテラル比較も列は丸めずリテラルのみ canonical 化", () => {
  const r = preprocessSearchQuery("WHERE 販売日 >= 2020-1-1", DATE_COLS);
  assert.equal(r.expr, "`販売日` >= '2020/01/01'");
});

test("strict: DATE() 関数呼び出しはそのまま alasql に渡る", () => {
  const r = preprocessSearchQuery("WHERE 販売日 = DATE('2025-01-08')", DATE_COLS);
  assert.equal(r.expr, "`販売日` = DATE('2025-01-08')");
});

test("strict: DATE() の範囲比較もそのまま", () => {
  const r = preprocessSearchQuery("WHERE 販売日 > DATE('2024-01-01')", DATE_COLS);
  assert.equal(r.expr, "`販売日` > DATE('2024-01-01')");
});

test("strict: alasql 標準 YEAR 関数も pass-through", () => {
  const r = preprocessSearchQuery("WHERE YEAR(`販売日`) = 2025", DATE_COLS);
  assert.equal(r.expr, "YEAR(`販売日`) = 2025");
});

test("strict: 任意の関数呼び出しは pass-through (UPPER 等)", () => {
  const r = preprocessSearchQuery("WHERE UPPER(`氏名`) = 'TANAKA'", DATE_COLS);
  assert.equal(r.expr, "UPPER(`氏名`) = 'TANAKA'");
});

test("strict: クォートなし日付リテラルの比較は簡易モードと同じ（リテラルのみ canonical 化）", () => {
  // 簡易・strict どちらも列は丸めず、リテラルのみ canonical 文字列に正規化する。
  const simple = preprocessSearchQuery("販売日 = 2025/01/08", DATE_COLS);
  assert.equal(simple.expr, "`販売日` = '2025/01/08'");
  const strict = preprocessSearchQuery("WHERE 販売日 = 2025/01/08", DATE_COLS);
  assert.equal(strict.expr, "`販売日` = '2025/01/08'");
});

// ---------------------------------------------------------------------------
// 簡易モードの全角記号オペレータ正規化
// ---------------------------------------------------------------------------

test("全角イコールは半角イコールと同じ式を生成する", () => {
  const full = preprocessSearchQuery('氏名 ＝ "田中"', COLS);
  const half = preprocessSearchQuery('氏名 = "田中"', COLS);
  assert.equal(full.expr, half.expr);
  assert.equal(full.expr, "`氏名` = '田中'");
});

test("全角の比較演算子（＞＝）も半角同等", () => {
  const full = preprocessSearchQuery("年齢 ＞＝ 20", COLS);
  const half = preprocessSearchQuery("年齢 >= 20", COLS);
  assert.equal(full.expr, half.expr);
  assert.equal(full.expr, "`年齢` >= 20");
});

test("全角コロンの列指定も半角同等", () => {
  const full = preprocessSearchQuery("氏名：田中", COLS);
  const half = preprocessSearchQuery("氏名:田中", COLS);
  assert.equal(full.expr, half.expr);
});

test("全角括弧・全角カンマの IN リストも半角同等", () => {
  const full = preprocessSearchQuery("年齢 in（20，30）", COLS);
  const half = preprocessSearchQuery("年齢 in (20, 30)", COLS);
  assert.equal(full.expr, half.expr);
});

test("引用符内の全角コロンは値として保持される（変換しない）", () => {
  const r = preprocessSearchQuery('氏名 = "田中：太郎"', COLS);
  assert.equal(r.expr, "`氏名` = '田中：太郎'");
});

test("厳密モードでは全角オペレータを変換しない", () => {
  const half = preprocessSearchQuery('SEARCH 氏名 = "田中"', COLS);
  assert.equal(half.expr, "`氏名` = '田中'");
  // 全角のままだと alasql 式として解釈できず、半角版と同じ式にはならない。
  const full = preprocessSearchQuery('SEARCH 氏名 ＝ "田中"', COLS);
  assert.notEqual(full.expr, "`氏名` = '田中'");
});

test("normalizeFullWidthSearchOperators: 記号一式を半角化しクォート内は保護", () => {
  assert.equal(
    normalizeFullWidthSearchOperators("年齢 ＞＝ 20 ＜ 30 ！＝ 40 ：（，）"),
    "年齢 >= 20 < 30 != 40 :(,)"
  );
  assert.equal(normalizeFullWidthSearchOperators('氏名＝"田中：太郎"'), '氏名="田中：太郎"');
  assert.equal(normalizeFullWidthSearchOperators("氏名＝'田中：太郎'"), "氏名='田中：太郎'");
});

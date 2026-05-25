/**
 * gas/expressionEvaluator.gs のスモークテスト。
 *
 * GAS 側の式評価器はフロントと同じ alasql 本体（gas/vendor/alasql.min.js）+ 同じ UDF
 * バンドル（gas/generated/nfbAlasqlUdfs.gs — builder の registerNfbUdfs.js / dateTime.js /
 * eraConversion.js / kanaTables.js を esbuild で IIFE 化したもの）を使う薄いラッパー。
 *
 * UDF 自体の網羅テストはフロント側 builder/src/features/expression/registerNfbUdfs.test.js
 * が同一コードに対して行うため、ここでは「GAS の nfbEvaluateExpression_ が alasql 経由で
 * 期待どおり動く」ことの代表ケースのみ確認する（vm = V8 なので GAS V8 とほぼ等価）。
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadEvaluator() {
  const ctx = { console };
  vm.createContext(ctx);
  const gasDir = path.join(__dirname, "..", "gas");
  for (const name of ["vendor/alasql.min.js", "generated/nfbAlasqlUdfs.gs", "expressionEvaluator.gs"]) {
    const gasFile = path.join(gasDir, name);
    vm.runInContext(fs.readFileSync(gasFile, "utf8"), ctx, { filename: gasFile });
  }
  return ctx;
}

// 評価器は1度ロードすればプロセス内キャッシュが効くので使い回す。
const ctx = loadEvaluator();
function ev(expr, row) {
  return ctx.nfbEvaluateExpression_(expr, row || {});
}

test("リテラル / 算術 / 連結", () => {
  assert.equal(ev("1 + 2 * 3"), 7);
  assert.equal(ev("(1 + 2) * 3"), 9);
  assert.equal(ev("'a' || 'b' || 'c'"), "abc");
  assert.equal(ev("'hello'"), "hello");
});

test("バッククォート識別子で row を引く（パイプ含み・冪等正規化）", () => {
  assert.equal(ev("`x`", { x: 42 }), 42);
  assert.equal(ev("`氏名`", { 氏名: "tanaka" }), "tanaka");
  assert.equal(ev("`基本情報|区`", { "基本情報|区": "中央" }), "中央");
  // 行キーが既に __ 化されていても引ける
  assert.equal(ev("`基本情報|区`", { "基本情報__区": "中央" }), "中央");
  assert.equal(ev("`基本情報|区` || '-' || `親|子`", { "基本情報|区": "中央", "親|子": "太郎" }), "中央-太郎");
});

test("比較 / CASE / IIF（文字列比較は alasql ネイティブ）", () => {
  assert.equal(ev("`d` >= '2024-01-01'", { d: "2024-05-05" }), true);
  assert.equal(ev("`d` < '2024-01-01'", { d: "2023-12-31" }), true);
  assert.equal(ev("CASE WHEN `n` < 10 THEN 'low' WHEN `n` < 100 THEN 'mid' ELSE 'high' END", { n: 50 }), "mid");
  assert.equal(ev("IIF(`age` >= 20, '大人', '子供')", { age: 25 }), "大人");
});

test("日付/和暦 UDF（canonical 文字列）", () => {
  assert.equal(ev("DATE('2020-1-1')"), "2020/01/01");
  assert.equal(ev("DATE('2020-01-01 23:00:23')"), "2020/01/01");
  assert.equal(ev("DATETIME('2020-1-1')"), "2020/01/01 00:00:00.000");
  assert.equal(ev("TIME('2020-01-01 22:23:34')"), "22:23:34.000");
  assert.equal(ev("YEAR('2025-03-15')"), 2025);
  assert.equal(ev("MONTH('2025-03-15')"), 3);
  assert.equal(ev("TIMESTAMP('00:01:00')"), 60000);
  assert.equal(ev("DATE2ERA('2019-05-01')"), "令和元年5月1日");
  assert.equal(ev("ERA2DATE('令和元年5月1日')"), "2019/05/01");
  assert.equal(ev("TIME_FORMAT('2025-05-05', 'gge年MM月DD日(ddd)')"), "令和7年05月05日(月)");
});

test("TIMES / TIMEM / TIMEMS と TIME-only→DATETIME 基準日（フロントと同一セマンティクス）", () => {
  const T = "2020/04/02 12:34:56.789";
  assert.equal(ev(`TIMES('${T}')`), "12:34:56");
  assert.equal(ev(`TIMEM('${T}')`), "12:34");
  assert.equal(ev(`TIMEMS('${T}')`), "12:34:56.789");
  // 合成: TIME(TIMEM(T)) → ミリ秒まで 0 埋め
  assert.equal(ev(`TIME(TIMEM('${T}'))`), "12:34:00.000");
  // 合成: DATETIME(TIMEM(T)) → 基準日 1970/01/01（UNIX エポック日）
  assert.equal(ev(`DATETIME(TIMEM('${T}'))`), "1970/01/01 12:34:00.000");
  assert.equal(ev("DATE('13:01:00')"), "1970/01/01");
});

test("文字列/数値/その他 UDF", () => {
  assert.equal(ev("UPPER('aBc')"), "ABC");
  assert.equal(ev("SUBSTRING('abcdef', 2, 3)"), "bcd");
  assert.equal(ev("LPAD('5', 3, '0')"), "005");
  assert.equal(ev("NUMBER_FORMAT(1234567, '#,##0')"), "1,234,567");
  assert.equal(ev("KANA('あいう')"), "アイウ");
  assert.equal(ev("DEFAULT('', '未入力')"), "未入力");
  assert.equal(ev("TO_NUMBER('42')"), 42);
  assert.equal(ev("REGEXP_MATCH('user@example.com', '(.+)@(.+)', 1)"), "user");
  // REGEXP_REPLACE は JS 標準 String.replace + 'g' フラグそのまま
  assert.equal(ev("REGEXP_REPLACE('a1b2c3', '\\d', 'X')"), "aXbXcX");
  // 判定はネイティブ REGEXP_LIKE / REGEXP 演算子に委ねる
  assert.equal(ev("REGEXP_LIKE('abc123', '[0-9]+')"), true);
  assert.equal(ev("'abc123' REGEXP '[0-9]+'"), true);
  assert.equal(ev("REGEXP_LIKE('ABC', '[a-z]+', 'i')"), true);
  assert.equal(ev("REGEXP_LIKE('ABC', '[a-z]+')"), false); // case-sensitive 確認
});

test("fileUpload 系 UDF（行値が配列）", () => {
  const row = { files: [
    { name: "a.pdf", driveFileUrl: "https://drive/1", folderName: "案件A", folderUrl: "https://drive/folder" },
    { name: "b.pdf", driveFileUrl: "https://drive/2", folderName: "案件A", folderUrl: "https://drive/folder" },
  ] };
  assert.equal(ev("FILE_NAMES(`files`)", row), "a.pdf, b.pdf");
  assert.equal(ev("FOLDER_URL(`files`)", row), "https://drive/folder");
});

test("空 / null の式は null", () => {
  assert.equal(ev(""), null);
  assert.equal(ev(null), null);
});

test("不正な式は throw する", () => {
  assert.throws(() => ev("UPPER('a',"));
  assert.throws(() => ev("THIS IS NOT SQL @@@"));
});

/**
 * テンプレート評価のフロント / GAS 等価性テスト。
 *
 * フロント (builder/src/features/expression/templateEvaluator.js) も GAS
 * (gas/templateEvaluator.gs + gas/expressionEvaluator.gs) も、同じ alasql 本体
 * (gas/vendor/alasql.min.js) + 同じ UDF バンドル (gas/generated/nfbAlasqlUdfs.gs —
 * builder の registerNfbUdfs.js / dateTime.js / eraConversion.js / kanaTables.js を
 * esbuild で IIFE 化したもの) を使う。テンプレートのスキャナ / カンマ列リスト分割 /
 * 値の文字列化だけが両側それぞれの実装なので、ここではそこを含めた end-to-end の出力が
 * alasql セマンティクスに整合することを GAS 側で確認する（vm = V8 なので GAS V8 と等価）。
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadGas() {
  const ctx = { console, Logger: { log() {} } };
  vm.createContext(ctx);
  const gasDir = path.join(__dirname, "..", "gas");
  for (const file of ["vendor/alasql.min.js", "generated/nfbAlasqlUdfs.gs", "pathCodec.gs", "expressionEvaluator.gs", "templateEvaluator.gs"]) {
    const p = path.join(gasDir, file);
    vm.runInContext(fs.readFileSync(p, "utf8"), ctx, { filename: p });
  }
  return ctx;
}

const cases = [
  // --- 基本: 識別子 / 連結 / リテラル ---
  { name: "ident: 単純参照",       template: "{{`氏名`}}",                              row: { 氏名: "tanaka" }, expected: "tanaka" },
  { name: "ident: 連結",           template: "{{`姓` || `名`}}",                        row: { 姓: "山田", 名: "太郎" }, expected: "山田太郎" },
  { name: "ident: 連結 + リテラル", template: "Hello {{`name`}}!",                      row: { name: "world" }, expected: "Hello world!" },
  { name: "missing: NULL → 空",    template: "[{{`missing`}}]",                        row: {}, expected: "[]" },

  // --- 文字列関数 ---
  { name: "UPPER",                 template: "{{UPPER(`name`)}}",                       row: { name: "tanaka" }, expected: "TANAKA" },
  { name: "LOWER",                 template: "{{LOWER(`name`)}}",                       row: { name: "TANAKA" }, expected: "tanaka" },
  { name: "TRIM",                  template: "{{TRIM(`s`)}}",                           row: { s: "  abc  " }, expected: "abc" },
  { name: "LEFT",                  template: "{{LEFT(`s`,3)}}",                         row: { s: "あいうえお" }, expected: "あいう" },
  { name: "RIGHT",                 template: "{{RIGHT(`s`,2)}}",                        row: { s: "あいうえお" }, expected: "えお" },
  { name: "SUBSTRING 1-origin",    template: "{{SUBSTRING(`s`,2,3)}}",                  row: { s: "abcdef" }, expected: "bcd" },
  { name: "REPLACE",               template: "{{REPLACE(`s`,'-','/')}}",                row: { s: "a-b-c" }, expected: "a/b/c" },
  { name: "CONCAT 関数",           template: "{{CONCAT('[', `s`, ']')}}",               row: { s: "x" }, expected: "[x]" },
  { name: "LENGTH",                template: "{{LENGTH(`s`)}}",                         row: { s: "abc" }, expected: "3" },

  // --- 算術 / 比較 / 条件 ---
  { name: "算術 + * 優先",         template: "{{1 + 2 * 3}}",                           row: {}, expected: "7" },
  { name: "比較 -> bool 文字列",   template: "{{`age` >= 20}}",                         row: { age: 25 }, expected: "true" },
  { name: "IIF",                   template: "{{IIF(`age` >= 20, '大人', '子供')}}",    row: { age: 25 }, expected: "大人" },
  { name: "IIF false",             template: "{{IIF(`age` >= 20, '大人', '子供')}}",    row: { age: 10 }, expected: "子供" },
  { name: "CASE WHEN",             template: "{{CASE WHEN `n`<10 THEN 'low' WHEN `n`<100 THEN 'mid' ELSE 'high' END}}", row: { n: 50 }, expected: "mid" },
  // alasql ネイティブ COALESCE は NULL のみスキップ（空文字は値とみなす）。
  // 「空文字も埋める」挙動が欲しい場合は DEFAULT を使う。
  { name: "COALESCE (NULL skip)",  template: "{{COALESCE(`a`, `b`, 'def')}}",           row: { a: null, b: "" }, expected: "" },

  // --- 日時関数 ---
  { name: "YEAR",                  template: "{{YEAR(`d`)}}",                           row: { d: "2025-03-15" }, expected: "2025" },
  { name: "MONTH",                 template: "{{MONTH(`d`)}}",                          row: { d: "2025-03-15" }, expected: "3" },
  { name: "DAY",                   template: "{{DAY(`d`)}}",                            row: { d: "2025-03-15" }, expected: "15" },
  { name: "HOUR",                  template: "{{HOUR(`d`)}}",                           row: { d: "2025-03-15 10:22:33" }, expected: "10" },
  { name: "DATE canonical",        template: "{{DATE(`d`)}}",                           row: { d: "2020-1-1" }, expected: "2020-01-01" },
  { name: "DATE truncate time",    template: "{{DATE(`d`)}}",                           row: { d: "2020-01-01 23:00:23" }, expected: "2020-01-01" },
  { name: "DATETIME canonical",    template: "{{DATETIME(`d`)}}",                       row: { d: "2020-1-1" }, expected: "2020-01-01_00:00:00.000" },
  { name: "TIME canonical",        template: "{{TIME(`d`)}}",                           row: { d: "13:01" }, expected: "13:01:00.000" },
  { name: "TIME from datetime",    template: "{{TIME(`d`)}}",                           row: { d: "2020-01-01 22:23:34" }, expected: "22:23:34.000" },
  { name: "TIMESTAMP time-only",   template: "{{TIMESTAMP(`d`)}}",                      row: { d: "00:01:00" }, expected: "60000" },
  { name: "DATE2ERA 元年",         template: "{{DATE2ERA(`d`)}}",                       row: { d: "2019-05-01" }, expected: "令和元年5月1日" },
  { name: "DATETIME2ERATIME",      template: "{{DATETIME2ERATIME(`d`)}}",               row: { d: "2020-04-15 10:22:00" }, expected: "令和2年4月15日 10時22分00秒" },
  { name: "ERA2DATE",              template: "{{ERA2DATE(`d`)}}",                       row: { d: "令和元年5月1日" }, expected: "2019-05-01" },
  { name: "ERATIME2DATETIME",      template: "{{ERATIME2DATETIME(`d`)}}",               row: { d: "令和元年02月4日 13時" }, expected: "2019-02-04_13:00:00.000" },

  // --- * UDF ---
  { name: "TIME_FORMAT 西暦",  template: "{{TIME_FORMAT(`d`,'YYYY/MM/DD')}}",   row: { d: "2025-05-05" }, expected: "2025/05/05" },
  { name: "TIME_FORMAT 和暦",  template: "{{TIME_FORMAT(`d`,'gge年MM月DD日(ddd)')}}", row: { d: "2025-05-05" }, expected: "令和7年05月05日(月)" },
  { name: "TIME_FORMAT 平成",  template: "{{TIME_FORMAT(`d`,'gge年')}}",        row: { d: "2000-01-15" }, expected: "平成12年" },
  { name: "NUMBER_FORMAT",     template: "{{NUMBER_FORMAT(`n`,'#,##0円')}}",    row: { n: 1234567 }, expected: "1,234,567円" },
  { name: "DEFAULT empty",     template: "{{DEFAULT(`v`,'未入力')}}",           row: { v: "" }, expected: "未入力" },
  { name: "DEFAULT value",     template: "{{DEFAULT(`v`,'未入力')}}",           row: { v: "x" }, expected: "x" },
  { name: "KANA",              template: "{{KANA(`s`)}}",                       row: { s: "あいう" }, expected: "アイウ" },
  { name: "ZEN",               template: "{{ZEN(`s`)}}",                        row: { s: "abc" }, expected: "ａｂｃ" },
  { name: "HAN",               template: "{{HAN(`s`)}}",                        row: { s: "ＡＢＣ" }, expected: "ABC" },
  { name: "NOEXT",             template: "{{NOEXT(`s`)}}",                      row: { s: "a.pdf, b.png" }, expected: "a, b" },
  { name: "LPAD",              template: "{{LPAD(`n`,4,'0')}}",                 row: { n: "5" }, expected: "0005" },
  { name: "REGEXP_LIKE true",   template: "{{REGEXP_LIKE(`s`,'^foo')}}",         row: { s: "foobar" }, expected: "true" },
  { name: "REGEXP_MATCH group", template: "{{REGEXP_MATCH(`s`,'(.+)@(.+)',1)}}", row: { s: "user@example.com" }, expected: "user" },
  { name: "REGEXP_REPLACE",     template: "{{REGEXP_REPLACE(`s`,'\\d','X')}}",   row: { s: "a1b2c3" }, expected: "aXbXcX" },
  { name: "TO_NUMBER",         template: "{{TO_NUMBER(`s`)}}",                  row: { s: "42" }, expected: "42" },
  { name: "TO_BOOL false",     template: "{{TO_BOOL(`s`)}}",                    row: { s: "0" }, expected: "false" },

  // --- 複合 ---
  { name: "ネスト関数",            template: "{{UPPER(LEFT(`s`,3))}}",                  row: { s: "hello" }, expected: "HEL" },
  { name: "条件 + 連結",           template: "{{IIF(`n`>0,'+','-')}}{{`n`}}",           row: { n: 5 }, expected: "+5" },
  { name: "テンプレ複数",          template: "[{{`a`}}][{{`b`}}]",                      row: { a: 1, b: 2 }, expected: "[1][2]" },
  // NOW() は実行時刻なので等価テスト対象から外す（両ランタイムでフォーマット形式の同一性は別テストで担保）

  // --- ファイル系 UDF ---
  {
    name: "FILE_NAMES",
    template: "{{FILE_NAMES(`files`)}}",
    row: { files: [{ name: "a.pdf", driveFileUrl: "https://x/1" }, { name: "b.pdf", driveFileUrl: "https://x/2" }] },
    expected: "a.pdf, b.pdf",
  },
  {
    name: "FOLDER_URL",
    template: "{{FOLDER_URL(`files`)}}",
    row: { files: [{ name: "a.pdf", folderName: "F1", folderUrl: "https://drv/F1" }] },
    expected: "https://drv/F1",
  },

  // --- リテラル / エスケープ ---
  { name: "{{ なし passthrough",   template: "no tokens here",                          row: {}, expected: "no tokens here" },
  { name: "エスケープ \\{ \\}",    template: String.raw`raw \{not eval\} end`,          row: {}, expected: "raw {not eval} end" },
  // 単一ブレース `{...}` は廃止（リテラル）。両実装とも素通しすることを確認する。
  { name: "単一ブレースはリテラル", template: "{`氏名`}",                               row: { 氏名: "tanaka" }, expected: "{`氏名`}" },
];

for (const c of cases) {
  test("equivalence: " + c.name, () => {
    const gas = loadGas();
    const got = gas.nfbEvaluateTemplate_(c.template, c.row);
    assert.equal(got, c.expected, "GAS evaluator output mismatch for: " + c.template);
  });
}

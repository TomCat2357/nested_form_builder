// 旧フラット形式 (v1) の GUI クエリを compileStages の auto-migration 経由で
// SQL にコンパイルできることを保証する E2E テスト。
import assert from "node:assert/strict";
import test from "node:test";
import { compileStages } from "./compileStages.js";
import { canonicalFormAlias } from "./sqlPreprocessor.js";

const formId = "f_complaint";
const tableAlias = canonicalFormAlias(formId);

const formColumns = [
  { key: "受付日", alaSqlKey: "受付日", path: ["受付日"], label: "受付日" },
  { key: "基本情報|区", alaSqlKey: "基本情報__区", path: ["基本情報", "区"], label: "区" },
  { key: "基本情報|金額", alaSqlKey: "基本情報__金額", path: ["基本情報", "金額"], label: "金額" },
  { key: "氏名", alaSqlKey: "氏名", path: ["氏名"], label: "氏名" },
];

function compile(gui) {
  return compileStages(gui, { formColumns });
}

test("count(*) のみ・グループ化なし", () => {
  const r = compile({
    formId,
    aggregations: [{ id: "a_1", type: "count" }],
    groupBy: [],
    filters: [],
  });
  assert.equal(r.ok, true);
  assert.equal(r.sql, "SELECT COUNT(*) AS [件数] FROM " + tableAlias);
  assert.deepEqual(r.columns, [{ name: "件数", role: "metric", aggId: "件数", aggType: "count", type: "number", displayLabel: "件数", srcAggId: "a_1" }]);
});

test("sum + avg と groupBy 1 つ", () => {
  const r = compile({
    formId,
    aggregations: [
      { id: "a_1", type: "sum", column: "基本情報|金額" },
      { id: "a_2", type: "avg", column: "基本情報|金額" },
    ],
    groupBy: [{ column: "基本情報|区" }],
    filters: [],
  });
  assert.equal(r.ok, true);
  assert.match(r.sql, /SELECT \[基本情報__区\] AS \[基本情報__区\], SUM\(\[基本情報__金額\]\) AS \[基本情報__金額_合計\], AVG\(\[基本情報__金額\]\) AS \[基本情報__金額_平均\]/);
  assert.match(r.sql, new RegExp("FROM " + tableAlias));
  assert.match(r.sql, /GROUP BY \[基本情報__区\]/);
  assert.equal(r.columns[0].role, "dimension");
  assert.equal(r.columns[1].role, "metric");
  assert.equal(r.columns[1].aggId, "基本情報__金額_合計");
  assert.equal(r.columns[1].srcAggId, "a_1");
});

test("groupBy 2 つで両方の列が SELECT と GROUP BY に並ぶ", () => {
  const r = compile({
    formId,
    aggregations: [{ id: "a_1", type: "count" }],
    groupBy: [{ column: "基本情報|区" }, { column: "氏名" }],
    filters: [],
  });
  assert.equal(r.ok, true);
  assert.match(r.sql, /SELECT \[基本情報__区\] AS \[基本情報__区\], \[氏名\] AS \[氏名\]/);
  assert.match(r.sql, /GROUP BY \[基本情報__区\], \[氏名\]/);
});

test("各種フィルター演算子", () => {
  const cases = [
    { op: "=", value: 100, want: /WHERE \[基本情報__金額\] = 100/ },
    { op: "!=", value: "X", want: /WHERE \[基本情報__区\] != 'X'/, col: "基本情報|区" },
    { op: ">", value: 50, want: /WHERE \[基本情報__金額\] > 50/ },
    { op: ">=", value: 50, want: /WHERE \[基本情報__金額\] >= 50/ },
    { op: "<", value: 50, want: /WHERE \[基本情報__金額\] < 50/ },
    { op: "<=", value: 50, want: /WHERE \[基本情報__金額\] <= 50/ },
    { op: "between", value: 10, value2: 20, want: /WHERE \[基本情報__金額\] BETWEEN 10 AND 20/ },
    { op: "contains", value: "abc", want: /WHERE \[氏名\] LIKE '%abc%'/, col: "氏名" },
    { op: "startsWith", value: "Mr", want: /WHERE \[氏名\] LIKE 'Mr%'/, col: "氏名" },
    { op: "isNull", want: /WHERE \[氏名\] IS NULL/, col: "氏名" },
    { op: "isNotNull", want: /WHERE \[氏名\] IS NOT NULL/, col: "氏名" },
    { op: "in", value: ["A", "B"], want: /WHERE \[基本情報__区\] IN \('A', 'B'\)/, col: "基本情報|区" },
  ];
  for (const c of cases) {
    const filter = { id: "f1", column: c.col || "基本情報|金額", operator: c.op };
    if (c.value !== undefined) filter.value = c.value;
    if (c.value2 !== undefined) filter.value2 = c.value2;
    const r = compile({
      formId,
      aggregations: [{ id: "a_1", type: "count" }],
      groupBy: [],
      filters: [filter],
    });
    assert.equal(r.ok, true, "operator " + c.op + " should compile: " + JSON.stringify(r));
    assert.match(r.sql, c.want, "operator " + c.op + " SQL: " + r.sql);
  }
});

test("文字列リテラルのシングルクォートをエスケープ", () => {
  const r = compile({
    formId,
    aggregations: [{ id: "a_1", type: "count" }],
    groupBy: [],
    filters: [{ id: "f1", column: "氏名", operator: "=", value: "O'Brien" }],
  });
  assert.equal(r.ok, true);
  assert.match(r.sql, /\[氏名\] = 'O''Brien'/);
});

test("date bucket month で SUBSTRING(DATETIME(...), 1, 7) に変換", () => {
  const r = compile({
    formId,
    aggregations: [{ id: "a_1", type: "count" }],
    groupBy: [{ column: "受付日", bucket: "month" }],
    filters: [],
  });
  assert.equal(r.ok, true);
  assert.match(r.sql, /SELECT SUBSTRING\(DATETIME\(\[受付日\]\), 1, 7\) AS \[受付日__month\]/);
  assert.match(r.sql, /GROUP BY SUBSTRING\(DATETIME\(\[受付日\]\), 1, 7\)/);
});

test("orderBy と limit が出力される", () => {
  const r = compile({
    formId,
    aggregations: [{ id: "a_1", type: "count" }],
    groupBy: [{ column: "基本情報|区" }],
    filters: [],
    orderBy: [
      { ref: "agg:a_1", direction: "desc" },
      { ref: "col:基本情報|区", direction: "asc" },
    ],
    limit: 10,
  });
  assert.equal(r.ok, true);
  assert.match(r.sql, /ORDER BY \[件数\] DESC, \[基本情報__区\] ASC/);
  assert.match(r.sql, /LIMIT 10$/);
});

test("formId が無いとエラー", () => {
  const r = compile({ aggregations: [{ id: "a_1", type: "count" }] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /フォーム/);
});

test("aggregations が空だとエラー", () => {
  const r = compile({ formId, aggregations: [] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /集計/);
});

test("raw mode: aggregations に type:raw があれば SELECT * を返す", () => {
  const r = compile({
    formId,
    aggregations: [{ id: "a_1", type: "raw" }],
    groupBy: [],
    filters: [],
  });
  assert.equal(r.ok, true);
  assert.equal(r.sql, "SELECT * FROM " + tableAlias);
  assert.deepEqual(r.columns, []);
});

test("raw mode + filter で WHERE 句が出る", () => {
  const r = compile({
    formId,
    aggregations: [{ id: "a_1", type: "raw" }],
    groupBy: [],
    filters: [{ id: "f1", column: "基本情報|金額", operator: ">", value: 100 }],
  });
  assert.equal(r.ok, true);
  assert.match(r.sql, new RegExp("SELECT \\* FROM " + tableAlias + " WHERE \\[基本情報__金額\\] > 100"));
});

test("raw mode + limit で LIMIT が出る", () => {
  const r = compile({
    formId,
    aggregations: [{ id: "a_1", type: "raw" }],
    groupBy: [],
    filters: [],
    limit: 50,
  });
  assert.equal(r.ok, true);
  assert.match(r.sql, new RegExp("SELECT \\* FROM " + tableAlias + " LIMIT 50"));
});

test("raw mode が含まれていれば groupBy は無視される", () => {
  const r = compile({
    formId,
    aggregations: [{ id: "a_1", type: "raw" }],
    groupBy: [{ column: "基本情報|区" }],
    filters: [],
  });
  assert.equal(r.ok, true);
  assert.equal(r.sql, "SELECT * FROM " + tableAlias);
  assert.doesNotMatch(r.sql, /GROUP BY/);
});

test("raw mode が含まれていれば他の集計種別も無視される", () => {
  const r = compile({
    formId,
    aggregations: [
      { id: "a_1", type: "raw" },
      { id: "a_2", type: "sum", column: "基本情報|金額" },
    ],
    groupBy: [],
    filters: [],
  });
  assert.equal(r.ok, true);
  assert.equal(r.sql, "SELECT * FROM " + tableAlias);
});

test("sum などで column が無いとエラー", () => {
  const r = compile({
    formId,
    aggregations: [{ id: "a_1", type: "sum" }],
    groupBy: [],
    filters: [],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /集計対象の列/);
});

test("columns 配列は dimension → metric の順で metric には aggId が付く", () => {
  const r = compile({
    formId,
    aggregations: [
      { id: "a_1", type: "count" },
      { id: "a_2", type: "sum", column: "基本情報|金額" },
    ],
    groupBy: [{ column: "基本情報|区" }],
    filters: [],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.columns, [
    { name: "基本情報__区", role: "dimension", type: "unknown", displayLabel: "区" },
    { name: "件数", role: "metric", aggId: "件数", aggType: "count", type: "number", displayLabel: "件数", srcAggId: "a_1" },
    { name: "基本情報__金額_合計", role: "metric", aggId: "基本情報__金額_合計", aggType: "sum", type: "number", displayLabel: "金額 合計", srcAggId: "a_2" },
  ]);
});

test("aggregations の column が '*'（全列対象）でも auto-migration 経由でコンパイルできる", () => {
  const typed = [
    { key: "基本情報|金額", alaSqlKey: "基本情報__金額", path: ["基本情報", "金額"], label: "金額", type: "number" },
    { key: "在庫", alaSqlKey: "在庫", path: ["在庫"], label: "在庫", type: "number" },
    { key: "氏名", alaSqlKey: "氏名", path: ["氏名"], label: "氏名", type: "string" },
  ];
  const r = compileStages({
    formId,
    aggregations: [{ id: "a_1", type: "max", column: "*" }],
    groupBy: [],
    filters: [],
  }, { formColumns: typed });
  assert.equal(r.ok, true);
  // 数値列はネイティブ MAX、非数値列（氏名 = string）は STR_MAX UDF
  assert.match(r.sql, /\bMAX\(\[基本情報__金額\]\) AS \[基本情報__金額_最大\]/);
  assert.match(r.sql, /\bMAX\(\[在庫\]\) AS \[在庫_最大\]/);
  assert.match(r.sql, /STR_MAX\(\[氏名\]\) AS \[氏名_最大\]/);
  assert.equal(r.columns.length, 3);
});

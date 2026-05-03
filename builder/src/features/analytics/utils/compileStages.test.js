import assert from "node:assert/strict";
import test from "node:test";
import { compileStages } from "./compileStages.js";
import { canonicalFormAlias } from "./sqlPreprocessor.js";

const formId = "f_complaint";
const tableAlias = canonicalFormAlias(formId);

const snapshotColumns = [
  { key: "受付日", alaSqlKey: "受付日", path: ["受付日"], label: "受付日" },
  { key: "基本情報|区", alaSqlKey: "基本情報__区", path: ["基本情報", "区"], label: "区" },
  { key: "基本情報|金額", alaSqlKey: "基本情報__金額", path: ["基本情報", "金額"], label: "金額" },
  { key: "氏名", alaSqlKey: "氏名", path: ["氏名"], label: "氏名" },
];

function compile(stages) {
  return compileStages({ schemaVersion: 2, stages }, { snapshotColumns });
}

const PICK = { id: "s_1", type: "pick_data", source: { kind: "form", formId } };

test("pick_data + summarize(count): SELECT COUNT(*) FROM table", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "summarize", aggregations: [{ id: "a_1", type: "count" }], groupBy: [] },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.sql, "SELECT COUNT(*) AS [a_1] FROM " + tableAlias);
  assert.deepEqual(r.columns, [{ name: "a_1", role: "metric", aggId: "a_1", aggType: "count", type: "number" }]);
});

test("pick_data のみ (raw mode): SELECT * FROM table", () => {
  const r = compile([PICK]);
  assert.equal(r.ok, true);
  assert.equal(r.sql, "SELECT * FROM " + tableAlias);
  assert.deepEqual(r.columns, []);
});

test("pick_data + filter + summarize: WHERE と GROUP BY", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "filter", conditions: [
      { column: "基本情報|金額", operator: ">", value: 100 },
    ] },
    { id: "s_3", type: "summarize",
      aggregations: [{ id: "a_1", type: "sum", column: "基本情報|金額" }],
      groupBy: [{ column: "基本情報|区" }],
    },
  ]);
  assert.equal(r.ok, true);
  assert.match(r.sql, /WHERE \[基本情報__金額\] > 100/);
  assert.match(r.sql, /GROUP BY \[基本情報__区\]/);
  assert.match(r.sql, /SUM\(\[基本情報__金額\]\) AS \[a_1\]/);
});

test("summarize 後の filter は HAVING になる", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "summarize",
      aggregations: [{ id: "a_1", type: "sum", column: "基本情報|金額" }],
      groupBy: [{ column: "基本情報|区" }],
    },
    { id: "s_3", type: "filter", conditions: [
      { column: "a_1", operator: ">", value: 1000 },
    ] },
  ]);
  assert.equal(r.ok, true);
  assert.match(r.sql, /HAVING \[a_1\] > 1000/);
});

test("date bucket month で NFB_DATE_BIN に変換", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "summarize",
      aggregations: [{ id: "a_1", type: "count" }],
      groupBy: [{ column: "受付日", bucket: "month" }],
    },
  ]);
  assert.equal(r.ok, true);
  assert.match(r.sql, /NFB_DATE_BIN\(\[受付日\], 7\) AS \[受付日__month\]/);
  assert.match(r.sql, /GROUP BY NFB_DATE_BIN\(\[受付日\], 7\)/);
});

test("date bucket year/day", () => {
  const ry = compile([
    PICK,
    { id: "s_2", type: "summarize",
      aggregations: [{ id: "a_1", type: "count" }],
      groupBy: [{ column: "受付日", bucket: "year" }],
    },
  ]);
  assert.match(ry.sql, /NFB_DATE_BIN\(\[受付日\], 4\) AS \[受付日__year\]/);

  const rd = compile([
    PICK,
    { id: "s_2", type: "summarize",
      aggregations: [{ id: "a_1", type: "count" }],
      groupBy: [{ column: "受付日", bucket: "day" }],
    },
  ]);
  assert.match(rd.sql, /NFB_DATE_BIN\(\[受付日\], 10\) AS \[受付日__day\]/);
});

test("sort + limit", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "summarize",
      aggregations: [{ id: "a_1", type: "count" }],
      groupBy: [{ column: "基本情報|区" }],
    },
    { id: "s_3", type: "sort", entries: [
      { column: "a_1", direction: "desc" },
      { column: "基本情報|区", direction: "asc" },
    ] },
    { id: "s_4", type: "limit", count: 10 },
  ]);
  assert.equal(r.ok, true);
  assert.match(r.sql, /ORDER BY \[a_1\] DESC, \[基本情報__区\] ASC/);
  assert.match(r.sql, /LIMIT 10$/);
});

test("各種フィルター演算子", () => {
  const cases = [
    { op: "=", value: 100, want: /WHERE \[基本情報__金額\] = 100/ },
    { op: "!=", value: "X", want: /WHERE \[基本情報__区\] != 'X'/, col: "基本情報|区" },
    { op: ">", value: 50, want: /WHERE \[基本情報__金額\] > 50/ },
    { op: "between", value: 10, value2: 20, want: /WHERE \[基本情報__金額\] BETWEEN 10 AND 20/ },
    { op: "contains", value: "abc", want: /WHERE \[氏名\] LIKE '%abc%'/, col: "氏名" },
    { op: "isNull", want: /WHERE \[氏名\] IS NULL/, col: "氏名" },
    { op: "in", value: ["A", "B"], want: /WHERE \[基本情報__区\] IN \('A', 'B'\)/, col: "基本情報|区" },
  ];
  for (const c of cases) {
    const cond = { column: c.col || "基本情報|金額", operator: c.op };
    if (c.value !== undefined) cond.value = c.value;
    if (c.value2 !== undefined) cond.value2 = c.value2;
    const r = compile([
      PICK,
      { id: "s_f", type: "filter", conditions: [cond] },
      { id: "s_s", type: "summarize", aggregations: [{ id: "a_1", type: "count" }], groupBy: [] },
    ]);
    assert.equal(r.ok, true, "operator " + c.op + ": " + JSON.stringify(r));
    assert.match(r.sql, c.want, "operator " + c.op + " SQL: " + r.sql);
  }
});

test("formId が無いとエラー", () => {
  const r = compile([{ id: "s_1", type: "pick_data", source: { kind: "form" } }]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /フォーム/);
});

test("最初のステージが pick_data でないとエラー", () => {
  const r = compile([
    { id: "s_1", type: "filter", conditions: [] },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /pick_data/);
});

test("ステージが空だとエラー", () => {
  const r = compile([]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /ステージ/);
});

test("limit が最後でないとエラー", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "limit", count: 10 },
    { id: "s_3", type: "summarize", aggregations: [{ id: "a_1", type: "count" }], groupBy: [] },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /limit/);
});

test("sum で column が無いとエラー", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "summarize", aggregations: [{ id: "a_1", type: "sum" }], groupBy: [] },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /集計対象の列/);
});

test("join / custom_columns は Step 1 では未対応", () => {
  const r1 = compile([PICK, { id: "s_2", type: "join" }]);
  assert.equal(r1.ok, false);
  assert.match(r1.errors.join(" "), /join/);

  const r2 = compile([PICK, { id: "s_2", type: "custom_columns" }]);
  assert.equal(r2.ok, false);
  assert.match(r2.errors.join(" "), /custom_columns/);
});

test("Question を入力にする pick_data は Step 7 で対応", () => {
  const r = compileStages({
    schemaVersion: 2,
    stages: [{ id: "s_1", type: "pick_data", source: { kind: "question", questionId: "q_1" } }],
  }, { snapshotColumns });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /Question/);
});

test("複数 summarize は Step 4 で対応", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "summarize", aggregations: [{ id: "a_1", type: "count" }], groupBy: [] },
    { id: "s_3", type: "summarize", aggregations: [{ id: "a_2", type: "count" }], groupBy: [] },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /summarize/);
});

test("文字列リテラルのシングルクォートをエスケープ", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "filter", conditions: [
      { column: "氏名", operator: "=", value: "O'Brien" },
    ] },
    { id: "s_3", type: "summarize", aggregations: [{ id: "a_1", type: "count" }], groupBy: [] },
  ]);
  assert.equal(r.ok, true);
  assert.match(r.sql, /\[氏名\] = 'O''Brien'/);
});

test("snapshotColumns に type が付くと sum on string はエラー", () => {
  const typed = [
    { key: "氏名", alaSqlKey: "氏名", path: ["氏名"], label: "氏名", type: "string" },
    { key: "基本情報|金額", alaSqlKey: "基本情報__金額", path: ["基本情報", "金額"], label: "金額", type: "number" },
  ];
  const r = compileStages({
    schemaVersion: 2,
    stages: [
      PICK,
      { id: "s_2", type: "summarize",
        aggregations: [{ id: "a_1", type: "sum", column: "氏名" }],
        groupBy: [],
      },
    ],
  }, { snapshotColumns: typed });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /sum は string/);
});

test("snapshotColumns に type が付くと min on date は OK", () => {
  const typed = [
    { key: "受付日", alaSqlKey: "受付日", path: ["受付日"], label: "受付日", type: "date" },
  ];
  const r = compileStages({
    schemaVersion: 2,
    stages: [
      PICK,
      { id: "s_2", type: "summarize",
        aggregations: [{ id: "a_1", type: "min", column: "受付日" }],
        groupBy: [],
      },
    ],
  }, { snapshotColumns: typed });
  assert.equal(r.ok, true);
  assert.match(r.sql, /MIN\(\[受付日\]\) AS \[a_1\]/);
  // min/max は元列の型を継承
  assert.equal(r.columns[0].type, "date");
});

test("type が無い snapshotColumns は素通し（後方互換）", () => {
  // 既存の Step 1 テストでも素通ししていること（このテストは追加で明示）
  const noType = [
    { key: "any", alaSqlKey: "any", path: ["any"], label: "any" }, // type 無し
  ];
  const r = compileStages({
    schemaVersion: 2,
    stages: [
      PICK,
      { id: "s_2", type: "summarize",
        aggregations: [{ id: "a_1", type: "sum", column: "any" }],
        groupBy: [],
      },
    ],
  }, { snapshotColumns: noType });
  assert.equal(r.ok, true);
});

test("columns 配列は dimension → metric の順で metric に aggId が付く", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "summarize",
      aggregations: [
        { id: "a_1", type: "count" },
        { id: "a_2", type: "sum", column: "基本情報|金額" },
      ],
      groupBy: [{ column: "基本情報|区" }],
    },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.columns, [
    { name: "基本情報__区", role: "dimension", type: "unknown" },
    { name: "a_1", role: "metric", aggId: "a_1", aggType: "count", type: "number" },
    { name: "a_2", role: "metric", aggId: "a_2", aggType: "sum", type: "number" },
  ]);
});

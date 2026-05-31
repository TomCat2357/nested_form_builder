import assert from "node:assert/strict";
import test from "node:test";
import { compileStages } from "./compileStages.js";
import { canonicalFormAlias, canonicalDataAlias } from "./sqlPreprocessor.js";

const formId = "f_complaint";
const tableAlias = canonicalFormAlias(formId);

const formColumns = [
  { key: "受付日", alaSqlKey: "受付日", path: ["受付日"], label: "受付日" },
  { key: "基本情報|区", alaSqlKey: "基本情報__区", path: ["基本情報", "区"], label: "区" },
  { key: "基本情報|金額", alaSqlKey: "基本情報__金額", path: ["基本情報", "金額"], label: "金額" },
  { key: "氏名", alaSqlKey: "氏名", path: ["氏名"], label: "氏名" },
];

function compile(stages) {
  return compileStages({ schemaVersion: 2, stages }, { formColumns });
}

const PICK = { id: "s_1", type: "pick_data", source: { kind: "form", formId } };

test("pick_data + summarize(count): SELECT COUNT(*) FROM table", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "summarize", aggregations: [{ id: "a_1", type: "count" }], groupBy: [] },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.sql, "SELECT COUNT(*) AS [件数] FROM " + tableAlias);
  assert.deepEqual(r.columns, [{ name: "件数", role: "metric", aggId: "件数", aggType: "count", type: "number", displayLabel: "件数", srcAggId: "a_1" }]);
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
  assert.match(r.sql, /SUM\(\[基本情報__金額\]\) AS \[基本情報__金額_合計\]/);
});

test("summarize 後の filter は HAVING になる（旧 agg id 参照を可読別名へ解決）", () => {
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
  assert.match(r.sql, /HAVING \[基本情報__金額_合計\] > 1000/);
});

test("summarize 後の filter を可読別名で直接参照しても HAVING になる", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "summarize",
      aggregations: [{ id: "a_1", type: "sum", column: "基本情報|金額" }],
      groupBy: [{ column: "基本情報|区" }],
    },
    { id: "s_3", type: "filter", conditions: [
      { column: "基本情報__金額_合計", operator: ">", value: 1000 },
    ] },
  ]);
  assert.equal(r.ok, true);
  assert.match(r.sql, /HAVING \[基本情報__金額_合計\] > 1000/);
});

test("date bucket month で SUBSTRING(DATETIME(...), 1, 7) に変換", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "summarize",
      aggregations: [{ id: "a_1", type: "count" }],
      groupBy: [{ column: "受付日", bucket: "month" }],
    },
  ]);
  assert.equal(r.ok, true);
  assert.match(r.sql, /SUBSTRING\(DATETIME\(\[受付日\]\), 1, 7\) AS \[受付日__month\]/);
  assert.match(r.sql, /GROUP BY SUBSTRING\(DATETIME\(\[受付日\]\), 1, 7\)/);
});

test("date bucket year/day", () => {
  const ry = compile([
    PICK,
    { id: "s_2", type: "summarize",
      aggregations: [{ id: "a_1", type: "count" }],
      groupBy: [{ column: "受付日", bucket: "year" }],
    },
  ]);
  assert.match(ry.sql, /SUBSTRING\(DATETIME\(\[受付日\]\), 1, 4\) AS \[受付日__year\]/);

  const rd = compile([
    PICK,
    { id: "s_2", type: "summarize",
      aggregations: [{ id: "a_1", type: "count" }],
      groupBy: [{ column: "受付日", bucket: "day" }],
    },
  ]);
  assert.match(rd.sql, /SUBSTRING\(DATETIME\(\[受付日\]\), 1, 10\) AS \[受付日__day\]/);
});

test("sort + limit（旧 agg id 参照を可読別名へ解決）", () => {
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
  assert.match(r.sql, /ORDER BY \[件数\] DESC, \[基本情報__区\] ASC/);
  assert.match(r.sql, /LIMIT 10$/);
});

test("sort を可読別名で直接参照しても ORDER BY になる", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "summarize",
      aggregations: [{ id: "a_1", type: "sum", column: "基本情報|金額" }],
      groupBy: [{ column: "基本情報|区" }],
    },
    { id: "s_3", type: "sort", entries: [
      { column: "基本情報__金額_合計", direction: "desc" },
    ] },
  ]);
  assert.equal(r.ok, true);
  assert.match(r.sql, /ORDER BY \[基本情報__金額_合計\] DESC/);
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
  }, { formColumns });
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

test("formColumns に type が付くと sum on string はエラー", () => {
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
  }, { formColumns: typed });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /sum は string/);
});

test("formColumns に type が付くと min on date は OK", () => {
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
  }, { formColumns: typed });
  assert.equal(r.ok, true);
  // date 列の min は STR_MIN UDF（alasql 4 組み込み MIN は日付文字列を捨てるため）
  assert.match(r.sql, /STR_MIN\(\[受付日\]\) AS \[受付日_最小\]/);
  // min/max は元列の型を継承
  assert.equal(r.columns[0].type, "date");
  assert.equal(r.columns[0].name, "受付日_最小");
  assert.equal(r.columns[0].displayLabel, "受付日 最小");
});

test("type が無い formColumns は素通し（後方互換）", () => {
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
  }, { formColumns: noType });
  assert.equal(r.ok, true);
});

test("columns 配列は dimension → metric の順で metric に可読 aggId が付く", () => {
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
    { name: "基本情報__区", role: "dimension", type: "unknown", displayLabel: "区" },
    { name: "件数", role: "metric", aggId: "件数", aggType: "count", type: "number", displayLabel: "件数", srcAggId: "a_1" },
    { name: "基本情報__金額_合計", role: "metric", aggId: "基本情報__金額_合計", aggType: "sum", type: "number", displayLabel: "金額 合計", srcAggId: "a_2" },
  ]);
});

// ---- 「全列対象」(ALL_COLUMNS_TOKEN = "*") ----

const typedCols = [
  { key: "受付日", alaSqlKey: "受付日", path: ["受付日"], label: "受付日", type: "date" },
  { key: "基本情報|区", alaSqlKey: "基本情報__区", path: ["基本情報", "区"], label: "区", type: "string" },
  { key: "基本情報|金額", alaSqlKey: "基本情報__金額", path: ["基本情報", "金額"], label: "金額", type: "number" },
  { key: "在庫", alaSqlKey: "在庫", path: ["在庫"], label: "在庫", type: "number" },
  { key: "氏名", alaSqlKey: "氏名", path: ["氏名"], label: "氏名", type: "string" },
];

function compileTyped(stages) {
  return compileStages({ schemaVersion: 2, stages }, { formColumns: typedCols });
}

test("全列対象 max: 互換性のある全列へ展開する", () => {
  const r = compileTyped([
    PICK,
    { id: "s_2", type: "summarize", aggregations: [{ id: "a_1", type: "max", column: "*" }], groupBy: [] },
  ]);
  assert.equal(r.ok, true);
  // min/max は string/date/number すべて互換 → 5 列すべて。
  // 非数値列（date / string）は STR_MAX UDF、数値列はネイティブ MAX を吐く。
  assert.match(r.sql, /STR_MAX\(\[受付日\]\) AS \[受付日_最大\]/);
  assert.match(r.sql, /STR_MAX\(\[基本情報__区\]\) AS \[基本情報__区_最大\]/);
  assert.match(r.sql, /\bMAX\(\[基本情報__金額\]\) AS \[基本情報__金額_最大\]/);
  assert.match(r.sql, /\bMAX\(\[在庫\]\) AS \[在庫_最大\]/);
  assert.match(r.sql, /STR_MAX\(\[氏名\]\) AS \[氏名_最大\]/);
  assert.equal(r.columns.length, 5);
  for (const c of r.columns) {
    assert.equal(c.role, "metric");
    assert.equal(c.aggType, "max");
    assert.equal(c.srcAggId, "a_1");
  }
  // min/max は元列の型を継承
  const stockCol = r.columns.find((c) => c.name === "在庫_最大");
  assert.equal(stockCol.type, "number");
  assert.equal(stockCol.displayLabel, "在庫 最大");
});

test("全列対象 sum: 非数値列は除外する", () => {
  const r = compileTyped([
    PICK,
    { id: "s_2", type: "summarize", aggregations: [{ id: "a_1", type: "sum", column: "*" }], groupBy: [] },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.columns.length, 2);
  assert.match(r.sql, /SUM\(\[基本情報__金額\]\) AS \[基本情報__金額_合計\]/);
  assert.match(r.sql, /SUM\(\[在庫\]\) AS \[在庫_合計\]/);
  assert.doesNotMatch(r.sql, /SUM\(\[氏名\]\)/);
});

test("全列対象: 数値列が無いとエラー", () => {
  const stringOnly = [
    { key: "氏名", alaSqlKey: "氏名", path: ["氏名"], label: "氏名", type: "string" },
    { key: "区", alaSqlKey: "区", path: ["区"], label: "区", type: "string" },
  ];
  const r = compileStages({
    schemaVersion: 2,
    stages: [PICK, { id: "s_2", type: "summarize", aggregations: [{ id: "a_1", type: "sum", column: "*" }], groupBy: [] }],
  }, { formColumns: stringOnly });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /適用できる列がありません/);
});

test("全列対象: グループ化列は展開対象から除外する", () => {
  const r = compileTyped([
    PICK,
    { id: "s_2", type: "summarize",
      aggregations: [{ id: "a_1", type: "countNotNull", column: "*" }],
      groupBy: [{ column: "基本情報|区" }],
    },
  ]);
  assert.equal(r.ok, true);
  assert.match(r.sql, /\[基本情報__区\] AS \[基本情報__区\]/); // dimension は残る
  assert.doesNotMatch(r.sql, /COUNT\(\[基本情報__区\]\) AS \[基本情報__区_件数\]/); // 集計対象からは除外
  assert.match(r.sql, /COUNT\(\[在庫\]\) AS \[在庫_件数\]/);
});

test("全列対象: 列情報が空だとエラー", () => {
  const r = compileStages({
    schemaVersion: 2,
    stages: [PICK, { id: "s_2", type: "summarize", aggregations: [{ id: "a_1", type: "max", column: "*" }], groupBy: [] }],
  }, { formColumns: [] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /列情報/);
});

test("全列対象: count(*) には使えない", () => {
  const r = compileTyped([
    PICK,
    { id: "s_2", type: "summarize", aggregations: [{ id: "a_1", type: "count", column: "*" }], groupBy: [] },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /全列対象/);
});

test("別名衝突時は _2, _3 を付与する", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "summarize",
      aggregations: [
        { id: "a_1", type: "count" },
        { id: "a_2", type: "count" },
        { id: "a_3", type: "count" },
      ],
      groupBy: [],
    },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.columns.map((c) => c.name), ["件数", "件数_2", "件数_3"]);
  assert.match(r.sql, /COUNT\(\*\) AS \[件数\], COUNT\(\*\) AS \[件数_2\], COUNT\(\*\) AS \[件数_3\]/);
});

// ---- pick_data: view 形式に一本化（variant は廃止・無視） ----

test("常に FROM data_<id> を出す（canonicalFormAlias と一致）", () => {
  assert.equal(canonicalFormAlias(formId), canonicalDataAlias(formId));
  const r = compile([PICK]);
  assert.equal(r.ok, true);
  assert.equal(r.sql, "SELECT * FROM " + canonicalDataAlias(formId));
});

test("旧 source.variant（view/data）が残っていても無視して FROM data_<id>", () => {
  for (const variant of ["view", "data"]) {
    const r = compileStages({
      schemaVersion: 2,
      stages: [{ id: "s_1", type: "pick_data", source: { kind: "form", formId, variant } }],
    }, { formColumns });
    assert.equal(r.ok, true);
    assert.equal(r.sql, "SELECT * FROM " + canonicalDataAlias(formId));
  }
});

test("agg.label が指定されていれば別名はそれを優先する", () => {
  const r = compile([
    PICK,
    { id: "s_2", type: "summarize",
      aggregations: [{ id: "a_1", type: "sum", column: "基本情報|金額", label: "合計金額" }],
      groupBy: [],
    },
  ]);
  assert.equal(r.ok, true);
  assert.match(r.sql, /SUM\(\[基本情報__金額\]\) AS \[合計金額\]/);
  assert.equal(r.columns[0].name, "合計金額");
  assert.equal(r.columns[0].displayLabel, "合計金額");
});

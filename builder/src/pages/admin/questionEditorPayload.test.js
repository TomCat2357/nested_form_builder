import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseYFields,
  buildRunQuery,
  buildSaveQuery,
  buildQuestionVisualization,
} from "./questionEditorPayload.js";

test("parseYFields: トリム・空要素除去", () => {
  assert.deepEqual(parseYFields("a, b ,,c"), ["a", "b", "c"]);
  assert.deepEqual(parseYFields(""), []);
  assert.deepEqual(parseYFields(null), []);
  assert.deepEqual(parseYFields("  "), []);
});

test("buildRunQuery: gui モードは formId 必須", () => {
  assert.deepEqual(buildRunQuery({ mode: "gui", gui: { formId: "" } }), {
    error: "フォームを選択してください。",
  });
  const gui = { formId: "F1", aggregations: [] };
  assert.deepEqual(buildRunQuery({ mode: "gui", gui }), {
    query: { mode: "gui", gui },
  });
});

test("buildRunQuery: sql 本文が空なら skip", () => {
  assert.deepEqual(buildRunQuery({ mode: "sql", sql: "   " }), { skip: true });
});

test("buildRunQuery: sql の sources エラーを伝播", () => {
  assert.deepEqual(
    buildRunQuery({ mode: "sql", sql: "SELECT 1", sources: { error: "NO_SHEET" } }),
    { error: "NO_SHEET" }
  );
});

test("buildRunQuery: sql 成功（formSources は実行時はそのまま）", () => {
  const sources = { formSources: [{ formId: "F1", alias: "data" }] };
  assert.deepEqual(buildRunQuery({ mode: "sql", sql: "SELECT 1", sources }), {
    query: { mode: "sql", formSources: sources.formSources, sql: "SELECT 1" },
  });
});

test("buildSaveQuery: gui モードは stale formName を剥がし formPath を冗長保存する", () => {
  const gui = { formId: "F1", formName: "旧名", aggregations: [] };
  const forms = [{ id: "F1", folder: "営業", settings: { formTitle: "売上" } }];
  const out = buildSaveQuery({ mode: "gui", gui, forms });
  assert.equal(out.query.mode, "gui");
  assert.equal(out.query.gui.formId, "F1");
  assert.ok(!("formName" in out.query.gui));
  assert.equal(out.query.gui.formPath, "営業/売上");
});

test("buildSaveQuery: gui モードは formId 必須", () => {
  assert.deepEqual(buildSaveQuery({ mode: "gui", gui: {} }), {
    error: "フォームを選択してください。",
  });
});

test("buildSaveQuery: sql の formSources は formName を剥がし formPath を冗長保存する", () => {
  const sources = { formSources: [{ formId: "F1", alias: "data", formName: "旧" }] };
  const forms = [{ id: "F1", folder: "営業", settings: { formTitle: "売上" } }];
  const out = buildSaveQuery({ mode: "sql", sql: "SELECT 1", sources, forms });
  assert.deepEqual(out.query.formSources, [{ formId: "F1", alias: "data", formPath: "営業/売上" }]);
  assert.equal(out.query.mode, "sql");
});

test("buildSaveQuery: 未解決 formId の formPath は空文字", () => {
  const sources = { formSources: [{ formId: "F1", alias: "data" }] };
  const out = buildSaveQuery({ mode: "sql", sql: "SELECT 1", sources, forms: [] });
  assert.deepEqual(out.query.formSources, [{ formId: "F1", alias: "data", formPath: "" }]);
});

test("buildSaveQuery: 手書き SQL（ドロップダウン未選択）でも FROM 参照から formSources を捕捉し formPath を刻む", () => {
  const forms = [{ id: "F1", folder: "営業", settings: { formTitle: "売上" } }];
  // selectedFormId 未選択 → sources.formSources は空。SQL 本文の FROM [売上] だけが手掛かり。
  const out = buildSaveQuery({
    mode: "sql",
    sql: "SELECT * FROM [売上]",
    sources: { formSources: [] },
    forms,
  });
  assert.deepEqual(out.query.formSources, [{ formId: "F1", formPath: "営業/売上" }]);
  assert.equal(out.query.sql, "SELECT * FROM [F1]", "保存 SQL は fileId 化される");
});

test("buildSaveQuery: 複数フォーム JOIN は全参照に formPath を付与（出現順）", () => {
  const forms = [
    { id: "F1", folder: "営業", settings: { formTitle: "売上" } },
    { id: "F2", folder: "相談", settings: { formTitle: "対応一覧" } },
  ];
  const out = buildSaveQuery({
    mode: "sql",
    sql: "SELECT * FROM [売上] AS a JOIN [相談/対応一覧] AS b ON 1=1",
    sources: { formSources: [] },
    forms,
  });
  assert.deepEqual(out.query.formSources, [
    { formId: "F1", formPath: "営業/売上" },
    { formId: "F2", formPath: "相談/対応一覧" },
  ]);
});

test("buildSaveQuery: 明示 source（alias:data）を温存しつつ SQL の追加参照を追記", () => {
  const forms = [
    { id: "F1", folder: "営業", settings: { formTitle: "売上" } },
    { id: "F2", folder: "相談", settings: { formTitle: "対応一覧" } },
  ];
  // selectedFormId=F1（alias:"data"）に加え、SQL は F1 と F2 を参照。
  const out = buildSaveQuery({
    mode: "sql",
    sql: "SELECT * FROM [売上] AS a JOIN [相談/対応一覧] AS b ON 1=1",
    sources: { formSources: [{ formId: "F1", alias: "data" }] },
    forms,
  });
  assert.deepEqual(out.query.formSources, [
    { formId: "F1", alias: "data", formPath: "営業/売上" },
    { formId: "F2", formPath: "相談/対応一覧" },
  ]);
});

test("buildQuestionVisualization: heatmap 既定とフィールド整形", () => {
  const viz = buildQuestionVisualization({
    vizType: "bar",
    xField: " x ",
    yFields: "y1, y2",
    heatmap: null,
    vizOptions: null,
  });
  assert.equal(viz.type, "bar");
  assert.equal(viz.xField, "x");
  assert.deepEqual(viz.yFields, ["y1", "y2"]);
  assert.equal(viz.showLegend, true);
  assert.equal(viz.heatmap.enabled, false);
  assert.equal(viz.heatmap.direction, "column");
  assert.equal(viz.series && typeof viz.series, "object");
});

test("buildQuestionVisualization: excludeRows は 500 文字で切り詰め", () => {
  const long = "a".repeat(600);
  const viz = buildQuestionVisualization({
    vizType: "table",
    xField: "",
    yFields: "",
    heatmap: { enabled: true, excludeRows: long },
    vizOptions: {},
  });
  assert.equal(viz.heatmap.excludeRows.length, 500);
  assert.equal(viz.heatmap.enabled, true);
});

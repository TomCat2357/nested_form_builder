import test from "node:test";
import assert from "node:assert/strict";
import {
  extractTemplateDependencies,
  buildDependencyGraph,
  detectCircularReferences,
  evaluateAllComputedFields,
} from "./computedFields.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const makeField = (overrides) => ({
  id: overrides.id || `q_${Math.random().toString(36).slice(2, 8)}`,
  label: overrides.label || "field",
  type: overrides.type || "text",
  ...overrides,
});

// ---------------------------------------------------------------------------
// extractTemplateDependencies
// ---------------------------------------------------------------------------

test("extractTemplateDependencies はフィールドラベルを抽出する", () => {
  assert.deepEqual(extractTemplateDependencies("{氏名}様"), ["氏名"]);
});

test("extractTemplateDependencies は予約トークンをスキップする", () => {
  assert.deepEqual(extractTemplateDependencies("{_NOW}は現在時刻"), []);
  assert.deepEqual(extractTemplateDependencies("{_ID}"), []);
});

test("extractTemplateDependencies はパイプ変換を除去してラベルのみ返す", () => {
  assert.deepEqual(extractTemplateDependencies("{日付|time:YYYY年}"), ["日付"]);
});

test("extractTemplateDependencies は null/空文字で空配列を返す", () => {
  assert.deepEqual(extractTemplateDependencies(null), []);
  assert.deepEqual(extractTemplateDependencies(""), []);
  assert.deepEqual(extractTemplateDependencies(undefined), []);
});

test("extractTemplateDependencies は複数フィールドを抽出する", () => {
  assert.deepEqual(extractTemplateDependencies("{姓}{名}さん"), ["姓", "名"]);
});

test("extractTemplateDependencies は重複を除去する", () => {
  assert.deepEqual(extractTemplateDependencies("{名前}と{名前}"), ["名前"]);
});

// ---------------------------------------------------------------------------
// buildDependencyGraph
// ---------------------------------------------------------------------------

test("buildDependencyGraph は計算フィールドなしスキーマで空グラフを返す", () => {
  const schema = [
    makeField({ id: "q1", label: "名前", type: "text" }),
    makeField({ id: "q2", label: "年齢", type: "number" }),
  ];
  const result = buildDependencyGraph(schema);
  assert.equal(result.computedFields.length, 0);
  assert.equal(result.order.length, 0);
  assert.equal(result.hasCycle, false);
});

test("buildDependencyGraph は単一 calculated フィールドを含むスキーマを処理する", () => {
  const schema = [
    makeField({ id: "q1", label: "売上", type: "number" }),
    makeField({ id: "q2", label: "経費", type: "number" }),
    makeField({ id: "q3", label: "利益", type: "calculated", formula: "{売上} - {経費}" }),
  ];
  const result = buildDependencyGraph(schema);
  assert.equal(result.computedFields.length, 1);
  assert.equal(result.order.length, 1);
  assert.equal(result.order[0], "利益");
  assert.equal(result.hasCycle, false);
});

test("buildDependencyGraph は依存チェーンを正しいトポロジカル順で返す", () => {
  const schema = [
    makeField({ id: "q1", label: "入力", type: "number" }),
    makeField({ id: "q2", label: "中間", type: "calculated", formula: "{入力} * 2" }),
    makeField({ id: "q3", label: "最終", type: "calculated", formula: "{中間} + 100" }),
  ];
  const result = buildDependencyGraph(schema);
  assert.equal(result.order.length, 2);
  const midIndex = result.order.indexOf("中間");
  const finalIndex = result.order.indexOf("最終");
  assert.ok(midIndex < finalIndex, "中間 は 最終 より前に評価されるべき");
  assert.equal(result.hasCycle, false);
});

test("buildDependencyGraph は labelToId を正しく構築する", () => {
  const schema = [
    makeField({ id: "q1", label: "名前", type: "text" }),
    makeField({ id: "q2", label: "合計", type: "calculated", formula: "{名前}" }),
  ];
  const result = buildDependencyGraph(schema);
  assert.equal(result.labelToId["名前"], "q1");
  assert.equal(result.labelToId["合計"], "q2");
});

// ---------------------------------------------------------------------------
// detectCircularReferences
// ---------------------------------------------------------------------------

test("detectCircularReferences は循環なしで hasCycle: false を返す", () => {
  const schema = [
    makeField({ id: "q1", label: "A", type: "calculated", formula: "{入力} + 1" }),
    makeField({ id: "q2", label: "入力", type: "number" }),
  ];
  const result = detectCircularReferences(schema);
  assert.equal(result.hasCycle, false);
  assert.deepEqual(result.cycleFields, []);
});

test("detectCircularReferences は 2 ノード循環を検出する", () => {
  const schema = [
    makeField({ id: "q1", label: "A", type: "calculated", formula: "{B} + 1" }),
    makeField({ id: "q2", label: "B", type: "calculated", formula: "{A} + 1" }),
  ];
  const result = detectCircularReferences(schema);
  assert.equal(result.hasCycle, true);
  assert.ok(result.cycleFields.includes("A"));
  assert.ok(result.cycleFields.includes("B"));
});

test("detectCircularReferences は 3 ノード循環を検出する", () => {
  const schema = [
    makeField({ id: "q1", label: "X", type: "calculated", formula: "{Z} + 1" }),
    makeField({ id: "q2", label: "Y", type: "calculated", formula: "{X} + 1" }),
    makeField({ id: "q3", label: "Z", type: "calculated", formula: "{Y} + 1" }),
  ];
  const result = detectCircularReferences(schema);
  assert.equal(result.hasCycle, true);
  assert.equal(result.cycleFields.length, 3);
});

test("detectCircularReferences はチェーン（A→B→C）を循環と誤検出しない", () => {
  const schema = [
    makeField({ id: "q1", label: "入力", type: "number" }),
    makeField({ id: "q2", label: "A", type: "calculated", formula: "{入力} * 2" }),
    makeField({ id: "q3", label: "B", type: "calculated", formula: "{A} + 1" }),
    makeField({ id: "q4", label: "C", type: "calculated", formula: "{B} * 3" }),
  ];
  const result = detectCircularReferences(schema);
  assert.equal(result.hasCycle, false);
  assert.deepEqual(result.cycleFields, []);
});

test("detectCircularReferences は計算フィールドなしスキーマで hasCycle: false を返す", () => {
  const schema = [
    makeField({ id: "q1", label: "名前", type: "text" }),
  ];
  const result = detectCircularReferences(schema);
  assert.equal(result.hasCycle, false);
});

// ---------------------------------------------------------------------------
// evaluateAllComputedFields
// ---------------------------------------------------------------------------

test("evaluateAllComputedFields は単一 calculated フィールドを正しく評価する", () => {
  const schema = [
    makeField({ id: "q1", label: "売上", type: "number" }),
    makeField({ id: "q2", label: "経費", type: "number" }),
    makeField({ id: "q3", label: "利益", type: "calculated", formula: "{売上} - {経費}" }),
  ];
  const responses = { q1: "1000", q2: "200" };
  const baseLabelValueMap = { "売上": "1000", "経費": "200" };
  const { computedValues, computedErrors } = evaluateAllComputedFields(schema, responses, baseLabelValueMap);
  assert.equal(computedValues.q3, 800);
  assert.equal(computedErrors.q3, undefined);
});

test("evaluateAllComputedFields は依存フィールドをトポロジカル順で評価する", () => {
  const schema = [
    makeField({ id: "q1", label: "入力", type: "number" }),
    makeField({ id: "q2", label: "倍額", type: "calculated", formula: "{入力} * 2" }),
    makeField({ id: "q3", label: "最終", type: "calculated", formula: "{倍額} + 100" }),
  ];
  const responses = { q1: "50" };
  const baseLabelValueMap = { "入力": "50" };
  const { computedValues, computedErrors } = evaluateAllComputedFields(schema, responses, baseLabelValueMap);
  assert.equal(computedValues.q2, 100);
  assert.equal(computedValues.q3, 200);
  assert.equal(computedErrors.q2, undefined);
  assert.equal(computedErrors.q3, undefined);
});

test("evaluateAllComputedFields は循環参照フィールドにエラーを設定する", () => {
  const schema = [
    makeField({ id: "q1", label: "A", type: "calculated", formula: "{B} + 1" }),
    makeField({ id: "q2", label: "B", type: "calculated", formula: "{A} + 1" }),
  ];
  const { computedErrors } = evaluateAllComputedFields(schema, {}, {});
  assert.ok(computedErrors.q1);
  assert.ok(computedErrors.q1.includes("循環参照"));
  assert.ok(computedErrors.q2);
  assert.ok(computedErrors.q2.includes("循環参照"));
});

test("evaluateAllComputedFields は計算フィールドなしスキーマで空マップを返す", () => {
  const schema = [
    makeField({ id: "q1", label: "名前", type: "text" }),
  ];
  const { computedValues, computedErrors } = evaluateAllComputedFields(schema, {}, {});
  assert.deepEqual(computedValues, {});
  assert.deepEqual(computedErrors, {});
});

test("evaluateAllComputedFields は substitution フィールドのトークンを解決する", () => {
  const schema = [
    makeField({ id: "q1", label: "名前", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "{名前}さんこんにちは" }),
  ];
  const responses = { q1: "太郎" };
  const baseLabelValueMap = { "名前": "太郎" };
  const { computedValues, computedErrors } = evaluateAllComputedFields(schema, responses, baseLabelValueMap);
  assert.equal(computedValues.q2, "太郎さんこんにちは");
  assert.equal(computedErrors.q2, undefined);
});

test("evaluateAllComputedFields は後続の計算フィールドが先行の結果を参照できる", () => {
  const schema = [
    makeField({ id: "q1", label: "数値", type: "number" }),
    makeField({ id: "q2", label: "二倍", type: "calculated", formula: "{数値} * 2" }),
    makeField({ id: "q3", label: "結果表示", type: "substitution", templateText: "結果は{二倍}です" }),
  ];
  const responses = { q1: "10" };
  const baseLabelValueMap = { "数値": "10" };
  const { computedValues } = evaluateAllComputedFields(schema, responses, baseLabelValueMap);
  assert.equal(computedValues.q2, 20);
  assert.equal(computedValues.q3, "結果は20です");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  extractTemplateDependencies,
  buildDependencyGraph,
  detectCircularReferences,
  evaluateAllComputedFields,
  buildLabelValueMapFromEntryData,
  buildComputedFieldPathsById,
  enrichEntryDataWithComputedFields,
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
  // 新仕様: @ なしは bare word リテラル扱い。依存抽出は @ 参照のみ対象。
  assert.deepEqual(extractTemplateDependencies("{@氏名}様"), ["氏名"]);
});

test("extractTemplateDependencies は予約トークンをスキップする", () => {
  assert.deepEqual(extractTemplateDependencies("{@_NOW}は現在時刻"), []);
  assert.deepEqual(extractTemplateDependencies("{@_id}"), []);
  // @ なしはそもそも参照扱いされず依存にならない
  assert.deepEqual(extractTemplateDependencies("{_NOW}は現在時刻"), []);
});

test("extractTemplateDependencies はパイプ変換を除去してラベルのみ返す", () => {
  assert.deepEqual(extractTemplateDependencies("{@日付|time:YYYY年}"), ["日付"]);
});

test("extractTemplateDependencies は null/空文字で空配列を返す", () => {
  assert.deepEqual(extractTemplateDependencies(null), []);
  assert.deepEqual(extractTemplateDependencies(""), []);
  assert.deepEqual(extractTemplateDependencies(undefined), []);
});

test("extractTemplateDependencies は複数フィールドを抽出する", () => {
  assert.deepEqual(extractTemplateDependencies("{@姓}{@名}さん"), ["姓", "名"]);
});

test("extractTemplateDependencies は重複を除去する", () => {
  assert.deepEqual(extractTemplateDependencies("{@名前}と{@名前}"), ["名前"]);
});

test("extractTemplateDependencies は + 演算子の複数フィールドも拾う（新仕様）", () => {
  assert.deepEqual(extractTemplateDependencies("{@所属+@氏名}"), ["所属", "氏名"]);
});

test("extractTemplateDependencies はクォート付きラベル名を拾う（新仕様）", () => {
  assert.deepEqual(extractTemplateDependencies('{@"a+b"}'), ["a+b"]);
});

// ---------------------------------------------------------------------------
// buildDependencyGraph
// ---------------------------------------------------------------------------

test("buildDependencyGraph は置換フィールドなしスキーマで空グラフを返す", () => {
  const schema = [
    makeField({ id: "q1", label: "名前", type: "text" }),
    makeField({ id: "q2", label: "年齢", type: "number" }),
  ];
  const result = buildDependencyGraph(schema);
  assert.equal(result.computedFields.length, 0);
  assert.equal(result.order.length, 0);
  assert.equal(result.hasCycle, false);
});

test("buildDependencyGraph は単一の置換フィールドを含むスキーマを処理する", () => {
  const schema = [
    makeField({ id: "q1", label: "売上", type: "number" }),
    makeField({ id: "q2", label: "経費", type: "number" }),
    makeField({ id: "q3", label: "利益", type: "substitution", templateText: "[{@売上}-{@経費}]" }),
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
    makeField({ id: "q2", label: "中間", type: "substitution", templateText: "[{@入力}*2]" }),
    makeField({ id: "q3", label: "最終", type: "substitution", templateText: "[{@中間}+100]" }),
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
    makeField({ id: "q2", label: "合計", type: "substitution", templateText: "{@名前}" }),
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
    makeField({ id: "q1", label: "A", type: "substitution", templateText: "[{@入力}+1]" }),
    makeField({ id: "q2", label: "入力", type: "number" }),
  ];
  const result = detectCircularReferences(schema);
  assert.equal(result.hasCycle, false);
  assert.deepEqual(result.cycleFields, []);
});

test("detectCircularReferences は 2 ノード循環を検出する", () => {
  const schema = [
    makeField({ id: "q1", label: "A", type: "substitution", templateText: "[{@B}+1]" }),
    makeField({ id: "q2", label: "B", type: "substitution", templateText: "[{@A}+1]" }),
  ];
  const result = detectCircularReferences(schema);
  assert.equal(result.hasCycle, true);
  assert.ok(result.cycleFields.includes("A"));
  assert.ok(result.cycleFields.includes("B"));
});

test("detectCircularReferences は 3 ノード循環を検出する", () => {
  const schema = [
    makeField({ id: "q1", label: "X", type: "substitution", templateText: "[{@Z}+1]" }),
    makeField({ id: "q2", label: "Y", type: "substitution", templateText: "[{@X}+1]" }),
    makeField({ id: "q3", label: "Z", type: "substitution", templateText: "[{@Y}+1]" }),
  ];
  const result = detectCircularReferences(schema);
  assert.equal(result.hasCycle, true);
  assert.equal(result.cycleFields.length, 3);
});

test("detectCircularReferences はチェーン（A→B→C）を循環と誤検出しない", () => {
  const schema = [
    makeField({ id: "q1", label: "入力", type: "number" }),
    makeField({ id: "q2", label: "A", type: "substitution", templateText: "[{@入力}*2]" }),
    makeField({ id: "q3", label: "B", type: "substitution", templateText: "[{@A}+1]" }),
    makeField({ id: "q4", label: "C", type: "substitution", templateText: "[{@B}*3]" }),
  ];
  const result = detectCircularReferences(schema);
  assert.equal(result.hasCycle, false);
  assert.deepEqual(result.cycleFields, []);
});

test("detectCircularReferences は置換フィールドなしスキーマで hasCycle: false を返す", () => {
  const schema = [
    makeField({ id: "q1", label: "名前", type: "text" }),
  ];
  const result = detectCircularReferences(schema);
  assert.equal(result.hasCycle, false);
});

// ---------------------------------------------------------------------------
// evaluateAllComputedFields
// ---------------------------------------------------------------------------

test("evaluateAllComputedFields は単一の置換フィールドを正しく評価する", () => {
  const schema = [
    makeField({ id: "q1", label: "売上", type: "number" }),
    makeField({ id: "q2", label: "経費", type: "number" }),
    makeField({ id: "q3", label: "利益", type: "substitution", templateText: "[{@売上}-{@経費}]" }),
  ];
  const responses = { q1: "1000", q2: "200" };
  const baseLabelValueMap = { "売上": "1000", "経費": "200" };
  const { computedValues, computedErrors } = evaluateAllComputedFields(schema, responses, baseLabelValueMap);
  assert.equal(String(computedValues.q3), "800");
  assert.equal(computedErrors.q3, undefined);
});

test("evaluateAllComputedFields は依存フィールドをトポロジカル順で評価する", () => {
  const schema = [
    makeField({ id: "q1", label: "入力", type: "number" }),
    makeField({ id: "q2", label: "倍額", type: "substitution", templateText: "[{@入力}*2]" }),
    makeField({ id: "q3", label: "最終", type: "substitution", templateText: "[{@倍額}+100]" }),
  ];
  const responses = { q1: "50" };
  const baseLabelValueMap = { "入力": "50" };
  const { computedValues, computedErrors } = evaluateAllComputedFields(schema, responses, baseLabelValueMap);
  assert.equal(String(computedValues.q2), "100");
  assert.equal(String(computedValues.q3), "200");
  assert.equal(computedErrors.q2, undefined);
  assert.equal(computedErrors.q3, undefined);
});

test("evaluateAllComputedFields は循環参照フィールドにエラーを設定する", () => {
  const schema = [
    makeField({ id: "q1", label: "A", type: "substitution", templateText: "[{@B}+1]" }),
    makeField({ id: "q2", label: "B", type: "substitution", templateText: "[{@A}+1]" }),
  ];
  const { computedErrors } = evaluateAllComputedFields(schema, {}, {});
  assert.ok(computedErrors.q1);
  assert.ok(computedErrors.q1.includes("循環参照"));
  assert.ok(computedErrors.q2);
  assert.ok(computedErrors.q2.includes("循環参照"));
});

test("evaluateAllComputedFields は置換フィールドなしスキーマで空マップを返す", () => {
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
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "{@名前}さんこんにちは" }),
  ];
  const responses = { q1: "太郎" };
  const baseLabelValueMap = { "名前": "太郎" };
  const { computedValues, computedErrors } = evaluateAllComputedFields(schema, responses, baseLabelValueMap);
  assert.equal(computedValues.q2, "太郎さんこんにちは");
  assert.equal(computedErrors.q2, undefined);
});

test("evaluateAllComputedFields は後続の置換フィールドが先行の結果を参照できる", () => {
  const schema = [
    makeField({ id: "q1", label: "数値", type: "number" }),
    makeField({ id: "q2", label: "二倍", type: "substitution", templateText: "[{@数値}*2]" }),
    makeField({ id: "q3", label: "結果表示", type: "substitution", templateText: "結果は{@二倍}です" }),
  ];
  const responses = { q1: "10" };
  const baseLabelValueMap = { "数値": "10" };
  const { computedValues } = evaluateAllComputedFields(schema, responses, baseLabelValueMap);
  assert.equal(String(computedValues.q2), "20");
  assert.equal(computedValues.q3, "結果は20です");
});

// ---------------------------------------------------------------------------
// buildLabelValueMapFromEntryData / enrichEntryDataWithComputedFields
// ---------------------------------------------------------------------------

test("buildLabelValueMapFromEntryData は radio 選択肢マーカーから選択値を再構築する", () => {
  const schema = [
    makeField({ id: "q1", label: "政党", type: "radio", options: ["自由民主党", "立憲民主党"] }),
  ];
  const entryData = { "政党|自由民主党": "●" };
  const map = buildLabelValueMapFromEntryData(schema, entryData);
  assert.equal(map["政党"], "自由民主党");
});

test("buildLabelValueMapFromEntryData は直接値のテキストフィールドを拾う", () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
  ];
  const entryData = { "氏名": "山田太郎" };
  const map = buildLabelValueMapFromEntryData(schema, entryData);
  assert.equal(map["氏名"], "山田太郎");
});

test("buildComputedFieldPathsById は置換フィールドの fieldId→path を返す", () => {
  const schema = [
    makeField({ id: "q1", label: "数値", type: "number" }),
    makeField({ id: "q2", label: "二倍", type: "substitution", templateText: "[{@数値}*2]" }),
    makeField({ id: "q3", label: "挨拶", type: "substitution", templateText: "hi" }),
  ];
  const paths = buildComputedFieldPathsById(schema);
  assert.equal(paths.q2, "二倍");
  assert.equal(paths.q3, "挨拶");
  assert.equal(paths.q1, undefined);
});

test("enrichEntryDataWithComputedFields は既存レコードにも置換の map 変換結果を注入する", () => {
  // 既存レコードには q1 (radio) のみ保存されており、q2 (substitution) の値は未保存
  const schema = [
    makeField({ id: "q1", label: "政党", type: "radio", options: ["自由民主党", "立憲民主党"] }),
    makeField({
      id: "q2",
      label: "政党略称",
      type: "substitution",
      templateText: "{@政党|map:自由民主党=自民;立憲民主党=立民}",
    }),
  ];
  const entryData = { "政党|自由民主党": "●" };
  const enriched = enrichEntryDataWithComputedFields(schema, entryData);
  assert.equal(enriched["政党略称"], "自民");
  // 元のデータは変わっていない
  assert.equal(enriched["政党|自由民主党"], "●");
});

test("enrichEntryDataWithComputedFields は保存値が空のとき動的計算で補完する", () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "Hello {@氏名}" }),
  ];
  const entryData = { "氏名": "太郎" };
  const enriched = enrichEntryDataWithComputedFields(schema, entryData);
  assert.equal(enriched["挨拶"], "Hello 太郎");
});

test("enrichEntryDataWithComputedFields は保存値があれば動的再評価せず保存値を使う", () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "Hello {@氏名}" }),
  ];
  // 保存値は「こんにちは 太郎」。式は "Hello {@氏名}" に変わっているが保存値を尊重する
  const entryData = { "氏名": "太郎", "挨拶": "こんにちは 太郎" };
  const enriched = enrichEntryDataWithComputedFields(schema, entryData);
  assert.equal(enriched["挨拶"], "こんにちは 太郎");
});

test("enrichEntryDataWithComputedFields は保存値と空の混在で空だけ補完する", () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "Hello {@氏名}" }),
    makeField({ id: "q3", label: "呼び捨て", type: "substitution", templateText: "{@氏名}!" }),
  ];
  // 挨拶は保存済み、呼び捨ては未保存
  const entryData = { "氏名": "太郎", "挨拶": "こんにちは 太郎" };
  const enriched = enrichEntryDataWithComputedFields(schema, entryData);
  assert.equal(enriched["挨拶"], "こんにちは 太郎");
  assert.equal(enriched["呼び捨て"], "太郎!");
});

test("enrichEntryDataWithComputedFields は空の計算結果で path を作らない", () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "{@氏名}" }),
  ];
  // 氏名も挨拶も未保存
  const entryData = {};
  const enriched = enrichEntryDataWithComputedFields(schema, entryData);
  assert.equal(enriched["挨拶"], undefined);
});

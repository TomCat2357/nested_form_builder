import test from "node:test";
import assert from "node:assert/strict";
import {
  extractTemplateDependencies,
  buildDependencyGraph,
  detectCircularReferences,
  evaluateAllComputedFields,
  buildLabelValueMapFromEntryData,
  buildComputedFieldPathsById,
  validateSubstitutionTemplates,
} from "./computedFields.js";
import {
  _clearExpressionCacheForTest,
  _registerCompiledForTest,
} from "../features/expression/alasqlExpressionEvaluator.js";

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
// extractTemplateDependencies (新構文: 二重ブレース + バッククォート識別子)
// ---------------------------------------------------------------------------

test("extractTemplateDependencies はフィールドラベルを抽出する", () => {
  assert.deepEqual(extractTemplateDependencies("{{`氏名`}}様"), ["氏名"]);
});

test("extractTemplateDependencies は予約トークンをスキップする", () => {
  assert.deepEqual(extractTemplateDependencies("{{TIME_FORMAT(NOW(), 'YYYY')}}は現在"), []);
  assert.deepEqual(extractTemplateDependencies("{{`_id`}}"), []);
  assert.deepEqual(extractTemplateDependencies("{{`_record_url`}}"), []);
});

test("extractTemplateDependencies は関数引数のフィールドも拾う", () => {
  assert.deepEqual(
    extractTemplateDependencies("{{TIME_FORMAT(`日付`, 'YYYY年')}}"),
    ["日付"]
  );
});

test("extractTemplateDependencies は null/空文字で空配列を返す", () => {
  assert.deepEqual(extractTemplateDependencies(null), []);
  assert.deepEqual(extractTemplateDependencies(""), []);
  assert.deepEqual(extractTemplateDependencies(undefined), []);
});

test("extractTemplateDependencies は複数フィールドを抽出する", () => {
  assert.deepEqual(extractTemplateDependencies("{{`姓`}}{{`名`}}さん"), ["姓", "名"]);
});

test("extractTemplateDependencies は重複を除去する", () => {
  assert.deepEqual(extractTemplateDependencies("{{`名前`}}と{{`名前`}}"), ["名前"]);
});

test("extractTemplateDependencies は連結式の複数フィールドを拾う", () => {
  assert.deepEqual(extractTemplateDependencies("{{`所属` || `氏名`}}"), ["所属", "氏名"]);
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
    makeField({ id: "q3", label: "利益", type: "substitution", templateText: "{{`売上` - `経費`}}" }),
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
    makeField({ id: "q2", label: "中間", type: "substitution", templateText: "{{`入力` * 2}}" }),
    makeField({ id: "q3", label: "最終", type: "substitution", templateText: "{{`中間` + 100}}" }),
  ];
  const result = buildDependencyGraph(schema);
  assert.equal(result.order.length, 2);
  const midIndex = result.order.indexOf("中間");
  const finalIndex = result.order.indexOf("最終");
  assert.ok(midIndex < finalIndex, "中間 は 最終 より前に評価されるべき");
  assert.equal(result.hasCycle, false);
});

test("buildDependencyGraph は pathToId を正しく構築する", () => {
  const schema = [
    makeField({ id: "q1", label: "名前", type: "text" }),
    makeField({ id: "q2", label: "合計", type: "substitution", templateText: "{{`名前`}}" }),
  ];
  const result = buildDependencyGraph(schema);
  assert.equal(result.pathToId["名前"], "q1");
  assert.equal(result.pathToId["合計"], "q2");
});

test("buildDependencyGraph はネスト子質問を 親|子 のフルパスでノード化する", () => {
  // `entry` がトップレベル (children を持つ)、その値入力時表示 child として
  // `start` を持つ schema。フォームビルダの実体に近づけて childrenByValue ではなく
  // children を使う (テキストの値表示子質問).
  const schema = [
    makeField({
      id: "q_loc",
      label: "設置場所",
      type: "text",
      children: [
        makeField({ id: "q_start", label: "設置開始日", type: "date" }),
      ],
    }),
    makeField({
      id: "q_disp",
      label: "表示",
      type: "substitution",
      templateText: "{{`設置場所|設置開始日`}}",
    }),
  ];
  const result = buildDependencyGraph(schema);
  assert.equal(result.pathToId["設置場所"], "q_loc");
  assert.equal(result.pathToId["設置場所|設置開始日"], "q_start");
  assert.equal(result.pathToId["表示"], "q_disp");
  // 葉ラベル単独 (`設置開始日`) は登録されない
  assert.equal(result.pathToId["設置開始日"], undefined);
});

// ---------------------------------------------------------------------------
// detectCircularReferences
// ---------------------------------------------------------------------------

test("detectCircularReferences は循環なしで hasCycle: false を返す", () => {
  const schema = [
    makeField({ id: "q1", label: "A", type: "substitution", templateText: "{{`入力` + 1}}" }),
    makeField({ id: "q2", label: "入力", type: "number" }),
  ];
  const result = detectCircularReferences(schema);
  assert.equal(result.hasCycle, false);
  assert.deepEqual(result.cycleFields, []);
});

test("detectCircularReferences は 2 ノード循環を検出する", () => {
  const schema = [
    makeField({ id: "q1", label: "A", type: "substitution", templateText: "{{`B` + 1}}" }),
    makeField({ id: "q2", label: "B", type: "substitution", templateText: "{{`A` + 1}}" }),
  ];
  const result = detectCircularReferences(schema);
  assert.equal(result.hasCycle, true);
  assert.ok(result.cycleFields.includes("A"));
  assert.ok(result.cycleFields.includes("B"));
});

test("detectCircularReferences は 3 ノード循環を検出する", () => {
  const schema = [
    makeField({ id: "q1", label: "X", type: "substitution", templateText: "{{`Z` + 1}}" }),
    makeField({ id: "q2", label: "Y", type: "substitution", templateText: "{{`X` + 1}}" }),
    makeField({ id: "q3", label: "Z", type: "substitution", templateText: "{{`Y` + 1}}" }),
  ];
  const result = detectCircularReferences(schema);
  assert.equal(result.hasCycle, true);
  assert.equal(result.cycleFields.length, 3);
});

test("detectCircularReferences はチェーン（A→B→C）を循環と誤検出しない", () => {
  const schema = [
    makeField({ id: "q1", label: "入力", type: "number" }),
    makeField({ id: "q2", label: "A", type: "substitution", templateText: "{{`入力` * 2}}" }),
    makeField({ id: "q3", label: "B", type: "substitution", templateText: "{{`A` + 1}}" }),
    makeField({ id: "q4", label: "C", type: "substitution", templateText: "{{`B` * 3}}" }),
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
// evaluateAllComputedFields (precompile wrapper を直接登録)
// ---------------------------------------------------------------------------

test("evaluateAllComputedFields は単一の置換フィールドを正しく評価する", () => {
  _clearExpressionCacheForTest();
  _registerCompiledForTest("`売上` - `経費`", (row) => Number(row["売上"]) - Number(row["経費"]));
  const schema = [
    makeField({ id: "q1", label: "売上", type: "number" }),
    makeField({ id: "q2", label: "経費", type: "number" }),
    makeField({ id: "q3", label: "利益", type: "substitution", templateText: "{{`売上` - `経費`}}" }),
  ];
  const responses = { q1: "1000", q2: "200" };
  const baseLabelValueMap = { "売上": "1000", "経費": "200" };
  const { computedValues, computedErrors } = evaluateAllComputedFields(schema, responses, baseLabelValueMap);
  assert.equal(String(computedValues.q3), "800");
  assert.equal(computedErrors.q3, undefined);
});

test("evaluateAllComputedFields は依存フィールドをトポロジカル順で評価する", () => {
  _clearExpressionCacheForTest();
  _registerCompiledForTest("`入力` * 2", (row) => Number(row["入力"]) * 2);
  _registerCompiledForTest("`倍額` + 100", (row) => Number(row["倍額"]) + 100);
  const schema = [
    makeField({ id: "q1", label: "入力", type: "number" }),
    makeField({ id: "q2", label: "倍額", type: "substitution", templateText: "{{`入力` * 2}}" }),
    makeField({ id: "q3", label: "最終", type: "substitution", templateText: "{{`倍額` + 100}}" }),
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
    makeField({ id: "q1", label: "A", type: "substitution", templateText: "{{`B` + 1}}" }),
    makeField({ id: "q2", label: "B", type: "substitution", templateText: "{{`A` + 1}}" }),
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
  _clearExpressionCacheForTest();
  _registerCompiledForTest("`名前`", (row) => row["名前"]);
  const schema = [
    makeField({ id: "q1", label: "名前", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "{{`名前`}}さんこんにちは" }),
  ];
  const responses = { q1: "太郎" };
  const baseLabelValueMap = { "名前": "太郎" };
  const { computedValues, computedErrors } = evaluateAllComputedFields(schema, responses, baseLabelValueMap);
  assert.equal(computedValues.q2, "太郎さんこんにちは");
  assert.equal(computedErrors.q2, undefined);
});

test("evaluateAllComputedFields は後続の置換フィールドが先行の結果を参照できる", () => {
  _clearExpressionCacheForTest();
  _registerCompiledForTest("`数値` * 2", (row) => Number(row["数値"]) * 2);
  _registerCompiledForTest("`二倍`", (row) => row["二倍"]);
  const schema = [
    makeField({ id: "q1", label: "数値", type: "number" }),
    makeField({ id: "q2", label: "二倍", type: "substitution", templateText: "{{`数値` * 2}}" }),
    makeField({ id: "q3", label: "結果表示", type: "substitution", templateText: "結果は{{`二倍`}}です" }),
  ];
  const responses = { q1: "10" };
  const baseLabelValueMap = { "数値": "10" };
  const { computedValues } = evaluateAllComputedFields(schema, responses, baseLabelValueMap);
  assert.equal(String(computedValues.q2), "20");
  assert.equal(computedValues.q3, "結果は20です");
});

test("evaluateAllComputedFields は単一の typed view マップで {{...}} を解決する", () => {
  _clearExpressionCacheForTest();
  _registerCompiledForTest("`色`", (row) => row["色"]);
  const schema = [
    makeField({ id: "q1", label: "色", type: "select", options: [{ id: "a", label: "赤, 青" }] }),
    makeField({
      id: "q2",
      label: "表示",
      type: "substitution",
      templateText: "{{`色`}}",
    }),
  ];
  // 第 3 引数は単一の平坦 { フルパス: 値 } マップ（{data,view} ラッパーではない）。
  const baseMap = { "色": "赤, 青" };
  const { computedValues, computedErrors } = evaluateAllComputedFields(schema, {}, baseMap);
  assert.equal(computedValues.q2, "赤, 青");
  assert.equal(computedErrors.q2, undefined);
});

// ---------------------------------------------------------------------------
// buildLabelValueMapFromEntryData
// ---------------------------------------------------------------------------

test("buildLabelValueMapFromEntryData は radio の選択ラベル（view 1 列）を再構築する", () => {
  const schema = [
    makeField({ id: "q1", label: "政党", type: "radio", options: ["自由民主党", "立憲民主党"] }),
  ];
  const entryData = { "政党": "自由民主党" };
  const map = buildLabelValueMapFromEntryData(schema, entryData);
  assert.equal(map["政党"], "自由民主党");
});

test("buildLabelValueMapFromEntryData は checkboxes の連結値を表示用 ', ' で結合する", () => {
  const schema = [
    makeField({ id: "q1", label: "チェック項目", type: "checkboxes", options: ["A", "B", "C"] }),
  ];
  // view 形式: 1 列に codec 連結（カンマ区切り）で保存される
  const entryData = { "チェック項目": "A,B" };
  const map = buildLabelValueMapFromEntryData(schema, entryData);
  assert.equal(map["チェック項目"], "A, B");
});

test("buildLabelValueMapFromEntryData は checkboxes のラベル内カンマを codec で復元する", () => {
  const schema = [
    makeField({ id: "q1", label: "色", type: "checkboxes", options: ["赤, 青", "緑"] }),
  ];
  // ラベル "赤, 青" は codec で "赤\\, 青" にエスケープされて保存される
  const entryData = { "色": "赤\\, 青,緑" };
  const map = buildLabelValueMapFromEntryData(schema, entryData);
  assert.equal(map["色"], "赤, 青, 緑");
});

test("buildLabelValueMapFromEntryData は直接値のテキストフィールドを拾う", () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
  ];
  const entryData = { "氏名": "山田太郎" };
  const map = buildLabelValueMapFromEntryData(schema, entryData);
  assert.equal(map["氏名"], "山田太郎");
});

test("buildLabelValueMapFromEntryData はネスト子を 親|子 フルパスでキー化する", () => {
  const schema = [
    makeField({
      id: "q1",
      label: "設置場所",
      type: "text",
      children: [
        makeField({ id: "q2", label: "設置開始日", type: "date" }),
      ],
    }),
  ];
  const entryData = {
    "設置場所": "ああ",
    "設置場所|設置開始日": "2026-05-08",
  };
  const map = buildLabelValueMapFromEntryData(schema, entryData);
  assert.equal(map["設置場所"], "ああ");
  assert.equal(map["設置場所|設置開始日"], "2026-05-08");
  // 葉ラベル単独 (`設置開始日`) は登録されない
  assert.equal(map["設置開始日"], undefined);
});

test("buildLabelValueMapFromEntryData はネストした radio 子をフルパスの選択ラベルで再構築する", () => {
  const schema = [
    makeField({
      id: "q1",
      label: "設置場所",
      type: "text",
      children: [
        makeField({ id: "q2", label: "状態", type: "radio", options: ["稼働", "停止"] }),
      ],
    }),
  ];
  const entryData = {
    "設置場所": "ああ",
    "設置場所|状態": "稼働",
  };
  const map = buildLabelValueMapFromEntryData(schema, entryData);
  assert.equal(map["設置場所|状態"], "稼働");
});

test("buildComputedFieldPathsById は置換フィールドの fieldId→path を返す", () => {
  const schema = [
    makeField({ id: "q1", label: "数値", type: "number" }),
    makeField({ id: "q2", label: "二倍", type: "substitution", templateText: "{{`数値` * 2}}" }),
    makeField({ id: "q3", label: "挨拶", type: "substitution", templateText: "hi" }),
  ];
  const paths = buildComputedFieldPathsById(schema);
  assert.equal(paths.q2, "二倍");
  assert.equal(paths.q3, "挨拶");
  assert.equal(paths.q1, undefined);
});

// ---------------------------------------------------------------------------
// validateSubstitutionTemplates
// ---------------------------------------------------------------------------

test("validateSubstitutionTemplates は置換フィールドなしで ok を返す", async () => {
  _clearExpressionCacheForTest();
  const schema = [makeField({ id: "q1", label: "名前", type: "text" })];
  const result = await validateSubstitutionTemplates(schema);
  assert.equal(result.ok, true);
});

test("validateSubstitutionTemplates はトークン無しの置換フィールドを ok とする", async () => {
  _clearExpressionCacheForTest();
  const schema = [
    makeField({ id: "q1", label: "固定文", type: "substitution", templateText: "ただの文字列" }),
  ];
  const result = await validateSubstitutionTemplates(schema);
  assert.equal(result.ok, true);
});

test("validateSubstitutionTemplates はコンパイル可能な式を ok とする", async () => {
  _clearExpressionCacheForTest();
  _registerCompiledForTest("`氏名`", (row) => row["氏名"]);
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "こんにちは {{`氏名`}} 様" }),
  ];
  const result = await validateSubstitutionTemplates(schema);
  assert.equal(result.ok, true);
});

test("validateSubstitutionTemplates は未閉じ波括弧を検出し項目を返す", async () => {
  _clearExpressionCacheForTest();
  const schema = [
    makeField({ id: "q1", label: "壊れた置換", type: "substitution", templateText: "氏名は {{`氏名` です" }),
  ];
  const result = await validateSubstitutionTemplates(schema);
  assert.equal(result.ok, false);
  assert.equal(result.invalidTemplates.length, 1);
  assert.equal(result.invalidTemplates[0].path, "壊れた置換");
  assert.equal(result.invalidTemplates[0].label, "壊れた置換");
  assert.match(result.invalidTemplates[0].message, /波括弧/);
});

test("validateSubstitutionTemplates はネストした置換フィールドのフルパスを返す", async () => {
  _clearExpressionCacheForTest();
  const schema = [
    makeField({
      id: "q1",
      label: "親",
      type: "text",
      children: [
        makeField({ id: "q2", label: "子置換", type: "substitution", templateText: "{{未閉じ" }),
      ],
    }),
  ];
  const result = await validateSubstitutionTemplates(schema);
  assert.equal(result.ok, false);
  assert.equal(result.invalidTemplates.length, 1);
  assert.equal(result.invalidTemplates[0].path, "親 > 子置換");
});

test("validateSubstitutionTemplates は複数のエラー項目をまとめて返す", async () => {
  _clearExpressionCacheForTest();
  const schema = [
    makeField({ id: "q1", label: "壊れA", type: "substitution", templateText: "{{`a`" }),
    makeField({ id: "q2", label: "壊れB", type: "substitution", templateText: "テキスト {{`b`{" }),
  ];
  const result = await validateSubstitutionTemplates(schema);
  assert.equal(result.ok, false);
  assert.equal(result.invalidTemplates.length, 2);
  assert.deepEqual(result.invalidTemplates.map((e) => e.path), ["壊れA", "壊れB"]);
});

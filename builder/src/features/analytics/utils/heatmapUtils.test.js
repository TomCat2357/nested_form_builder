import test from "node:test";
import assert from "node:assert/strict";
import {
  parseExcludeList,
  compileRowExcludePredicate,
  extractRowExcludeExpr,
} from "./heatmapUtils.js";
import {
  _clearExpressionCacheForTest,
  _registerCompiledForTest,
} from "../../expression/alasqlExpressionEvaluator.js";

function freshRegister(expr, wrapper) {
  _clearExpressionCacheForTest();
  _registerCompiledForTest(expr, wrapper);
}

test("parseExcludeList: 通常のカンマ区切り入力（excludeColumns 用）", () => {
  const set = parseExcludeList("A,B,C");
  assert.equal(set.size, 3);
  assert.ok(set.has("A"));
  assert.ok(set.has("B"));
  assert.ok(set.has("C"));
});

test("parseExcludeList: 前後の空白を trim する", () => {
  const set = parseExcludeList(" A ,  B  ,C ");
  assert.deepEqual([...set].sort(), ["A", "B", "C"]);
});

test("parseExcludeList: 空文字 / 連続カンマで生じる空要素は除外", () => {
  assert.equal(parseExcludeList("").size, 0);
  assert.equal(parseExcludeList(",,,").size, 0);
  const set = parseExcludeList("A,,B");
  assert.deepEqual([...set].sort(), ["A", "B"]);
});

test("parseExcludeList: 重複入力は Set として de-dup される", () => {
  const set = parseExcludeList("A,B,A,B");
  assert.equal(set.size, 2);
});

test("parseExcludeList: null / undefined / 非文字列は空 Set", () => {
  assert.equal(parseExcludeList(null).size, 0);
  assert.equal(parseExcludeList(undefined).size, 0);
  assert.equal(parseExcludeList(123).size, 0);
  assert.equal(parseExcludeList([]).size, 0);
});

test("compileRowExcludePredicate: 空文字 / null は () => false", () => {
  assert.equal(compileRowExcludePredicate("").predicate({}, 1), false);
  assert.equal(compileRowExcludePredicate(null).predicate({}, 1), false);
  assert.equal(compileRowExcludePredicate("  ").predicate({}, 1), false);
});

test("compileRowExcludePredicate: 式が true を返したら除外（_dispRow を注入）", () => {
  const expr = "_dispRow = 1";
  freshRegister(expr, (row) => row._dispRow === 1);
  const { predicate } = compileRowExcludePredicate(expr);
  assert.equal(predicate({}, 1), true);
  assert.equal(predicate({}, 2), false);
});

test("compileRowExcludePredicate: rowData の列値で除外判定もできる", () => {
  const expr = "`項目` = '小計'";
  freshRegister(expr, (row) => row["項目"] === "小計");
  const { predicate } = compileRowExcludePredicate(expr);
  assert.equal(predicate({ "項目": "小計" }, 3), true);
  assert.equal(predicate({ "項目": "通常" }, 3), false);
});

test("compileRowExcludePredicate: precompile されていない式は除外しない (fallback false)", () => {
  _clearExpressionCacheForTest();
  const { predicate } = compileRowExcludePredicate("_dispRow = 1");
  assert.equal(predicate({}, 1), false);
});

test("extractRowExcludeExpr: enabled で式があれば返す、無効なら null", () => {
  assert.equal(extractRowExcludeExpr(null), null);
  assert.equal(extractRowExcludeExpr({ enabled: false, excludeRows: "_dispRow = 1" }), null);
  assert.equal(extractRowExcludeExpr({ enabled: true, excludeRows: "" }), null);
  assert.equal(extractRowExcludeExpr({ enabled: true, excludeRows: "   " }), null);
  assert.equal(extractRowExcludeExpr({ enabled: true, excludeRows: "_dispRow = 1" }), "_dispRow = 1");
  assert.equal(extractRowExcludeExpr({ enabled: true, excludeRows: "  _dispRow = 1  " }), "_dispRow = 1");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRowSelector,
  compileRowPredicate,
  parseColumnSelector,
  compileColumnPredicate,
} from "./tableStyleRowSelector.js";
import {
  _clearExpressionCacheForTest,
  _registerCompiledForTest,
} from "../../expression/alasqlExpressionEvaluator.js";

function freshRegister(expr, wrapper) {
  _clearExpressionCacheForTest();
  _registerCompiledForTest(expr, wrapper);
}

test("parseRowSelector: 空文字は isEmpty=true / predicate は常に false", () => {
  const r = parseRowSelector("");
  assert.equal(r.isEmpty, true);
  assert.equal(r.errors.length, 0);
  const p = compileRowPredicate(r);
  assert.equal(p({}, 1), false);
});

test("parseRowSelector: trim される / 式が残れば isEmpty=false", () => {
  const r = parseRowSelector("   ");
  assert.equal(r.isEmpty, true);
  const r2 = parseRowSelector("  _dispRow = 1  ");
  assert.equal(r2.isEmpty, false);
  assert.equal(r2.expr, "_dispRow = 1");
});

test("parseRowSelector: 500 文字超は errors を立てる", () => {
  const long = "a".repeat(600);
  const r = parseRowSelector(long);
  assert.ok(r.errors.length > 0);
});

test("compileRowPredicate: _dispRow を行データに注入して式評価する", () => {
  const expr = "_dispRow IN (1,3,5)";
  freshRegister(expr, (row) => [1, 3, 5].includes(row._dispRow));
  const p = compileRowPredicate(parseRowSelector(expr));
  assert.equal(p({}, 1), true);
  assert.equal(p({}, 2), false);
  assert.equal(p({}, 3), true);
  assert.equal(p({}, 5), true);
  assert.equal(p({}, 6), false);
});

test("compileRowPredicate: rowData の列値も式から参照できる", () => {
  const expr = "`項目` = '対応件数'";
  freshRegister(expr, (row) => row["項目"] === "対応件数");
  const p = compileRowPredicate(parseRowSelector(expr));
  assert.equal(p({ "項目": "対応件数" }, 1), true);
  assert.equal(p({ "項目": "他" }, 1), false);
});

test("compileRowPredicate: precompile されていない式は false 扱い（fallback）", () => {
  _clearExpressionCacheForTest();
  const p = compileRowPredicate(parseRowSelector("_dispRow = 1"));
  assert.equal(p({}, 1), false);
});

test("compileRowPredicate: 式が truthy/falsy を返したら !!v で boolean 化", () => {
  const expr = "x";
  freshRegister(expr, (row) => row.x);
  const p = compileRowPredicate(parseRowSelector(expr));
  assert.equal(p({ x: 1 }, 1), true);
  assert.equal(p({ x: 0 }, 1), false);
  assert.equal(p({ x: null }, 1), false);
  assert.equal(p({ x: "yes" }, 1), true);
});

test("parseColumnSelector: カンマ区切り、backtick 任意（無変更）", () => {
  assert.deepEqual(parseColumnSelector("項目, 対応件数"), ["項目", "対応件数"]);
  assert.deepEqual(parseColumnSelector("`項目`, `対応件数`"), ["項目", "対応件数"]);
  assert.deepEqual(parseColumnSelector(""), []);
  assert.deepEqual(parseColumnSelector("  a  ,  b  "), ["a", "b"]);
});

test("compileColumnPredicate: set マッチ（無変更）", () => {
  const p = compileColumnPredicate(parseColumnSelector("項目, 対応件数"));
  assert.equal(p("項目"), true);
  assert.equal(p("他"), false);
});

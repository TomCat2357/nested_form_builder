import assert from "node:assert/strict";
import test from "node:test";
import { buildSimpleFilterClauses } from "./dashboardFilters.js";

test("buildSimpleFilterClauses は number 型の min/max を Number クローズにする", () => {
  const simpleFilters = [{ id: "f1", column: "kingaku", valueType: "number" }];
  const values = { f1: { min: "1000", max: "5000" } };
  const clauses = buildSimpleFilterClauses(simpleFilters, values);
  assert.deepEqual(clauses, [
    { col: "kingaku", comparator: ">=", value: 1000 },
    { col: "kingaku", comparator: "<=", value: 5000 },
  ]);
});

test("buildSimpleFilterClauses は date 型を canonical YYYY-MM-DD に正規化する", () => {
  const simpleFilters = [{ id: "f1", column: "uketsukebi", valueType: "date" }];
  const values = { f1: { min: "2026-01-01", max: "2026-03-31" } };
  const clauses = buildSimpleFilterClauses(simpleFilters, values);
  assert.deepEqual(clauses, [
    { col: "uketsukebi", comparator: ">=", value: "2026-01-01" },
    { col: "uketsukebi", comparator: "<=", value: "2026-03-31" },
  ]);
});

test("buildSimpleFilterClauses は text 型を文字列のまま辞書順比較クローズにする", () => {
  const simpleFilters = [{ id: "f1", column: "name", valueType: "text" }];
  const values = { f1: { min: "あ", max: "ん" } };
  const clauses = buildSimpleFilterClauses(simpleFilters, values);
  assert.deepEqual(clauses, [
    { col: "name", comparator: ">=", value: "あ" },
    { col: "name", comparator: "<=", value: "ん" },
  ]);
});

test("buildSimpleFilterClauses は min だけ / max だけの指定も片側クローズにする", () => {
  const simpleFilters = [{ id: "f1", column: "kingaku", valueType: "number" }];
  assert.deepEqual(
    buildSimpleFilterClauses(simpleFilters, { f1: { min: 100, max: null } }),
    [{ col: "kingaku", comparator: ">=", value: 100 }],
  );
  assert.deepEqual(
    buildSimpleFilterClauses(simpleFilters, { f1: { min: "", max: 200 } }),
    [{ col: "kingaku", comparator: "<=", value: 200 }],
  );
});

test("buildSimpleFilterClauses は空値・未入力の項目をスキップする", () => {
  const simpleFilters = [
    { id: "f1", column: "kingaku", valueType: "number" },
    { id: "f2", column: "uketsukebi", valueType: "date" },
  ];
  const values = { f1: { min: "", max: null }, f2: undefined };
  assert.deepEqual(buildSimpleFilterClauses(simpleFilters, values), []);
});

test("buildSimpleFilterClauses は数値化できない number 入力をスキップする", () => {
  const simpleFilters = [{ id: "f1", column: "kingaku", valueType: "number" }];
  const values = { f1: { min: "abc", max: "5000" } };
  assert.deepEqual(buildSimpleFilterClauses(simpleFilters, values), [
    { col: "kingaku", comparator: "<=", value: 5000 },
  ]);
});

test("buildSimpleFilterClauses は column 未設定の項目を無視する", () => {
  const simpleFilters = [{ id: "f1", column: "", valueType: "number" }];
  const values = { f1: { min: 1, max: 2 } };
  assert.deepEqual(buildSimpleFilterClauses(simpleFilters, values), []);
});

test("buildSimpleFilterClauses は 3 項目を AND 用クローズ配列として連結する", () => {
  const simpleFilters = [
    { id: "f1", column: "a", valueType: "number" },
    { id: "f2", column: "b", valueType: "date" },
    { id: "f3", column: "c", valueType: "text" },
  ];
  const values = {
    f1: { min: 1, max: null },
    f2: { min: "2026-01-01", max: null },
    f3: { min: null, max: "z" },
  };
  const clauses = buildSimpleFilterClauses(simpleFilters, values);
  assert.deepEqual(clauses, [
    { col: "a", comparator: ">=", value: 1 },
    { col: "b", comparator: ">=", value: "2026-01-01" },
    { col: "c", comparator: "<=", value: "z" },
  ]);
});

test("buildSimpleFilterClauses は空 / 不正入力で空配列を返す", () => {
  assert.deepEqual(buildSimpleFilterClauses([], {}), []);
  assert.deepEqual(buildSimpleFilterClauses(null, {}), []);
  assert.deepEqual(buildSimpleFilterClauses(undefined, undefined), []);
});

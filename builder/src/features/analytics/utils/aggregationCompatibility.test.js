import assert from "node:assert/strict";
import test from "node:test";
import {
  AGG_TYPE_MATRIX,
  AGG_TYPES,
  FIXED_DATE_KEYS,
  assertAggColumnType,
  compatibleAggTypesForColumnType,
  isAggCompatible,
  normalizeFieldType,
  resolveColumnType,
} from "./aggregationCompatibility.js";

test("AGG_TYPE_MATRIX: 6 種すべて定義されている", () => {
  assert.deepEqual(AGG_TYPES.sort(), ["avg", "count", "countNotNull", "max", "min", "sum"]);
});

test("isAggCompatible: sum/avg は number のみ", () => {
  assert.equal(isAggCompatible("sum", "number"), true);
  assert.equal(isAggCompatible("avg", "number"), true);
  assert.equal(isAggCompatible("sum", "string"), false);
  assert.equal(isAggCompatible("sum", "date"), false);
  assert.equal(isAggCompatible("avg", "boolean"), false);
});

test("isAggCompatible: min/max は number/date/string", () => {
  for (const t of ["number", "date", "string"]) {
    assert.equal(isAggCompatible("min", t), true, "min " + t);
    assert.equal(isAggCompatible("max", t), true, "max " + t);
  }
  assert.equal(isAggCompatible("min", "boolean"), false);
});

test("isAggCompatible: count / countNotNull は全型 OK", () => {
  for (const t of ["number", "date", "string", "boolean"]) {
    assert.equal(isAggCompatible("count", t), true);
    assert.equal(isAggCompatible("countNotNull", t), true);
  }
});

test("isAggCompatible: unknown 型は全集計許容", () => {
  for (const aggType of AGG_TYPES) {
    assert.equal(isAggCompatible(aggType, "unknown"), true);
  }
});

test("isAggCompatible: 未知の集計種別は false", () => {
  assert.equal(isAggCompatible("median", "number"), false);
});

test("compatibleAggTypesForColumnType: 列型で集計を絞り込める", () => {
  const numAggs = compatibleAggTypesForColumnType("number").sort();
  assert.deepEqual(numAggs, ["avg", "count", "countNotNull", "max", "min", "sum"]);

  const strAggs = compatibleAggTypesForColumnType("string").sort();
  assert.deepEqual(strAggs, ["count", "countNotNull", "max", "min"]);

  const dateAggs = compatibleAggTypesForColumnType("date").sort();
  assert.deepEqual(dateAggs, ["count", "countNotNull", "max", "min"]);

  const boolAggs = compatibleAggTypesForColumnType("boolean").sort();
  assert.deepEqual(boolAggs, ["count", "countNotNull"]);
});

test("assertAggColumnType: 数値列に sum は OK", () => {
  const columns = [{ name: "amount", type: "number" }];
  assert.equal(assertAggColumnType({ type: "sum", column: "amount" }, columns), null);
});

test("assertAggColumnType: 文字列列に sum はエラー", () => {
  const columns = [{ name: "name", type: "string" }];
  const err = assertAggColumnType({ type: "sum", column: "name" }, columns);
  assert.match(err, /sum は string/);
});

test("assertAggColumnType: count は列指定不要", () => {
  assert.equal(assertAggColumnType({ type: "count" }, []), null);
});

test("assertAggColumnType: sum で column 未指定はエラー", () => {
  const err = assertAggColumnType({ type: "sum" }, []);
  assert.match(err, /集計対象の列/);
});

test("assertAggColumnType: 未知の集計種別はエラー", () => {
  const err = assertAggColumnType({ type: "median", column: "x" }, [{ name: "x", type: "number" }]);
  assert.match(err, /未対応の集計種別/);
});

test("assertAggColumnType: 列が候補に無くても型不明として通す", () => {
  // UI 側で列リストが取れないケース（snapshot 取得前など）でもコンパイラを止めないため
  assert.equal(assertAggColumnType({ type: "sum", column: "未知列" }, []), null);
});

test("AGG_TYPE_MATRIX: count のみ列指定不要", () => {
  for (const aggType of AGG_TYPES) {
    if (aggType === "count") continue;
    assert.equal(AGG_TYPE_MATRIX[aggType].columnRequired, true, aggType);
  }
  assert.equal(AGG_TYPE_MATRIX.count.columnRequired, false);
});

test("normalizeFieldType: 主要型を analytics 型に変換", () => {
  assert.equal(normalizeFieldType("number"), "number");
  assert.equal(normalizeFieldType("date"), "date");
  assert.equal(normalizeFieldType("datetime"), "date");
  assert.equal(normalizeFieldType("time"), "date");
  assert.equal(normalizeFieldType("text"), "string");
  assert.equal(normalizeFieldType("textarea"), "string");
  assert.equal(normalizeFieldType("select"), "string");
  assert.equal(normalizeFieldType("radio"), "string");
  assert.equal(normalizeFieldType("checkboxes"), "boolean");
  assert.equal(normalizeFieldType("email"), "string");
  assert.equal(normalizeFieldType("tel"), "string");
  assert.equal(normalizeFieldType("url"), "string");
  assert.equal(normalizeFieldType(undefined), "unknown");
  assert.equal(normalizeFieldType(""), "unknown");
  assert.equal(normalizeFieldType("section"), "unknown");
  assert.equal(normalizeFieldType("printTemplate"), "unknown");
});

test("FIXED_DATE_KEYS: createdAt/modifiedAt/deletedAt", () => {
  assert.equal(FIXED_DATE_KEYS.has("createdAt"), true);
  assert.equal(FIXED_DATE_KEYS.has("modifiedAt"), true);
  assert.equal(FIXED_DATE_KEYS.has("deletedAt"), true);
  assert.equal(FIXED_DATE_KEYS.has("id"), false);
});

test("resolveColumnType: 固定日付キーは schema 無しでも date", () => {
  const empty = new Map();
  assert.equal(resolveColumnType(empty, "createdAt"), "date");
  assert.equal(resolveColumnType(empty, "modifiedAt"), "date");
});

test("resolveColumnType: typeMap (Map) から正規化", () => {
  const typeMap = new Map([
    ["amount", "number"],
    ["name", "text"],
    ["birthday", "date"],
  ]);
  assert.equal(resolveColumnType(typeMap, "amount"), "number");
  assert.equal(resolveColumnType(typeMap, "name"), "string");
  assert.equal(resolveColumnType(typeMap, "birthday"), "date");
  assert.equal(resolveColumnType(typeMap, "missing"), "unknown");
});

test("resolveColumnType: plain object も受け付ける", () => {
  const obj = { amount: "number", name: "text" };
  assert.equal(resolveColumnType(obj, "amount"), "number");
  assert.equal(resolveColumnType(obj, "name"), "string");
});

test("resolveColumnType: 関数版", () => {
  const fn = (key) => key === "x" ? "number" : null;
  assert.equal(resolveColumnType(fn, "x"), "number");
  assert.equal(resolveColumnType(fn, "y"), "unknown");
});

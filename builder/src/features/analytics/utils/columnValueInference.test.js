import assert from "node:assert/strict";
import test from "node:test";
import {
  detectColumnType,
  getValueColumnsFromColumns,
} from "./columnValueInference.js";

// ---------- detectColumnType ----------

test("detectColumnType: name が空 → null", () => {
  assert.equal(detectColumnType(null, "", null), null);
  assert.equal(detectColumnType([], null, null), null);
});

test("detectColumnType: compiledColumns の type=date を優先", () => {
  const cols = [{ name: "createdAt", type: "date" }];
  assert.equal(detectColumnType(cols, "createdAt", null), "date");
});

test("detectColumnType: compiledColumns の type=number を優先", () => {
  const cols = [{ name: "price", type: "number" }];
  assert.equal(detectColumnType(cols, "price", null), "number");
});

test("detectColumnType: compiledColumns の type=string も解決", () => {
  const cols = [{ name: "name", type: "string" }];
  assert.equal(detectColumnType(cols, "name", null), "string");
});

test("detectColumnType: compiledColumns の type=boolean も解決", () => {
  const cols = [{ name: "flag", type: "boolean" }];
  assert.equal(detectColumnType(cols, "flag", null), "boolean");
});

test("detectColumnType: compiledColumns の role=metric は number 扱い", () => {
  const cols = [{ name: "count", role: "metric" }];
  assert.equal(detectColumnType(cols, "count", null), "number");
});

test("detectColumnType: fallbackTypeMap (Map) で number を解決", () => {
  const map = new Map([["x", "number"]]);
  assert.equal(detectColumnType(null, "x", map), "number");
  assert.equal(detectColumnType([], "x", map), "number");
});

test("detectColumnType: fallbackTypeMap で date を解決", () => {
  const map = new Map([["birthday", "date"]]);
  assert.equal(detectColumnType(null, "birthday", map), "date");
});

test("detectColumnType: fallbackTypeMap (plain object) でも解決", () => {
  const obj = { y: "number" };
  assert.equal(detectColumnType(null, "y", obj), "number");
});

test("detectColumnType: fallbackTypeMap の unknown は null", () => {
  const map = new Map([["x", "unknown"]]);
  assert.equal(detectColumnType(null, "x", map), null);
});

test("detectColumnType: FIXED_DATE_KEYS (createdAt 等) は schema 無しでも date", () => {
  assert.equal(detectColumnType(null, "createdAt", null), "date");
  assert.equal(detectColumnType(null, "modifiedAt", null), "date");
  assert.equal(detectColumnType(null, "deletedAt", null), "date");
});

test("detectColumnType: schema にも fallback にも無く FIXED_DATE_KEYS 外 → null", () => {
  assert.equal(detectColumnType(null, "totalAlias", null), null);
  assert.equal(detectColumnType([], "totalAlias", null), null);
  assert.equal(detectColumnType([], "totalAlias", new Map()), null);
});

test("detectColumnType: compiledColumns 優先順は schema > fallback > FIXED", () => {
  const cols = [{ name: "x", type: "number" }];
  const fallback = new Map([["x", "date"]]);
  // compiledColumns の number が勝つ
  assert.equal(detectColumnType(cols, "x", fallback), "number");
});

// ---------- getValueColumnsFromColumns ----------

test("getValueColumnsFromColumns: compiledColumns で number/date 列のみ抽出", () => {
  const columns = ["price", "name", "saleDate"];
  const compiledColumns = [
    { name: "price", type: "number" },
    { name: "name", type: "string" },
    { name: "saleDate", type: "date" },
  ];
  const result = getValueColumnsFromColumns(columns, compiledColumns, null);
  assert.deepEqual(result, ["price", "saleDate"]);
});

test("getValueColumnsFromColumns: HIDDEN_META_COLUMNS (createdAt/createdBy 等) は常に除外", () => {
  const columns = ["price", "createdAt", "createdBy", "deletedAt", "deletedBy", "modifiedAt"];
  const compiledColumns = [{ name: "price", type: "number" }];
  const result = getValueColumnsFromColumns(columns, compiledColumns, null);
  // createdAt / createdBy / deletedAt / deletedBy / modifiedBy は HIDDEN_META_COLUMNS で常に除外。
  // modifiedAt は HIDDEN_META_COLUMNS に入っていないので FIXED_DATE_KEYS 経由で date として残る。
  assert.deepEqual(result, ["price", "modifiedAt"]);
});

test("getValueColumnsFromColumns: fallbackTypeMap で SQL 結果列の型を解決", () => {
  // 自由形式 SQL の simple alias などで補える想定。複雑な式は unknown のまま除外。
  const columns = ["a", "b", "c"];
  const fallback = new Map([
    ["a", "number"],
    ["b", "string"],
    ["c", "date"],
  ]);
  const result = getValueColumnsFromColumns(columns, null, fallback);
  assert.deepEqual(result, ["a", "c"]);
});

test("getValueColumnsFromColumns: schema にも fallback にも無い列は除外", () => {
  const columns = ["unknown1", "unknown2"];
  assert.deepEqual(getValueColumnsFromColumns(columns, null, null), []);
  assert.deepEqual(getValueColumnsFromColumns(columns, [], new Map()), []);
});

test("getValueColumnsFromColumns: columns が配列でない → 空配列", () => {
  assert.deepEqual(getValueColumnsFromColumns(null, [], null), []);
  assert.deepEqual(getValueColumnsFromColumns(undefined, [], null), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  detectColumnType,
  getValueColumnsFromColumns,
  inferTypeFromValues,
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

// ---------- inferTypeFromValues ----------

test("inferTypeFromValues: 全件数値 → number", () => {
  const rows = [{ x: 1 }, { x: 2 }, { x: "3" }];
  assert.equal(inferTypeFromValues(rows, "x"), "number");
});

test("inferTypeFromValues: 全件日付文字列 → date", () => {
  const rows = [{ d: "2020-01-01" }, { d: "2021/12/31" }, { d: "2022-06-15T10:00:00" }];
  assert.equal(inferTypeFromValues(rows, "d"), "date");
});

test("inferTypeFromValues: Date インスタンスも date", () => {
  const rows = [{ d: new Date("2020-01-01") }, { d: new Date("2021-01-01") }];
  assert.equal(inferTypeFromValues(rows, "d"), "date");
});

test("inferTypeFromValues: 数値文字列を date と誤判定しない", () => {
  const rows = [{ x: "2020" }, { x: "1999" }, { x: 2021 }];
  assert.equal(inferTypeFromValues(rows, "x"), "number");
});

test("inferTypeFromValues: 数値と文字列の混在 → null", () => {
  const rows = [{ x: 1 }, { x: "abc" }, { x: 3 }];
  assert.equal(inferTypeFromValues(rows, "x"), null);
});

test("inferTypeFromValues: null/空文字はスキップし、残りで判定", () => {
  const rows = [{ x: null }, { x: "" }, { x: 5 }, { x: undefined }, { x: 7 }];
  assert.equal(inferTypeFromValues(rows, "x"), "number");
});

test("inferTypeFromValues: 非 null が 0 件 → null", () => {
  const rows = [{ x: null }, { x: "" }, { x: undefined }];
  assert.equal(inferTypeFromValues(rows, "x"), null);
});

test("inferTypeFromValues: rows が非配列 / name 空 → null", () => {
  assert.equal(inferTypeFromValues(null, "x"), null);
  assert.equal(inferTypeFromValues([{ x: 1 }], ""), null);
});

// ---------- getValueColumnsFromColumns: rows 値フォールバック ----------

test("getValueColumnsFromColumns: rows 省略時は schema のみ（従来挙動）", () => {
  const columns = ["a", "b"];
  const rows = [{ a: 1, b: 2 }];
  // schema 情報が無いので、rows を渡さなければ候補なし
  assert.deepEqual(getValueColumnsFromColumns(columns, null, null), []);
  // 第4引数を渡さない呼び出しは値スキャンしない
  void rows;
});

test("getValueColumnsFromColumns: schema 型不明だが値が数値の列を rows で補完", () => {
  const columns = ["total", "label"];
  const rows = [
    { total: 10, label: "x" },
    { total: 20, label: "y" },
  ];
  // total は schema 不明だが値が数値 → 候補入り。label は文字列 → 除外。
  assert.deepEqual(getValueColumnsFromColumns(columns, null, null, rows), ["total"]);
});

test("getValueColumnsFromColumns: schema が string の列は値が数値でも昇格しない", () => {
  const columns = ["code"];
  const fallback = new Map([["code", "string"]]);
  const rows = [{ code: 1 }, { code: 2 }];
  // schema 優先。string と判明している列は値スキャンで number に昇格させない。
  assert.deepEqual(getValueColumnsFromColumns(columns, null, fallback, rows), []);
});

test("getValueColumnsFromColumns: schema number と rows 補完が併存", () => {
  const columns = ["price", "total", "name"];
  const compiledColumns = [{ name: "price", type: "number" }];
  const rows = [
    { price: 100, total: 5, name: "a" },
    { price: 200, total: 6, name: "b" },
  ];
  assert.deepEqual(
    getValueColumnsFromColumns(columns, compiledColumns, null, rows),
    ["price", "total"]
  );
});

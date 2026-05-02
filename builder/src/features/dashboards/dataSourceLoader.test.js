import assert from "node:assert/strict";
import test from "node:test";
import {
  flattenEntry,
  flattenEntries,
  fetchRecordsForDataSources,
  registerDataSources,
} from "./dataSourceLoader.js";
import { alasql } from "./sqlEngine.js";

test("flattenEntry は string フィールド指定でトップレベル値を取り出す", () => {
  const entry = { id: "r1", day: "2026-03-01", amount: 100 };
  const row = flattenEntry(entry, [
    { name: "day", path: "day", type: "auto" },
    { name: "amount", path: "amount", type: "number" },
  ]);
  assert.equal(row.day, "2026-03-01");
  assert.equal(row.amount, 100);
});

test("flattenEntry は data 内の値も読む (パイプパス)", () => {
  const entry = { id: "r1", data: { "category|sub|q1": "X", "category|sub|q2": "42" } };
  const row = flattenEntry(entry, [
    { name: "q1", path: "category|sub|q1", type: "auto" },
    { name: "q2", path: "category|sub|q2", type: "number" },
  ]);
  assert.equal(row.q1, "X");
  assert.equal(row.q2, 42);
});

test("flattenEntry は number 型強制で文字列を数値化", () => {
  const row = flattenEntry({ x: "3.14" }, [{ name: "x", path: "x", type: "number" }]);
  assert.equal(row.x, 3.14);
});

test("flattenEntry は不正な数値を null", () => {
  const row = flattenEntry({ x: "not-a-number" }, [{ name: "x", path: "x", type: "number" }]);
  assert.equal(row.x, null);
});

test("flattenEntries は string と object の混在 fields を扱える", () => {
  const entries = [{ day: "2026-03-01", amount: 100 }, { day: "2026-03-02", amount: 200 }];
  const rows = flattenEntries(entries, ["day", { name: "amount", type: "number" }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].day, "2026-03-01");
  assert.equal(rows[1].amount, 200);
});

test("fetchRecordsForDataSources は同一 formId の重複を排除して並列フェッチ", async () => {
  const calls = [];
  const fetcher = async (formId) => {
    calls.push(formId);
    return { entries: [{ id: `${formId}-r1`, x: 1 }] };
  };
  const dataSources = [
    { alias: "a", formId: "f1", fields: [] },
    { alias: "b", formId: "f1", fields: [] },
    { alias: "c", formId: "f2", fields: [] },
  ];
  const result = await fetchRecordsForDataSources(dataSources, fetcher);
  assert.equal(calls.length, 2);
  assert.ok(calls.includes("f1"));
  assert.ok(calls.includes("f2"));
  assert.equal(result.f1.length, 1);
  assert.equal(result.f2.length, 1);
});

test("fetchRecordsForDataSources は失敗を空配列に置換し他は継続", async () => {
  const fetcher = async (formId) => {
    if (formId === "broken") throw new Error("boom");
    return { entries: [{ id: "ok" }] };
  };
  const result = await fetchRecordsForDataSources(
    [{ alias: "a", formId: "broken" }, { alias: "b", formId: "ok" }],
    fetcher,
  );
  assert.deepEqual(result.broken, []);
  assert.equal(result.ok.length, 1);
});

test("registerDataSources は alasql テーブルを正しく登録する", () => {
  const dataSources = [
    { alias: "sales", formId: "f1", fields: ["day", { name: "amount", type: "number" }] },
  ];
  const recordsByForm = {
    f1: [
      { day: "2026-03-01", amount: "100" },
      { day: "2026-03-02", amount: "200" },
    ],
  };
  const summary = registerDataSources(dataSources, recordsByForm, { databaseName: "test_loader" });
  assert.equal(summary.sales.rowCount, 2);
  const result = JSON.parse(JSON.stringify(alasql("SELECT SUM(amount) AS total_amount FROM sales")));
  assert.deepEqual(result, [{ total_amount: 300 }]);
});

test("registerDataSources は不正なエイリアスをスキップ (テーブル登録失敗を summary に記録)", () => {
  const dataSources = [
    { alias: "valid", formId: "f1", fields: ["x"] },
    { alias: "bad-name", formId: "f1", fields: ["x"] },
  ];
  const recordsByForm = { f1: [{ x: 1 }] };
  const summary = registerDataSources(dataSources, recordsByForm, { databaseName: "test_bad" });
  assert.equal(summary.valid.rowCount, 1);
  assert.ok(summary["bad-name"].error);
});

import assert from "node:assert/strict";
import test from "node:test";
import { pivot } from "./pivotCompute.js";

test("空配列は empty result", () => {
  const r = pivot([], "a", "b", "v", "sum");
  assert.deepEqual(r.rowKeys, []);
  assert.deepEqual(r.colKeys, []);
  assert.equal(r.grandTotal, 0);
});

test("基本的な sum クロス集計", () => {
  const rows = [
    { 区: "A", 月: "1月", v: 10 },
    { 区: "A", 月: "2月", v: 20 },
    { 区: "B", 月: "1月", v: 30 },
    { 区: "B", 月: "2月", v: 40 },
  ];
  const r = pivot(rows, "区", "月", "v", "sum");
  assert.deepEqual(r.rowKeys, ["A", "B"]);
  assert.deepEqual(r.colKeys, ["1月", "2月"]);
  assert.equal(r.cells["A"]["1月"], 10);
  assert.equal(r.cells["A"]["2月"], 20);
  assert.equal(r.cells["B"]["1月"], 30);
  assert.equal(r.cells["B"]["2月"], 40);
  assert.equal(r.rowTotals["A"], 30);
  assert.equal(r.rowTotals["B"], 70);
  assert.equal(r.colTotals["1月"], 40);
  assert.equal(r.colTotals["2月"], 60);
  assert.equal(r.grandTotal, 100);
});

test("count 集計", () => {
  const rows = [
    { a: "X", b: "1", v: 10 },
    { a: "X", b: "1", v: 20 },
    { a: "X", b: "2", v: 5 },
  ];
  const r = pivot(rows, "a", "b", "v", "count");
  assert.equal(r.cells["X"]["1"], 2);
  assert.equal(r.cells["X"]["2"], 1);
});

test("avg 集計", () => {
  const rows = [
    { a: "X", b: "1", v: 10 },
    { a: "X", b: "1", v: 30 },
  ];
  const r = pivot(rows, "a", "b", "v", "avg");
  assert.equal(r.cells["X"]["1"], 20);
});

test("欠落セルは null", () => {
  const rows = [
    { a: "A", b: "1", v: 10 },
    { a: "B", b: "2", v: 20 },
  ];
  const r = pivot(rows, "a", "b", "v", "sum");
  assert.equal(r.cells["A"]["2"], null);
  assert.equal(r.cells["B"]["1"], null);
});

test("min / max", () => {
  const rows = [
    { a: "X", b: "1", v: 5 },
    { a: "X", b: "1", v: 30 },
    { a: "X", b: "1", v: 10 },
  ];
  const min = pivot(rows, "a", "b", "v", "min");
  const max = pivot(rows, "a", "b", "v", "max");
  assert.equal(min.cells["X"]["1"], 5);
  assert.equal(max.cells["X"]["1"], 30);
});

test("登場順を保つ", () => {
  const rows = [
    { a: "Z", b: "C", v: 1 },
    { a: "A", b: "B", v: 1 },
    { a: "Z", b: "B", v: 1 },
  ];
  const r = pivot(rows, "a", "b", "v", "sum");
  assert.deepEqual(r.rowKeys, ["Z", "A"]);
  assert.deepEqual(r.colKeys, ["C", "B"]);
});

test("min / max が文字列列に辞書順で適用される", () => {
  const rows = [
    { a: "X", b: "1", v: "banana" },
    { a: "X", b: "1", v: "apple" },
    { a: "X", b: "1", v: "cherry" },
  ];
  const min = pivot(rows, "a", "b", "v", "min");
  const max = pivot(rows, "a", "b", "v", "max");
  assert.equal(min.cells["X"]["1"], "apple");
  assert.equal(max.cells["X"]["1"], "cherry");
});

test("min / max が ISO 日付文字列に対し時系列順で動作", () => {
  // ISO 8601 日付文字列は辞書順 = 時系列順
  const rows = [
    { a: "X", b: "1", v: "2026-03-01" },
    { a: "X", b: "1", v: "2026-01-15" },
    { a: "X", b: "1", v: "2026-02-20" },
  ];
  const min = pivot(rows, "a", "b", "v", "min");
  const max = pivot(rows, "a", "b", "v", "max");
  assert.equal(min.cells["X"]["1"], "2026-01-15");
  assert.equal(max.cells["X"]["1"], "2026-03-01");
});

test("count は文字列列でも行数を返す", () => {
  const rows = [
    { a: "X", b: "1", v: "alpha" },
    { a: "X", b: "1", v: "beta" },
    { a: "X", b: "1", v: "gamma" },
  ];
  const r = pivot(rows, "a", "b", "v", "count");
  assert.equal(r.cells["X"]["1"], 3);
});

test("sum / avg は文字列列に対し null を返す (現状維持)", () => {
  const rows = [
    { a: "X", b: "1", v: "alpha" },
    { a: "X", b: "1", v: "beta" },
  ];
  const sumR = pivot(rows, "a", "b", "v", "sum");
  const avgR = pivot(rows, "a", "b", "v", "avg");
  assert.equal(sumR.cells["X"]["1"], null);
  assert.equal(avgR.cells["X"]["1"], null);
});

test("min / max は数値と文字列の混在時に数値ブランチを優先", () => {
  const rows = [
    { a: "X", b: "1", v: 5 },
    { a: "X", b: "1", v: "apple" },
    { a: "X", b: "1", v: 20 },
  ];
  const min = pivot(rows, "a", "b", "v", "min");
  const max = pivot(rows, "a", "b", "v", "max");
  // 数値があれば数値で MIN/MAX を取り、文字列は無視する
  assert.equal(min.cells["X"]["1"], 5);
  assert.equal(max.cells["X"]["1"], 20);
});

test("min / max 文字列モードでは合計行は空 (null) になる", () => {
  const rows = [
    { a: "A", b: "1", v: "banana" },
    { a: "A", b: "2", v: "apple" },
  ];
  const r = pivot(rows, "a", "b", "v", "min");
  assert.equal(r.cells["A"]["1"], "banana");
  assert.equal(r.cells["A"]["2"], "apple");
  // 文字列セルは加算スキップされるため合計は 0 のまま (空欄相当)
  assert.equal(r.rowTotals["A"], 0);
  assert.equal(r.colTotals["1"], 0);
  assert.equal(r.colTotals["2"], 0);
  assert.equal(r.grandTotal, 0);
});

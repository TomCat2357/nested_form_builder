import assert from "node:assert/strict";
import test from "node:test";
import { buildHeatRanges, getHeatRange } from "./heatmapRanges.js";

const COLS = ["a", "b"];
const NUMERIC = new Set(COLS);

// データ: 1〜3 行目に通常値、4 行目に極端値 (9999)。
// 4 行目を除外すると min/max が大きく動く。
const rows = [
  { a: 1, b: 10 },
  { a: 2, b: 20 },
  { a: 3, b: 30 },
  { a: 9999, b: 9999 },
];

// dispRow === 4 (= idx + 1) を除外する predicate
const excludeLastRow = (_row, dispRow) => dispRow === 4;

test("buildHeatRanges column: predicate なしで全行 min/max", () => {
  const meta = buildHeatRanges(rows, COLS, NUMERIC, "column", null);
  assert.equal(meta.kind, "column");
  assert.deepEqual(meta.ranges.get("a"), [1, 9999]);
  assert.deepEqual(meta.ranges.get("b"), [10, 9999]);
});

test("buildHeatRanges column: 除外行は min/max スキャンから外れる", () => {
  const meta = buildHeatRanges(rows, COLS, NUMERIC, "column", excludeLastRow);
  assert.deepEqual(meta.ranges.get("a"), [1, 3]);
  assert.deepEqual(meta.ranges.get("b"), [10, 30]);
});

test("buildHeatRanges row: 除外行は rowRanges で null", () => {
  const meta = buildHeatRanges(rows, COLS, NUMERIC, "row", excludeLastRow);
  assert.equal(meta.kind, "row");
  assert.deepEqual(meta.rowRanges[0], [1, 10]);
  assert.deepEqual(meta.rowRanges[1], [2, 20]);
  assert.deepEqual(meta.rowRanges[2], [3, 30]);
  assert.equal(meta.rowRanges[3], null);
});

test("buildHeatRanges row: predicate なしは全行に range が出る", () => {
  const meta = buildHeatRanges(rows, COLS, NUMERIC, "row", null);
  assert.deepEqual(meta.rowRanges[3], [9999, 9999]);
});

test("buildHeatRanges all: 除外行は全体 min/max から外れる", () => {
  const meta = buildHeatRanges(rows, COLS, NUMERIC, "all", excludeLastRow);
  assert.equal(meta.kind, "all");
  assert.deepEqual(meta.range, [1, 30]);
});

test("buildHeatRanges all: predicate なしは除外行も含めて min/max", () => {
  const meta = buildHeatRanges(rows, COLS, NUMERIC, "all", null);
  assert.deepEqual(meta.range, [1, 9999]);
});

test("buildHeatRanges all: 全行除外時は range が null", () => {
  const meta = buildHeatRanges(rows, COLS, NUMERIC, "all", () => true);
  assert.equal(meta.range, null);
});

test("buildHeatRanges column: numericCols に含まれない列は除外列扱いで ranges に含まれない", () => {
  const meta = buildHeatRanges(rows, COLS, new Set(["a"]), "column", null);
  assert.equal(meta.ranges.has("a"), true);
  assert.equal(meta.ranges.has("b"), false);
});

test("getHeatRange: 各 kind の取得", () => {
  const colMeta = buildHeatRanges(rows, COLS, NUMERIC, "column", null);
  assert.deepEqual(getHeatRange(colMeta, "a", 0), [1, 9999]);

  const rowMeta = buildHeatRanges(rows, COLS, NUMERIC, "row", excludeLastRow);
  assert.equal(getHeatRange(rowMeta, "a", 3), null);
  assert.deepEqual(getHeatRange(rowMeta, "a", 0), [1, 10]);

  const allMeta = buildHeatRanges(rows, COLS, NUMERIC, "all", excludeLastRow);
  assert.deepEqual(getHeatRange(allMeta, "a", 0), [1, 30]);

  assert.equal(getHeatRange(null, "a", 0), null);
});

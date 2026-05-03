import assert from "node:assert/strict";
import test from "node:test";
import { suggestChartType, CHART_AXIS_REQUIREMENTS } from "./suggestChartType.js";

test("空・null は table", () => {
  assert.equal(suggestChartType([], 0), "table");
  assert.equal(suggestChartType(null, 0), "table");
  assert.equal(suggestChartType(undefined, 0), "table");
});

test("(0 dim, 1 metric) → scalar", () => {
  const cols = [{ name: "a_1", role: "metric", aggType: "count", type: "number" }];
  assert.equal(suggestChartType(cols, 1), "scalar");
});

test("(1 dim string + 1 metric) → bar", () => {
  const cols = [
    { name: "区", role: "dimension", type: "string" },
    { name: "a_1", role: "metric", aggType: "count", type: "number" },
  ];
  assert.equal(suggestChartType(cols, 5), "bar");
});

test("(1 dim date + 1 metric) → line", () => {
  const cols = [
    { name: "受付日", role: "dimension", type: "date" },
    { name: "a_1", role: "metric", aggType: "sum", type: "number" },
  ];
  assert.equal(suggestChartType(cols, 12), "line");
});

test("bucket alias suffix (__month) も date dim とみなす → line", () => {
  // type が "string" でも bucket suffix があれば line を勧める
  const cols = [
    { name: "受付日__month", role: "dimension", type: "string" },
    { name: "a_1", role: "metric", aggType: "count", type: "number" },
  ];
  assert.equal(suggestChartType(cols, 12), "line");
});

test("(1 dim, 複数 metric) → bar", () => {
  const cols = [
    { name: "区", role: "dimension", type: "string" },
    { name: "a_1", role: "metric", aggType: "sum", type: "number" },
    { name: "a_2", role: "metric", aggType: "avg", type: "number" },
  ];
  assert.equal(suggestChartType(cols, 5), "bar");
});

test("raw 数値 2 列 → scatter", () => {
  const cols = [
    { name: "x", type: "number" },
    { name: "y", type: "number" },
  ];
  assert.equal(suggestChartType(cols, 100), "scatter");
});

test("raw 数値 2 列 + raw 1 列（系列候補） → scatter", () => {
  const cols = [
    { name: "x", type: "number" },
    { name: "y", type: "number" },
    { name: "category", type: "string" },
  ];
  assert.equal(suggestChartType(cols, 100), "scatter");
});

test("raw 4 列以上は table（散布図のロール認識が曖昧）", () => {
  const cols = [
    { name: "a", type: "number" },
    { name: "b", type: "number" },
    { name: "c", type: "string" },
    { name: "d", type: "string" },
  ];
  assert.equal(suggestChartType(cols, 100), "table");
});

test("dim 2 つ以上は table", () => {
  const cols = [
    { name: "区", role: "dimension", type: "string" },
    { name: "区分", role: "dimension", type: "string" },
    { name: "a_1", role: "metric", aggType: "count", type: "number" },
  ];
  assert.equal(suggestChartType(cols, 5), "table");
});

test("CHART_AXIS_REQUIREMENTS は 6 種カバー", () => {
  for (const t of ["table", "scalar", "bar", "line", "pie", "scatter"]) {
    assert.ok(CHART_AXIS_REQUIREMENTS[t], "missing: " + t);
  }
});

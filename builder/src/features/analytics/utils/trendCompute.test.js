import assert from "node:assert/strict";
import test from "node:test";
import { computeTrend } from "./trendCompute.js";

test("空配列は全 null", () => {
  const r = computeTrend([], "x", "y");
  assert.equal(r.current, null);
  assert.equal(r.previous, null);
  assert.deepEqual(r.sparkline, []);
});

test("1 行のみは current のみ", () => {
  const rows = [{ d: "2026-01", v: 100 }];
  const r = computeTrend(rows, "d", "v");
  assert.equal(r.current, 100);
  assert.equal(r.previous, null);
  assert.equal(r.currentLabel, "2026-01");
});

test("複数行は最後と1つ前", () => {
  const rows = [
    { d: "2026-01", v: 50 },
    { d: "2026-02", v: 80 },
    { d: "2026-03", v: 120 },
  ];
  const r = computeTrend(rows, "d", "v");
  assert.equal(r.current, 120);
  assert.equal(r.previous, 80);
  assert.equal(r.currentLabel, "2026-03");
  assert.equal(r.previousLabel, "2026-02");
  assert.deepEqual(r.sparkline, [50, 80, 120]);
});

test("非数値値はスキップ", () => {
  const rows = [
    { d: "2026-01", v: 50 },
    { d: "2026-02", v: null },
    { d: "2026-03", v: 120 },
  ];
  const r = computeTrend(rows, "d", "v");
  assert.equal(r.current, 120);
  assert.equal(r.previous, 50);
  assert.deepEqual(r.sparkline, [50, 120]);
});

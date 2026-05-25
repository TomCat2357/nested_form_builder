import assert from "node:assert/strict";
import test from "node:test";
import { computeWaterfall } from "./waterfallCompute.js";

test("空配列は bars 空 / total 0", () => {
  const r = computeWaterfall([], "x", "y");
  assert.deepEqual(r.bars, []);
  assert.equal(r.total, 0);
});

test("3 行の累積遷移", () => {
  const rows = [
    { step: "A", v: 100 },
    { step: "B", v: -30 },
    { step: "C", v: 20 },
  ];
  const r = computeWaterfall(rows, "step", "v");
  assert.equal(r.bars.length, 3);
  assert.deepEqual(r.bars[0], { label: "A", start: 0, end: 100, kind: "up", delta: 100 });
  assert.deepEqual(r.bars[1], { label: "B", start: 100, end: 70, kind: "down", delta: -30 });
  assert.deepEqual(r.bars[2], { label: "C", start: 70, end: 90, kind: "up", delta: 20 });
  assert.equal(r.total, 90);
});

test("非数値はスキップ", () => {
  const rows = [
    { step: "A", v: 100 },
    { step: "B", v: null },
    { step: "C", v: 20 },
  ];
  const r = computeWaterfall(rows, "step", "v");
  assert.equal(r.bars.length, 2);
  assert.equal(r.total, 120);
});

test("0 値は kind=flat", () => {
  const rows = [{ step: "A", v: 0 }];
  const r = computeWaterfall(rows, "step", "v");
  assert.equal(r.bars[0].kind, "flat");
});

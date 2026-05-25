import assert from "node:assert/strict";
import test from "node:test";
import { mergeViz } from "./mergeViz.js";

test("override が無いときは元の viz をそのまま返す", () => {
  const orig = { type: "bar", xField: "a" };
  assert.equal(mergeViz(orig, null), orig);
  assert.equal(mergeViz(orig, undefined), orig);
});

test("元 viz が空のときは { type: 'table' } を土台にする", () => {
  assert.deepEqual(mergeViz(null, null), { type: "table" });
  assert.deepEqual(mergeViz(undefined, { showLegend: false }), { type: "table", showLegend: false });
});

test("トップレベルのキーを浅くマージする", () => {
  const orig = { type: "bar", xField: "a", yFields: ["b"], showLegend: true };
  assert.deepEqual(mergeViz(orig, { type: "line", showLegend: false }), {
    type: "line",
    xField: "a",
    yFields: ["b"],
    showLegend: false,
  });
});

test("元 viz は書き換えない", () => {
  const orig = { type: "bar", axis: { y: { auto: true, min: null, max: null } } };
  const out = mergeViz(orig, { type: "line", axis: { y: { auto: false, min: 0 } } });
  assert.equal(orig.type, "bar");
  assert.equal(orig.axis.y.auto, true);
  assert.notEqual(out, orig);
  assert.notEqual(out.axis, orig.axis);
});

test("axis は x / y それぞれを浅くマージし、未指定側は元設定を残す", () => {
  const orig = { type: "scatter", axis: { x: { auto: false, min: 1, max: 9 }, y: { auto: false, min: 0, max: 100 } } };
  const out = mergeViz(orig, { axis: { y: { min: 10 } } });
  assert.deepEqual(out.axis.x, { auto: false, min: 1, max: 9 });
  assert.deepEqual(out.axis.y, { auto: false, min: 10, max: 100 });
});

test("元 viz に axis が無くても override の axis を反映する", () => {
  const out = mergeViz({ type: "bar" }, { axis: { y: { auto: false, min: 0, max: 50 } } });
  assert.deepEqual(out.axis, { y: { auto: false, min: 0, max: 50 } });
});

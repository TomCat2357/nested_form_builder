import test from "node:test";
import assert from "node:assert/strict";
import { detectAxisTypes } from "./axisTypes.js";

const COMPILED = [
  { name: "d", type: "date" },
  { name: "n1", type: "number", displayLabel: "金額" },
  { name: "n2", type: "number" },
  { name: "s", type: "string" },
];
const COLUMNS = ["d", "n1", "n2", "s"];

const call = (over) => detectAxisTypes({
  type: "bar", xField: "s", yFields: ["n1"], columns: COLUMNS, compiledColumns: COMPILED, fallbackTypeMap: null, ...over,
});

test("scatter + 日付 X + 数値 Y: 軸も凡例も出る、X 入力も出る", () => {
  const r = call({ type: "scatter", xField: "d", yFields: ["n1"] });
  assert.equal(r.xAxisType, "date");
  assert.equal(r.yAxisType, "number");
  assert.equal(r.showAxis, true);
  assert.equal(r.showX, true);
  assert.equal(r.showY, true);
  assert.equal(r.showLegend, true);
});

test("scatter 以外は showX が常に false（軸は出るが X 入力欄は出さない）", () => {
  const r = call({ type: "bar", xField: "d", yFields: ["n1"] });
  assert.equal(r.showAxis, true);
  assert.equal(r.showX, false);
  assert.equal(r.showY, true);
});

test("Y の列で型が混在したら yAxisType は null・showY false", () => {
  const r = call({ yFields: ["n1", "d"] });
  assert.equal(r.yAxisType, null);
  assert.equal(r.showY, false);
});

test("Y の列が同じ型なら yAxisType はその型", () => {
  const r = call({ yFields: ["n1", "n2"] });
  assert.equal(r.yAxisType, "number");
  assert.equal(r.showY, true);
});

test("yFields 空: yTypeWhenEmpty 既定 null では showY false", () => {
  const r = call({ yFields: [] });
  assert.equal(r.yAxisType, null);
  assert.equal(r.showY, false);
});

test("yFields 空: yTypeWhenEmpty 'number' では数値とみなして showY true", () => {
  const r = call({ yFields: [], yTypeWhenEmpty: "number" });
  assert.equal(r.yAxisType, "number");
  assert.equal(r.showY, true);
});

test("軸/凡例を持たないタイプ（table）は showAxis も showLegend も false", () => {
  const r = call({ type: "table" });
  assert.equal(r.showAxis, false);
  assert.equal(r.showLegend, false);
});

test("X が未知の列なら xAxisType null・scatter でも showX false", () => {
  const r = call({ type: "scatter", xField: "zzz", yFields: ["n1"] });
  assert.equal(r.xAxisType, null);
  assert.equal(r.showX, false);
});

test("xField に表示ラベルを渡しても resolveColumnKey で解決される", () => {
  const r = call({ type: "scatter", xField: "金額", yFields: ["n1"] });
  assert.equal(r.xAxisType, "number");
  assert.equal(r.showX, true);
});

test("yFields が配列でない場合は空扱い", () => {
  const r = call({ yFields: undefined, yTypeWhenEmpty: "number" });
  assert.equal(r.yAxisType, "number");
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildSankeyData } from "./sankeyCompute.js";

test("空配列は nodes/links 空", () => {
  const r = buildSankeyData([], "s", "t", "v");
  assert.deepEqual(r.nodes, []);
  assert.deepEqual(r.links, []);
});

test("基本的なフロー", () => {
  const rows = [
    { s: "A", t: "B", v: 10 },
    { s: "B", t: "C", v: 5 },
  ];
  const r = buildSankeyData(rows, "s", "t", "v");
  assert.deepEqual(r.nodes, [{ name: "A" }, { name: "B" }, { name: "C" }]);
  assert.equal(r.links.length, 2);
  assert.deepEqual(r.links[0], { source: "A", target: "B", value: 10 });
  assert.deepEqual(r.links[1], { source: "B", target: "C", value: 5 });
});

test("同一 (source, target) は合算", () => {
  const rows = [
    { s: "A", t: "B", v: 10 },
    { s: "A", t: "B", v: 20 },
  ];
  const r = buildSankeyData(rows, "s", "t", "v");
  assert.equal(r.links.length, 1);
  assert.equal(r.links[0].value, 30);
});

test("自己ループは除外", () => {
  const rows = [
    { s: "A", t: "A", v: 10 },
    { s: "A", t: "B", v: 5 },
  ];
  const r = buildSankeyData(rows, "s", "t", "v");
  assert.equal(r.links.length, 1);
  assert.equal(r.links[0].source, "A");
  assert.equal(r.links[0].target, "B");
});

test("0 / 負値 / 非数値は除外", () => {
  const rows = [
    { s: "A", t: "B", v: 0 },
    { s: "A", t: "C", v: -5 },
    { s: "A", t: "D", v: "abc" },
    { s: "A", t: "E", v: 10 },
  ];
  const r = buildSankeyData(rows, "s", "t", "v");
  assert.equal(r.links.length, 1);
  assert.equal(r.links[0].target, "E");
});

test("valueField 空は count (各行 1)", () => {
  const rows = [
    { s: "A", t: "B" },
    { s: "A", t: "B" },
    { s: "A", t: "C" },
  ];
  const r = buildSankeyData(rows, "s", "t", "");
  const ab = r.links.find((l) => l.target === "B");
  const ac = r.links.find((l) => l.target === "C");
  assert.equal(ab.value, 2);
  assert.equal(ac.value, 1);
});

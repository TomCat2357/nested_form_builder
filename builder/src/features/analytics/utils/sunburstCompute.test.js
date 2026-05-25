import assert from "node:assert/strict";
import test from "node:test";
import { buildSunburstTree } from "./sunburstCompute.js";

test("空配列は空ツリー", () => {
  assert.deepEqual(buildSunburstTree([], ["a"], "v"), []);
});

test("levelFields 空も空ツリー", () => {
  assert.deepEqual(buildSunburstTree([{ a: "X" }], [], "v"), []);
});

test("単一階層 (count モード, valueField 空)", () => {
  const rows = [{ a: "X" }, { a: "X" }, { a: "Y" }];
  const tree = buildSunburstTree(rows, ["a"], "");
  assert.equal(tree.length, 2);
  const x = tree.find((n) => n.name === "X");
  const y = tree.find((n) => n.name === "Y");
  assert.equal(x.value, 2);
  assert.equal(y.value, 1);
});

test("2 階層集計 (sum)", () => {
  const rows = [
    { 国: "JP", 県: "東京", v: 100 },
    { 国: "JP", 県: "東京", v: 50 },
    { 国: "JP", 県: "大阪", v: 80 },
    { 国: "US", 県: "CA", v: 200 },
  ];
  const tree = buildSunburstTree(rows, ["国", "県"], "v");
  assert.equal(tree.length, 2);
  const jp = tree.find((n) => n.name === "JP");
  assert.equal(jp.value, 230);
  assert.equal(jp.children.length, 2);
  const tokyo = jp.children.find((n) => n.name === "東京");
  assert.equal(tokyo.value, 150);
  const us = tree.find((n) => n.name === "US");
  assert.equal(us.value, 200);
});

test("非数値値は 0 として扱う", () => {
  const rows = [
    { a: "X", v: "abc" },
    { a: "X", v: 10 },
  ];
  const tree = buildSunburstTree(rows, ["a"], "v");
  assert.equal(tree[0].value, 10);
});

test("葉ノードには children プロパティが付かない", () => {
  const rows = [{ a: "X", v: 1 }];
  const tree = buildSunburstTree(rows, ["a"], "v");
  assert.equal(tree[0].children, undefined);
});

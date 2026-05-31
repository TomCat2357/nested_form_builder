import assert from "node:assert/strict";
import test from "node:test";
import { joinMultiValue, splitMultiValue, MULTI_VALUE_SEP } from "./multiValue.js";

test("MULTI_VALUE_SEP はカンマ", () => {
  assert.equal(MULTI_VALUE_SEP, ",");
});

test("joinMultiValue: 通常ラベルはカンマ連結", () => {
  assert.equal(joinMultiValue(["りんご", "みかん"]), "りんご,みかん");
});

test("joinMultiValue: null/undefined/空文字はスキップ", () => {
  assert.equal(joinMultiValue(["a", "", null, undefined, "b"]), "a,b");
  assert.equal(joinMultiValue([]), "");
  assert.equal(joinMultiValue(null), "");
});

test("joinMultiValue: ラベル内のカンマ・バックスラッシュをエスケープ", () => {
  assert.equal(joinMultiValue(["赤, 青", "カラス"]), "赤\\, 青,カラス");
  assert.equal(joinMultiValue(["a\\b"]), "a\\\\b");
});

test("splitMultiValue: 通常分割", () => {
  assert.deepEqual(splitMultiValue("りんご,みかん"), ["りんご", "みかん"]);
});

test("splitMultiValue: 空/null/undefined は空配列", () => {
  assert.deepEqual(splitMultiValue(""), []);
  assert.deepEqual(splitMultiValue(null), []);
  assert.deepEqual(splitMultiValue(undefined), []);
});

test("splitMultiValue: 空トークン（連続/先頭/末尾カンマ）は除外", () => {
  assert.deepEqual(splitMultiValue("a,,b"), ["a", "b"]);
  assert.deepEqual(splitMultiValue(",a,"), ["a"]);
});

test("splitMultiValue: エスケープされたカンマはラベルの一部", () => {
  assert.deepEqual(splitMultiValue("赤\\, 青,カラス"), ["赤, 青", "カラス"]);
});

test("splitMultiValue: エスケープされたバックスラッシュ", () => {
  assert.deepEqual(splitMultiValue("a\\\\b"), ["a\\b"]);
});

test("splitMultiValue: 前後空白は保持（trim しない）", () => {
  assert.deepEqual(splitMultiValue(" x , y "), [" x ", " y "]);
});

test("往復: カンマ・バックスラッシュ・空白を含むラベルが一意に復元される", () => {
  const cases = [
    ["りんご", "みかん"],
    ["赤, 青", "カラス"],
    ["a\\b", "c,d", " 前後 "],
    ["only"],
    ["a,b,c"],
    ["\\", ","],
  ];
  for (const labels of cases) {
    assert.deepEqual(splitMultiValue(joinMultiValue(labels)), labels);
  }
});

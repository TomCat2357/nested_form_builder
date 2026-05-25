import test from "node:test";
import assert from "node:assert/strict";
import { stringifyKey, toFiniteNumberOrNull, rowValueOrCount, unionRowKeys } from "./computeShared.js";

test("stringifyKey: null/undefined と空文字を区別する", () => {
  assert.equal(stringifyKey(null), "(null)");
  assert.equal(stringifyKey(undefined), "(null)");
  assert.equal(stringifyKey(""), "(空)");
  assert.equal(stringifyKey(0), "0");
  assert.equal(stringifyKey("a"), "a");
  assert.equal(stringifyKey(false), "false");
});

test("toFiniteNumberOrNull: 空値・非数値は null", () => {
  assert.equal(toFiniteNumberOrNull(null), null);
  assert.equal(toFiniteNumberOrNull(undefined), null);
  assert.equal(toFiniteNumberOrNull(""), null);
  assert.equal(toFiniteNumberOrNull("abc"), null);
  assert.equal(toFiniteNumberOrNull(NaN), null);
  assert.equal(toFiniteNumberOrNull(Infinity), null);
  assert.equal(toFiniteNumberOrNull(3), 3);
  assert.equal(toFiniteNumberOrNull("3.5"), 3.5);
  assert.equal(toFiniteNumberOrNull(0), 0);
});

test("rowValueOrCount: valueField 無しは常に 1", () => {
  assert.equal(rowValueOrCount({ x: 9 }, undefined), 1);
  assert.equal(rowValueOrCount(null, undefined), 1);
  assert.equal(rowValueOrCount({ x: 9 }, ""), 1);
});

test("rowValueOrCount: valueField ありは数値、空値・非数値は 0", () => {
  assert.equal(rowValueOrCount({ v: 5 }, "v"), 5);
  assert.equal(rowValueOrCount({ v: "5" }, "v"), 5);
  assert.equal(rowValueOrCount({ v: "" }, "v"), 0);
  assert.equal(rowValueOrCount({ v: null }, "v"), 0);
  assert.equal(rowValueOrCount({ v: "x" }, "v"), 0);
  assert.equal(rowValueOrCount({}, "v"), 0);
  assert.equal(rowValueOrCount(null, "v"), 0);
});

test("unionRowKeys: 初出順で全行のキーを和集合する", () => {
  const rows = [
    { a: 1, b: 2, id: "r1", No_: 1 },
    { a: 3, c: 4, id: "r2", No_: 2 }, // c は r2 で初出
    { d: 5, a: 6, id: "r3", No_: 3 }, // d は r3 で初出、a は既出
  ];
  assert.deepEqual(unionRowKeys(rows), ["a", "b", "id", "No_", "c", "d"]);
});

test("unionRowKeys: 空配列・非配列・null 行を安全に扱う", () => {
  assert.deepEqual(unionRowKeys([]), []);
  assert.deepEqual(unionRowKeys(null), []);
  assert.deepEqual(unionRowKeys(undefined), []);
  assert.deepEqual(unionRowKeys([null, undefined, 5, "x", { a: 1 }]), ["a"]);
});

test("unionRowKeys: 単一行なら Object.keys と同じ", () => {
  assert.deepEqual(unionRowKeys([{ a: 1, b: 2 }]), ["a", "b"]);
});

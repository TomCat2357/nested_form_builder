import test from "node:test";
import assert from "node:assert/strict";
import { ensureArray, wrapArray, toIdList } from "./arrays.js";

test("ensureArray は配列をそのまま返す（同一参照）", () => {
  const arr = [1, 2, 3];
  assert.equal(ensureArray(arr), arr);
});

test("ensureArray は非配列を空配列へ畳む", () => {
  assert.deepEqual(ensureArray(null), []);
  assert.deepEqual(ensureArray(undefined), []);
  assert.deepEqual(ensureArray("a"), []);
  assert.deepEqual(ensureArray(0), []);
  assert.deepEqual(ensureArray({ length: 2 }), []);
});

test("wrapArray は配列をそのまま、単数は配列へ包む", () => {
  const arr = [1];
  assert.equal(wrapArray(arr), arr);
  assert.deepEqual(wrapArray("x"), ["x"]);
  assert.deepEqual(wrapArray(undefined), [undefined]);
});

test("toIdList は単数/複数を falsy 除外済みリストへ正規化する", () => {
  assert.deepEqual(toIdList("id1"), ["id1"]);
  assert.deepEqual(toIdList(["id1", "", null, "id2", undefined, 0]), ["id1", "id2"]);
  assert.deepEqual(toIdList(null), []);
  assert.deepEqual(toIdList(undefined), []);
});

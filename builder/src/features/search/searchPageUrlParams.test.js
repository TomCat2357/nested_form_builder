import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchChangeParams,
  buildSortToggleParams,
  buildPageChangeParams,
} from "./searchPageUrlParams.js";

const toObj = (sp) => Object.fromEntries(sp.entries());

test("buildSearchChangeParams: sets q and resets page to 1", () => {
  const next = buildSearchChangeParams(new URLSearchParams({ q: "old", page: "5" }), "new");
  assert.deepEqual(toObj(next), { q: "new", page: "1" });
});

test("buildSearchChangeParams: empty value removes q but keeps page reset", () => {
  const next = buildSearchChangeParams(new URLSearchParams({ q: "old", page: "5", sort: "a:asc" }), "");
  assert.equal(next.get("q"), null);
  assert.equal(next.get("page"), "1");
  assert.equal(next.get("sort"), "a:asc");
});

test("buildSearchChangeParams: does not mutate input", () => {
  const input = new URLSearchParams({ q: "old", page: "5" });
  buildSearchChangeParams(input, "new");
  assert.deepEqual(toObj(input), { q: "old", page: "5" });
});

test("buildSortToggleParams: new key starts at desc", () => {
  const next = buildSortToggleParams(new URLSearchParams({}), "氏名");
  assert.equal(next.get("sort"), "氏名:desc");
});

test("buildSortToggleParams: same key toggles desc->asc->desc", () => {
  const afterFirst = buildSortToggleParams(new URLSearchParams({ sort: "氏名:desc" }), "氏名");
  assert.equal(afterFirst.get("sort"), "氏名:asc");
  const afterSecond = buildSortToggleParams(new URLSearchParams({ sort: "氏名:asc" }), "氏名");
  assert.equal(afterSecond.get("sort"), "氏名:desc");
});

test("buildSortToggleParams: switching to a different key resets to desc", () => {
  const next = buildSortToggleParams(new URLSearchParams({ sort: "氏名:asc" }), "年齢");
  assert.equal(next.get("sort"), "年齢:desc");
});

test("buildPageChangeParams: sets page as string and preserves others", () => {
  const next = buildPageChangeParams(new URLSearchParams({ q: "x", page: "1" }), 4);
  assert.deepEqual(toObj(next), { q: "x", page: "4" });
});

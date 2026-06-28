import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildInitialSort,
  resolvePageSize,
  resolveTableMaxWidth,
  resolveCellDisplayLimit,
  resolveHitColumnMinWidth,
  resolveRequestedPage,
  computePagination,
} from "./searchPageSettings.js";

const params = (obj) => new URLSearchParams(obj);

test("buildInitialSort: default when no sort param", () => {
  assert.deepEqual(buildInitialSort(params({})), { key: "No.", order: "desc" });
});

test("buildInitialSort: bare key defaults to desc", () => {
  assert.deepEqual(buildInitialSort(params({ sort: "氏名" })), { key: "氏名", order: "desc" });
});

test("buildInitialSort: parses key:order and normalizes order", () => {
  assert.deepEqual(buildInitialSort(params({ sort: "氏名:asc" })), { key: "氏名", order: "asc" });
  assert.deepEqual(buildInitialSort(params({ sort: "氏名:desc" })), { key: "氏名", order: "desc" });
  // unknown order falls back to desc
  assert.deepEqual(buildInitialSort(params({ sort: "氏名:bogus" })), { key: "氏名", order: "desc" });
});

test("buildInitialSort: uses lastIndexOf colon so keys may contain colons", () => {
  assert.deepEqual(buildInitialSort(params({ sort: "a:b:asc" })), { key: "a:b", order: "asc" });
});

test("buildInitialSort: empty key collapses to No.", () => {
  assert.deepEqual(buildInitialSort(params({ sort: ":asc" })), { key: "No.", order: "asc" });
});

test("resolvePageSize: negative means all rows", () => {
  assert.equal(resolvePageSize(-1), Number.MAX_SAFE_INTEGER);
});

test("resolvePageSize: positive finite passes through", () => {
  assert.equal(resolvePageSize(50), 50);
});

test("resolvePageSize: zero / NaN / undefined fall back to default (20)", () => {
  assert.equal(resolvePageSize(0), 20);
  assert.equal(resolvePageSize(NaN), 20);
  assert.equal(resolvePageSize(undefined), 20);
  assert.equal(resolvePageSize("not-a-number"), 20);
});

test("resolveTableMaxWidth: first truthy numeric wins, else null", () => {
  assert.equal(resolveTableMaxWidth(800, 600, 400), 800);
  assert.equal(resolveTableMaxWidth(0, 600, 400), 600);
  assert.equal(resolveTableMaxWidth(undefined, undefined, 400), 400);
  assert.equal(resolveTableMaxWidth(undefined, undefined, undefined), null);
});

test("resolveCellDisplayLimit: first positive finite wins, else null", () => {
  assert.equal(resolveCellDisplayLimit(120, 80, 40), 120);
  assert.equal(resolveCellDisplayLimit(0, 80, 40), 80);
  assert.equal(resolveCellDisplayLimit(-5, undefined, 40), 40);
  assert.equal(resolveCellDisplayLimit(undefined, undefined, undefined), null);
});

test("resolveHitColumnMinWidth: first positive finite wins, else default (280)", () => {
  assert.equal(resolveHitColumnMinWidth(300, 200, 100), 300);
  assert.equal(resolveHitColumnMinWidth(0, 200, 100), 200);
  assert.equal(resolveHitColumnMinWidth(-1, NaN, 100), 100);
  assert.equal(resolveHitColumnMinWidth(undefined, undefined, undefined), 280);
});

test("resolveRequestedPage: clamps lower bound to 1", () => {
  assert.equal(resolveRequestedPage("5"), 5);
  assert.equal(resolveRequestedPage("0"), 1);
  assert.equal(resolveRequestedPage(null), 1);
  assert.equal(resolveRequestedPage(undefined), 1);
  assert.equal(resolveRequestedPage("-3"), 1);
});

test("computePagination: typical paging", () => {
  // 45 rows, 20 per page, requested page 2
  assert.deepEqual(computePagination(45, 2, 20), {
    totalPages: 3,
    page: 2,
    startIndex: 21,
    endIndex: 40,
  });
});

test("computePagination: clamps requested page to totalPages", () => {
  // 45 rows, 20 per page, requested page 9 -> clamps to 3
  assert.deepEqual(computePagination(45, 9, 20), {
    totalPages: 3,
    page: 3,
    startIndex: 41,
    endIndex: 45,
  });
});

test("computePagination: zero rows yields page 1 and zero indices", () => {
  assert.deepEqual(computePagination(0, 5, 20), {
    totalPages: 1,
    page: 1,
    startIndex: 0,
    endIndex: 0,
  });
});

test("computePagination: all-rows pageSize (MAX_SAFE_INTEGER) collapses to one page", () => {
  const r = computePagination(100, 3, Number.MAX_SAFE_INTEGER);
  assert.equal(r.totalPages, 1);
  assert.equal(r.page, 1);
  assert.equal(r.startIndex, 1);
  assert.equal(r.endIndex, 100);
});

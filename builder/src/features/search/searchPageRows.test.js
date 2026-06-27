import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProcessedEntries,
  buildDisplayPagedEntries,
  buildExportFilename,
} from "./searchPageRows.js";

test("buildProcessedEntries: no computed fields path passes entry through with null backfillResult", () => {
  const cols = [{ key: "氏名", path: "氏名", type: "text" }];
  const entries = [{ id: "r1", data: { 氏名: "田中" } }];
  const out = buildProcessedEntries({
    entries,
    searchColumns: cols,
    normalizedSchema: [],
    hasComputedFields: false,
    sameRecordBackfillFieldIds: null,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].entry, entries[0]);
  assert.equal(out[0].originalEntry, entries[0]);
  assert.equal(out[0].backfillResult, null);
  assert.ok(out[0].values, "values object present");
});

test("buildProcessedEntries: empty input yields empty output", () => {
  const out = buildProcessedEntries({
    entries: [],
    searchColumns: [],
    normalizedSchema: [],
    hasComputedFields: false,
    sameRecordBackfillFieldIds: null,
  });
  assert.deepEqual(out, []);
});

test("buildExportFilename: formats 検索結果_<title>_<timestamp>.xlsx", () => {
  const out = buildExportFilename({ settings: { formTitle: "アンケート" } }, new Date(2026, 5, 27, 9, 8, 7));
  assert.equal(out, "検索結果_アンケート_20260627_090807.xlsx");
});

test("buildExportFilename: falls back to form id then 'form'", () => {
  assert.equal(
    buildExportFilename({ id: "abc" }, new Date(2026, 0, 2, 3, 4, 5)),
    "検索結果_abc_20260102_030405.xlsx",
  );
  assert.equal(
    buildExportFilename(null, new Date(2026, 0, 2, 3, 4, 5)),
    "検索結果_form_20260102_030405.xlsx",
  );
});

test("buildDisplayPagedEntries: no hit column and no dependent columns returns rows unchanged", () => {
  const pagedEntries = [{ entry: { id: "r1", data: {} } }];
  const out = buildDisplayPagedEntries({
    pagedEntries,
    hitColumnActive: false,
    searchColumns: [],
    query: "",
    cellDisplayLimit: null,
    dependentSubstColumns: [],
    childDataReady: true,
    fullQueryReady: true,
    queryTokensByEntry: new Map(),
    recomputePending: false,
  });
  assert.equal(out, pagedEntries);
});

test("buildDisplayPagedEntries: flags empty unresolved child-dependent cell as pending", () => {
  const pagedEntries = [
    { entry: { id: "r1", data: { 件数: "" } } }, // empty + unresolved -> pending
    { entry: { id: "r2", data: { 件数: "3" } } }, // non-empty -> not pending
  ];
  const dependentSubstColumns = [
    { columnKey: "件数", path: "件数", needsChild: true, needsFullQuery: false },
  ];
  const out = buildDisplayPagedEntries({
    pagedEntries,
    hitColumnActive: false,
    searchColumns: [],
    query: "",
    cellDisplayLimit: null,
    dependentSubstColumns,
    childDataReady: false, // child not ready -> pending
    fullQueryReady: true,
    queryTokensByEntry: new Map(),
    recomputePending: false,
  });
  assert.ok(out[0].pendingCellKeys instanceof Set);
  assert.ok(out[0].pendingCellKeys.has("件数"));
  assert.equal(out[1].pendingCellKeys, undefined);
});

test("buildDisplayPagedEntries: child-dependent cell not pending once child data is ready", () => {
  const pagedEntries = [{ entry: { id: "r1", data: { 件数: "" } } }];
  const dependentSubstColumns = [
    { columnKey: "件数", path: "件数", needsChild: true, needsFullQuery: false },
  ];
  const out = buildDisplayPagedEntries({
    pagedEntries,
    hitColumnActive: false,
    searchColumns: [],
    query: "",
    cellDisplayLimit: null,
    dependentSubstColumns,
    childDataReady: true,
    fullQueryReady: true,
    queryTokensByEntry: new Map(),
    recomputePending: false,
  });
  assert.equal(out[0].pendingCellKeys, undefined);
});

test("buildDisplayPagedEntries: full-query cell pending until tokens resolved for the row id", () => {
  const pagedEntries = [{ entry: { id: "r1", data: { 合計: "" } } }];
  const dependentSubstColumns = [
    { columnKey: "合計", path: "合計", needsChild: false, needsFullQuery: true },
  ];
  const base = {
    pagedEntries,
    hitColumnActive: false,
    searchColumns: [],
    query: "",
    cellDisplayLimit: null,
    dependentSubstColumns,
    childDataReady: true,
    recomputePending: false,
  };
  const pending = buildDisplayPagedEntries({ ...base, fullQueryReady: true, queryTokensByEntry: new Map() });
  assert.ok(pending[0].pendingCellKeys.has("合計"));

  const resolved = buildDisplayPagedEntries({
    ...base,
    fullQueryReady: true,
    queryTokensByEntry: new Map([["r1", new Map()]]),
  });
  assert.equal(resolved[0].pendingCellKeys, undefined);
});

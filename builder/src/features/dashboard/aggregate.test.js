import test from "node:test";
import assert from "node:assert/strict";
import {
  groupBy,
  sumBy,
  meanBy,
  describeNumeric,
  pivot,
  bucketByDate,
  flattenForms,
  countLive,
} from "./aggregate.js";

const makeEntry = (id, data, options = {}) => ({
  id,
  data,
  dataUnixMs: options.dataUnixMs || {},
  deletedAtUnixMs: options.deletedAtUnixMs || null,
});

test("groupBy counts categorical values", () => {
  const records = [
    makeEntry("a", { Q1: "X" }),
    makeEntry("b", { Q1: "Y" }),
    makeEntry("c", { Q1: "X" }),
    makeEntry("d", { Q1: "" }),
  ];
  const result = groupBy(records, "Q1");
  assert.deepEqual(result, [
    { key: "X", count: 2 },
    { key: "Y", count: 1 },
  ]);
});

test("groupBy expands array values (checkboxes)", () => {
  const records = [
    makeEntry("a", { Tags: ["red", "blue"] }),
    makeEntry("b", { Tags: ["red"] }),
    makeEntry("c", { Tags: [] }),
  ];
  const result = groupBy(records, "Tags");
  assert.deepEqual(result, [
    { key: "red", count: 2 },
    { key: "blue", count: 1 },
  ]);
});

test("groupBy ignores soft-deleted records", () => {
  const records = [
    makeEntry("a", { Q1: "X" }),
    makeEntry("b", { Q1: "X" }, { deletedAtUnixMs: 1700000000000 }),
  ];
  const result = groupBy(records, "Q1");
  assert.deepEqual(result, [{ key: "X", count: 1 }]);
});

test("sumBy / meanBy compute correctly with non-numeric values skipped", () => {
  const records = [
    makeEntry("a", { score: 10 }),
    makeEntry("b", { score: "20" }),
    makeEntry("c", { score: "abc" }),
    makeEntry("d", { score: null }),
  ];
  assert.equal(sumBy(records, "score"), 30);
  assert.equal(meanBy(records, "score"), 15);
});

test("describeNumeric reports min/max/mean/median/p25/p75", () => {
  const values = [1, 2, 3, 4, 5];
  const records = values.map((v, i) => makeEntry(`r${i}`, { score: v }));
  const stats = describeNumeric(records, "score");
  assert.equal(stats.count, 5);
  assert.equal(stats.min, 1);
  assert.equal(stats.max, 5);
  assert.equal(stats.mean, 3);
  assert.equal(stats.median, 3);
  assert.equal(stats.p25, 2);
  assert.equal(stats.p75, 4);
  assert.equal(stats.sum, 15);
});

test("describeNumeric returns nullCount when all empty", () => {
  const records = [
    makeEntry("a", { score: null }),
    makeEntry("b", { score: "" }),
  ];
  const stats = describeNumeric(records, "score");
  assert.equal(stats.count, 0);
  assert.equal(stats.nullCount, 2);
  assert.equal(stats.min, null);
});

test("pivot count aggregator builds a row x col matrix", () => {
  const records = [
    makeEntry("a", { gender: "M", age: "10s" }),
    makeEntry("b", { gender: "M", age: "20s" }),
    makeEntry("c", { gender: "F", age: "10s" }),
    makeEntry("d", { gender: "F", age: "10s" }),
  ];
  const { rows, cols, cells } = pivot(records, "gender", "age", { valueAggregator: "count" });
  assert.deepEqual(rows, ["F", "M"]);
  assert.deepEqual(cols, ["10s", "20s"]);
  assert.equal(cells.F["10s"], 2);
  assert.equal(cells.F["20s"], null);
  assert.equal(cells.M["10s"], 1);
  assert.equal(cells.M["20s"], 1);
});

test("pivot sum / mean aggregator uses valuePath", () => {
  const records = [
    makeEntry("a", { gender: "M", score: 10 }),
    makeEntry("b", { gender: "M", score: 30 }),
    makeEntry("c", { gender: "F", score: 50 }),
  ];
  const sumPivot = pivot(records, "gender", "gender", { valueAggregator: "sum", valuePath: "score" });
  assert.equal(sumPivot.cells.M.M, 40);
  assert.equal(sumPivot.cells.F.F, 50);

  const meanPivot = pivot(records, "gender", "gender", { valueAggregator: "mean", valuePath: "score" });
  assert.equal(meanPivot.cells.M.M, 20);
  assert.equal(meanPivot.cells.F.F, 50);
});

test("bucketByDate by day with count aggregator", () => {
  const day = 24 * 60 * 60 * 1000;
  const base = Date.UTC(2025, 0, 1, 12, 0, 0);
  const records = [
    makeEntry("a", {}, { dataUnixMs: { ts: base } }),
    makeEntry("b", {}, { dataUnixMs: { ts: base } }),
    makeEntry("c", {}, { dataUnixMs: { ts: base + day } }),
  ];
  const buckets = bucketByDate(records, "ts", { granularity: "day", aggregator: "count" });
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0].value, 2);
  assert.equal(buckets[1].value, 1);
  // bucketBy "day" labels should be sorted ascending
  assert.ok(buckets[0].bucket < buckets[1].bucket);
});

test("bucketByDate ignores entries without a date", () => {
  const records = [
    makeEntry("a", {}, { dataUnixMs: { ts: Date.UTC(2025, 0, 1) } }),
    makeEntry("b", {}),
    makeEntry("c", { ts: "not-a-date" }),
  ];
  const buckets = bucketByDate(records, "ts");
  assert.equal(buckets.length, 1);
});

test("countLive excludes soft-deleted entries", () => {
  const records = [
    makeEntry("a", {}),
    makeEntry("b", {}, { deletedAtUnixMs: 1 }),
    makeEntry("c", {}),
  ];
  assert.equal(countLive(records), 2);
});

test("flattenForms attaches __formId and __formTitle", () => {
  const flat = flattenForms({
    f1: { entries: [makeEntry("a", { x: 1 })], __formTitle: "Form 1" },
    f2: { entries: [makeEntry("b", { x: 2 })], __formTitle: "Form 2" },
  });
  assert.equal(flat.length, 2);
  assert.equal(flat[0].__formId, "f1");
  assert.equal(flat[0].__formTitle, "Form 1");
  assert.equal(flat[1].__formId, "f2");
});

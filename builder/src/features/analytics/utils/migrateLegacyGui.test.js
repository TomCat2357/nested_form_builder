import assert from "node:assert/strict";
import test from "node:test";
import { migrateLegacyGui } from "./migrateLegacyGui.js";

test("v1 最小ケース: formId + count 1 つ", () => {
  const v2 = migrateLegacyGui({
    formId: "f_x",
    aggregations: [{ id: "a_1", type: "count" }],
  });
  assert.equal(v2.schemaVersion, 2);
  assert.equal(v2.stages.length, 2);
  assert.equal(v2.stages[0].type, "pick_data");
  assert.deepEqual(v2.stages[0].source, { kind: "form", formId: "f_x" });
  assert.equal(v2.stages[1].type, "summarize");
  assert.deepEqual(v2.stages[1].aggregations, [{ id: "a_1", type: "count" }]);
  assert.deepEqual(v2.stages[1].groupBy, []);
});

test("v1 全部入り: pick_data → filter → summarize → sort → limit の順", () => {
  const v2 = migrateLegacyGui({
    formId: "f_x",
    aggregations: [
      { id: "a_1", type: "sum", column: "amount" },
      { id: "a_2", type: "avg", column: "amount" },
    ],
    groupBy: [{ column: "category" }, { column: "date", bucket: "month" }],
    filters: [{ id: "f1", column: "amount", operator: ">", value: 100 }],
    orderBy: [
      { ref: "agg:a_1", direction: "desc" },
      { ref: "col:category", direction: "asc" },
    ],
    limit: 50,
  });
  assert.equal(v2.schemaVersion, 2);
  assert.deepEqual(v2.stages.map((s) => s.type), ["pick_data", "filter", "summarize", "sort", "limit"]);

  const summarize = v2.stages.find((s) => s.type === "summarize");
  assert.equal(summarize.aggregations.length, 2);
  assert.deepEqual(summarize.groupBy, [
    { column: "category" },
    { column: "date", bucket: "month" },
  ]);

  const filter = v2.stages.find((s) => s.type === "filter");
  assert.equal(filter.conditions.length, 1);
  assert.equal(filter.conditions[0].operator, ">");
  assert.equal(filter.conditions[0].value, 100);

  const sort = v2.stages.find((s) => s.type === "sort");
  assert.deepEqual(sort.entries, [
    { column: "a_1", direction: "desc" },
    { column: "category", direction: "asc" },
  ]);

  const limit = v2.stages.find((s) => s.type === "limit");
  assert.equal(limit.count, 50);
});

test("v1 で aggregations が空でも pick_data だけは出る（raw mode）", () => {
  const v2 = migrateLegacyGui({ formId: "f_x", aggregations: [] });
  assert.equal(v2.stages.length, 1);
  assert.equal(v2.stages[0].type, "pick_data");
});

test("既に v2 形式 (stages を持つ) なら素通し", () => {
  const input = {
    schemaVersion: 2,
    stages: [{ id: "s_1", type: "pick_data", source: { kind: "form", formId: "f_x" } }],
  };
  const out = migrateLegacyGui(input);
  assert.equal(out.schemaVersion, 2);
  assert.equal(out.stages.length, 1);
  assert.equal(out.stages[0].type, "pick_data");
});

test("filter の value2 (between) が保持される", () => {
  const v2 = migrateLegacyGui({
    formId: "f_x",
    aggregations: [{ id: "a_1", type: "count" }],
    filters: [{ id: "f1", column: "amount", operator: "between", value: 10, value2: 20 }],
  });
  const filter = v2.stages.find((s) => s.type === "filter");
  assert.equal(filter.conditions[0].value, 10);
  assert.equal(filter.conditions[0].value2, 20);
});

test("limit が 0 や非数値なら limit ステージは生成されない", () => {
  const v2a = migrateLegacyGui({
    formId: "f_x",
    aggregations: [{ id: "a_1", type: "count" }],
    limit: 0,
  });
  assert.equal(v2a.stages.find((s) => s.type === "limit"), undefined);

  const v2b = migrateLegacyGui({
    formId: "f_x",
    aggregations: [{ id: "a_1", type: "count" }],
    limit: "abc",
  });
  assert.equal(v2b.stages.find((s) => s.type === "limit"), undefined);
});

test("orderBy の参照形式 agg:/col: が column に正規化される", () => {
  const v2 = migrateLegacyGui({
    formId: "f_x",
    aggregations: [{ id: "a_total", type: "count" }],
    orderBy: [{ ref: "agg:a_total", direction: "desc" }, { ref: "col:name" }],
  });
  const sort = v2.stages.find((s) => s.type === "sort");
  assert.deepEqual(sort.entries, [
    { column: "a_total", direction: "desc" },
    { column: "name", direction: "asc" },
  ]);
});

test("空 / null / undefined を渡しても落ちない", () => {
  assert.deepEqual(migrateLegacyGui(null), { schemaVersion: 2, stages: [] });
  assert.deepEqual(migrateLegacyGui(undefined), { schemaVersion: 2, stages: [] });
  assert.deepEqual(migrateLegacyGui({}), { schemaVersion: 2, stages: [] });
});

test("raw mode: type:raw の集計があれば summarize を生成しない", () => {
  const v2 = migrateLegacyGui({
    formId: "f_x",
    aggregations: [{ id: "a_1", type: "raw" }],
    groupBy: [{ column: "category" }],
  });
  assert.deepEqual(v2.stages.map((s) => s.type), ["pick_data"]);
});

test("raw mode + filter + limit: summarize は生成されないが filter/limit は残る", () => {
  const v2 = migrateLegacyGui({
    formId: "f_x",
    aggregations: [{ id: "a_1", type: "raw" }],
    filters: [{ id: "f1", column: "amount", operator: ">", value: 100 }],
    limit: 50,
  });
  assert.deepEqual(v2.stages.map((s) => s.type), ["pick_data", "filter", "limit"]);
});

test("raw が他の集計と混在していても全体が raw mode 扱い", () => {
  const v2 = migrateLegacyGui({
    formId: "f_x",
    aggregations: [
      { id: "a_1", type: "raw" },
      { id: "a_2", type: "sum", column: "amount" },
    ],
    groupBy: [{ column: "category" }],
  });
  assert.equal(v2.stages.find((s) => s.type === "summarize"), undefined);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBackfilledRecord,
  backfillComputedValuesInCache,
} from "./backfillComputedValues.js";

const makeField = (overrides) => ({
  id: overrides.id || `q_${Math.random().toString(36).slice(2, 8)}`,
  label: overrides.label || "field",
  type: overrides.type || "text",
  ...overrides,
});

test("buildBackfilledRecord は保存値が空の置換フィールドを動的計算で埋める", () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "Hello {@氏名}" }),
  ];
  const record = {
    id: "rec1",
    data: { "氏名": "太郎" },
    order: ["氏名"],
    modifiedAt: 1_000,
    modifiedAtUnixMs: 1_000,
    modifiedBy: "prev@example.com",
  };
  const next = buildBackfilledRecord(schema, record, { now: 9_999, userEmail: "me@example.com" });
  assert.ok(next);
  assert.equal(next.data["挨拶"], "Hello 太郎");
  assert.ok(next.order.includes("挨拶"));
  assert.equal(next.modifiedAtUnixMs, 9_999);
  assert.equal(next.modifiedAt, 9_999);
  assert.equal(next.modifiedBy, "me@example.com");
});

test("buildBackfilledRecord は保存値がある場合 null を返す（変更なし）", () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "Hello {@氏名}" }),
  ];
  const record = {
    id: "rec1",
    data: { "氏名": "太郎", "挨拶": "こんにちは 太郎" },
    order: ["氏名", "挨拶"],
  };
  const next = buildBackfilledRecord(schema, record, { now: 9_999 });
  assert.equal(next, null);
});

test("buildBackfilledRecord は計算/置換フィールドが無いスキーマで null を返す", () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
  ];
  const record = { id: "rec1", data: { "氏名": "太郎" }, order: ["氏名"] };
  const next = buildBackfilledRecord(schema, record, { now: 9_999 });
  assert.equal(next, null);
});

test("buildBackfilledRecord は userEmail 未指定時は既存の modifiedBy を維持する", () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "Hello {@氏名}" }),
  ];
  const record = {
    id: "rec1",
    data: { "氏名": "太郎" },
    order: ["氏名"],
    modifiedBy: "prev@example.com",
  };
  const next = buildBackfilledRecord(schema, record, { now: 9_999, userEmail: "" });
  assert.ok(next);
  assert.equal(next.modifiedBy, "prev@example.com");
});

test("buildBackfilledRecord は計算値が空文字になる場合は書き込まない", () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "{@氏名}" }),
  ];
  const record = { id: "rec1", data: {}, order: [] };
  const next = buildBackfilledRecord(schema, record, { now: 9_999 });
  assert.equal(next, null);
});

test("backfillComputedValuesInCache は空のフィールドだけ補完して upsert する", async () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "Hello {@氏名}" }),
  ];
  const entries = [
    { id: "a", data: { "氏名": "太郎" }, order: ["氏名"] },
    { id: "b", data: { "氏名": "花子", "挨拶": "Hi 花子" }, order: ["氏名", "挨拶"] },
    { id: "c", data: { "氏名": "次郎" }, order: ["氏名"] },
  ];
  const upsertCalls = [];
  const getRecordsFromCache = async () => ({ entries, headerMatrix: [], schemaHash: "h1" });
  const upsertRecordInCache = async (formId, record, opts) => {
    upsertCalls.push({ formId, record, opts });
  };

  const result = await backfillComputedValuesInCache({
    formId: "form1",
    schema,
    userEmail: "me@example.com",
    getRecordsFromCache,
    upsertRecordInCache,
    now: 5_000,
  });

  assert.equal(result.updatedCount, 2);
  assert.equal(upsertCalls.length, 2);
  assert.equal(upsertCalls[0].record.id, "a");
  assert.equal(upsertCalls[0].record.data["挨拶"], "Hello 太郎");
  assert.equal(upsertCalls[0].record.modifiedAtUnixMs, 5_000);
  assert.equal(upsertCalls[0].opts.schemaHash, "h1");
  assert.equal(upsertCalls[1].record.id, "c");
});

test("backfillComputedValuesInCache は計算/置換が無ければ何もしない", async () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
  ];
  let getCalled = 0;
  const getRecordsFromCache = async () => {
    getCalled += 1;
    return { entries: [{ id: "a", data: { "氏名": "太郎" } }], headerMatrix: [], schemaHash: "h" };
  };
  const upsertRecordInCache = async () => {
    throw new Error("should not be called");
  };
  const result = await backfillComputedValuesInCache({
    formId: "form1",
    schema,
    getRecordsFromCache,
    upsertRecordInCache,
  });
  assert.equal(result.updatedCount, 0);
  assert.equal(getCalled, 0); // 早期リターン
});

test("backfillComputedValuesInCache は空キャッシュで何もしない", async () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "Hello {@氏名}" }),
  ];
  const getRecordsFromCache = async () => ({ entries: [], headerMatrix: [], schemaHash: "h" });
  const upsertRecordInCache = async () => {
    throw new Error("should not be called");
  };
  const result = await backfillComputedValuesInCache({
    formId: "form1",
    schema,
    getRecordsFromCache,
    upsertRecordInCache,
  });
  assert.equal(result.updatedCount, 0);
});

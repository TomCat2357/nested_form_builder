import test from "node:test";
import assert from "node:assert/strict";
import { buildBackfilledRecord } from "./backfillComputedValues.js";
import { backfillComputedFieldValues } from "../../core/computedFields.js";

const makeField = (overrides) => ({
  id: overrides.id || `q_${Math.random().toString(36).slice(2, 8)}`,
  label: overrides.label || "field",
  type: overrides.type || "text",
  ...overrides,
});

const backfill = (schema, record) => backfillComputedFieldValues(schema, record?.data);

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
  const next = buildBackfilledRecord(record, backfill(schema, record), { now: 9_999, userEmail: "me@example.com" });
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
  const next = buildBackfilledRecord(record, backfill(schema, record), { now: 9_999 });
  assert.equal(next, null);
});

test("buildBackfilledRecord は計算/置換フィールドが無いスキーマで null を返す", () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
  ];
  const record = { id: "rec1", data: { "氏名": "太郎" }, order: ["氏名"] };
  const next = buildBackfilledRecord(record, backfill(schema, record), { now: 9_999 });
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
  const next = buildBackfilledRecord(record, backfill(schema, record), { now: 9_999, userEmail: "" });
  assert.ok(next);
  assert.equal(next.modifiedBy, "prev@example.com");
});

test("buildBackfilledRecord は計算値が空文字になる場合は書き込まない", () => {
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "{@氏名}" }),
  ];
  const record = { id: "rec1", data: {}, order: [] };
  const next = buildBackfilledRecord(record, backfill(schema, record), { now: 9_999 });
  assert.equal(next, null);
});

test("buildBackfilledRecord は backfillResult が null の場合も null を返す", () => {
  const record = { id: "rec1", data: {}, order: [] };
  assert.equal(buildBackfilledRecord(record, null), null);
  assert.equal(buildBackfilledRecord(record, { changed: false }), null);
});

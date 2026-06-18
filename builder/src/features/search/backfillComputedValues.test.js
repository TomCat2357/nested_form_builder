import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBackfilledRecord,
  selectFreshComputedWritePaths,
  rememberComputedWrites,
} from "./backfillComputedValues.js";
import { backfillComputedFieldValues } from "../../core/computedFields.js";
import {
  _clearExpressionCacheForTest,
  _registerCompiledForTest,
} from "../expression/alasqlExpressionEvaluator.js";

const makeField = (overrides) => ({
  id: overrides.id || `q_${Math.random().toString(36).slice(2, 8)}`,
  label: overrides.label || "field",
  type: overrides.type || "text",
  ...overrides,
});

const backfill = (schema, record) => backfillComputedFieldValues(schema, record?.data);

test("buildBackfilledRecord は保存値が空の置換フィールドを動的計算で埋める", () => {
  _clearExpressionCacheForTest();
  _registerCompiledForTest("`氏名`", (row) => row["氏名"]);
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "Hello {{`氏名`}}" }),
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
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "Hello {{`氏名`}}" }),
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
  _clearExpressionCacheForTest();
  _registerCompiledForTest("`氏名`", (row) => row["氏名"]);
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "Hello {{`氏名`}}" }),
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
  _clearExpressionCacheForTest();
  _registerCompiledForTest("`氏名`", (row) => row["氏名"]);
  const schema = [
    makeField({ id: "q1", label: "氏名", type: "text" }),
    makeField({ id: "q2", label: "挨拶", type: "substitution", templateText: "{{`氏名`}}" }),
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

// --- 冪等メモ（selectFreshComputedWritePaths / rememberComputedWrites）------------------

test("selectFreshComputedWritePaths は未記録の path を fresh として返す", () => {
  const memo = new Map();
  const data = { "件数": "3" };
  assert.deepEqual(selectFreshComputedWritePaths("rec1", ["件数"], data, memo), ["件数"]);
});

test("selectFreshComputedWritePaths は同値で記録済みの path を除外する（再打刻しない）", () => {
  const memo = new Map();
  const data = { "件数": "3" };
  rememberComputedWrites("rec1", ["件数"], data, memo);
  assert.deepEqual(selectFreshComputedWritePaths("rec1", ["件数"], data, memo), []);
});

test("selectFreshComputedWritePaths は値が変わったら再び fresh になる（正しい更新は維持）", () => {
  const memo = new Map();
  rememberComputedWrites("rec1", ["件数"], { "件数": "3" }, memo);
  // 子データが変わって計算値が "4" になった
  assert.deepEqual(selectFreshComputedWritePaths("rec1", ["件数"], { "件数": "4" }, memo), ["件数"]);
});

test("selectFreshComputedWritePaths は数値と文字列を String() 正規化で同値扱いする", () => {
  const memo = new Map();
  rememberComputedWrites("rec1", ["件数"], { "件数": "3" }, memo);
  assert.deepEqual(selectFreshComputedWritePaths("rec1", ["件数"], { "件数": 3 }, memo), []);
});

test("selectFreshComputedWritePaths は recordId ごとにメモを分離する", () => {
  const memo = new Map();
  rememberComputedWrites("rec1", ["件数"], { "件数": "3" }, memo);
  // 別レコードの同じ path・同じ値はまだ未記録なので fresh
  assert.deepEqual(selectFreshComputedWritePaths("rec2", ["件数"], { "件数": "3" }, memo), ["件数"]);
});

test("selectFreshComputedWritePaths は複数 path の一部だけ fresh を返す", () => {
  const memo = new Map();
  const data = { "件数": "3", "種別": "ライフル銃" };
  rememberComputedWrites("rec1", ["件数"], data, memo);
  assert.deepEqual(
    selectFreshComputedWritePaths("rec1", ["件数", "種別"], data, memo),
    ["種別"],
  );
});

test("selectFreshComputedWritePaths は changedPaths が空/未定義でも空配列を返す", () => {
  const memo = new Map();
  assert.deepEqual(selectFreshComputedWritePaths("rec1", [], {}, memo), []);
  assert.deepEqual(selectFreshComputedWritePaths("rec1", undefined, {}, memo), []);
});

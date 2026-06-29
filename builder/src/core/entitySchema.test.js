import test from "node:test";
import assert from "node:assert/strict";
import {
  ENTITY_SCHEMA,
  collectReferencedIds,
  applyRefRemapToPayload,
  childEntityTypesReferencing,
} from "./entitySchema.js";

// 宣言（ENTITY_SCHEMA）駆動の参照ウォーカーを単体で検証する。
// uploadQueue.pure.test.js は uploadQueue 経由の re-export を検証しており、こちらは
// path 記法（ネスト/配列展開）と逆引きの本体ロジックを直接固定する。

test("collectReferencedIds: question は gui.formId と formSources[].formId を集める", () => {
  const q = { query: { gui: { formId: "F1" }, formSources: [{ formId: "F2" }, { formId: "F3" }] } };
  assert.deepEqual(collectReferencedIds("question", q).sort(), ["F1", "F2", "F3"]);
});

test("collectReferencedIds: dashboard は cards[].questionId を集める", () => {
  const d = { cards: [{ questionId: "Q1" }, { type: "text" }, { questionId: "Q2" }] };
  assert.deepEqual(collectReferencedIds("dashboard", d).sort(), ["Q1", "Q2"]);
});

test("collectReferencedIds: form は参照を持たない（空配列）", () => {
  assert.deepEqual(collectReferencedIds("form", { schema: [{ id: "a" }] }), []);
});

test("collectReferencedIds: 未知の型・null payload は空配列", () => {
  assert.deepEqual(collectReferencedIds("unknown", { x: 1 }), []);
  assert.deepEqual(collectReferencedIds("question", null), []);
});

test("applyRefRemapToPayload: 配列展開の各要素まで深く書き換える", () => {
  const q = { query: { gui: { formId: "local_A" }, formSources: [{ formId: "local_A" }, { formId: "X" }] } };
  const changed = applyRefRemapToPayload("question", q, { local_A: "REAL1" });
  assert.equal(changed, true);
  assert.equal(q.query.gui.formId, "REAL1");
  assert.equal(q.query.formSources[0].formId, "REAL1");
  assert.equal(q.query.formSources[1].formId, "X");
});

test("applyRefRemapToPayload: 該当なし・空 remap は false", () => {
  assert.equal(applyRefRemapToPayload("question", { query: { gui: { formId: "Z" } } }, { a: "b" }), false);
  assert.equal(applyRefRemapToPayload("dashboard", { cards: [] }, {}), false);
});

test("childEntityTypesReferencing: 逆引きで子型を返す", () => {
  assert.deepEqual(childEntityTypesReferencing("form"), ["question"]);
  assert.deepEqual(childEntityTypesReferencing("question"), ["dashboard"]);
  assert.deepEqual(childEntityTypesReferencing("dashboard"), []);
});

test("ENTITY_SCHEMA: 全 ref の targetType が既知のエンティティ型である", () => {
  const known = new Set(Object.keys(ENTITY_SCHEMA));
  for (const type of known) {
    for (const ref of ENTITY_SCHEMA[type].refs) {
      assert.ok(known.has(ref.targetType), `${type} -> ${ref.targetType} は未知の型`);
    }
  }
});

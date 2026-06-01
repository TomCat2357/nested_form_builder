import test from "node:test";
import assert from "node:assert/strict";
import {
  collectReferencedIds,
  collectDependsOnLocalIds,
  applyRefRemapToPayload,
  toUploadPayload,
} from "./uploadQueue.js";

// これらは IndexedDB を触らない純粋関数（参照の収集・依存解決・付け替え・送信用整形）。
// オフラインファースト保存の最も壊れやすいロジックなので独立して検証する。

test("collectReferencedIds: question は gui.formId と formSources[].formId を集める", () => {
  const q = { query: { gui: { formId: "F1" }, formSources: [{ formId: "F2" }, { formId: "F3" }] } };
  assert.deepEqual(collectReferencedIds("question", q).sort(), ["F1", "F2", "F3"]);
});

test("collectReferencedIds: dashboard は cards[].questionId を集める", () => {
  const d = { cards: [{ questionId: "Q1" }, { type: "text" }, { questionId: "Q2" }] };
  assert.deepEqual(collectReferencedIds("dashboard", d).sort(), ["Q1", "Q2"]);
});

test("collectDependsOnLocalIds: local_ 参照だけを依存として返す", () => {
  const q = { query: { gui: { formId: "local_AAA" }, formSources: [{ formId: "RealFileId" }] } };
  assert.deepEqual(collectDependsOnLocalIds("question", q), ["local_AAA"]);
});

test("applyRefRemapToPayload: question の formId 参照を実 ID へ書き換える", () => {
  const q = { query: { gui: { formId: "local_AAA" }, formSources: [{ formId: "local_AAA" }, { formId: "X" }] } };
  const changed = applyRefRemapToPayload("question", q, { local_AAA: "REAL1" });
  assert.equal(changed, true);
  assert.equal(q.query.gui.formId, "REAL1");
  assert.equal(q.query.formSources[0].formId, "REAL1");
  assert.equal(q.query.formSources[1].formId, "X");
});

test("applyRefRemapToPayload: dashboard の questionId 参照を実 ID へ書き換える", () => {
  const d = { cards: [{ questionId: "local_Q" }, { questionId: "keep" }] };
  const changed = applyRefRemapToPayload("dashboard", d, { local_Q: "REALQ" });
  assert.equal(changed, true);
  assert.equal(d.cards[0].questionId, "REALQ");
  assert.equal(d.cards[1].questionId, "keep");
});

test("applyRefRemapToPayload: 該当参照が無ければ false（変更なし）", () => {
  const q = { query: { gui: { formId: "Z" } } };
  assert.equal(applyRefRemapToPayload("question", q, { local_AAA: "REAL1" }), false);
});

test("toUploadPayload: 新規(local_ id)は id を外して送る（GAS に新規ファイルを作らせる）", () => {
  const job = { localId: "local_AAA", payload: { id: "local_AAA", schema: [], pendingUpload: true } };
  const out = toUploadPayload(job);
  assert.equal("id" in out, false);
  assert.equal("pendingUpload" in out, false);
  assert.deepEqual(out.schema, []);
});

test("toUploadPayload: 既存(実 fileId)は id を保持して上書きさせる", () => {
  const job = { localId: "RealFileId", payload: { id: "RealFileId", settings: {}, pendingUpload: true } };
  const out = toUploadPayload(job);
  assert.equal(out.id, "RealFileId");
  assert.equal("pendingUpload" in out, false);
});

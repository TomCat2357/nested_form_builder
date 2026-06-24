import test from "node:test";
import assert from "node:assert/strict";
import {
  collectReferencedIds,
  collectDependsOnLocalIds,
  applyRefRemapToPayload,
  applyRefRemapToOpPayload,
  toUploadPayload,
  getJobLabel,
  getJobReason,
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

// 状態パネル用の表示ヘルパー（純関数）。
test("getJobLabel: form は settings.formTitle、analytics は name を使う", () => {
  assert.equal(getJobLabel({ kind: "save", entityType: "form", payload: { settings: { formTitle: "申請書" } } }), "申請書");
  assert.equal(getJobLabel({ kind: "save", entityType: "question", payload: { name: "月次集計" } }), "月次集計");
  assert.equal(getJobLabel({ kind: "op", entityType: "form", opType: "move", opPayload: { ids: ["a", "b"] } }), "操作: move（2件）");
});

test("getJobReason: 依存待ちは参照先名を、失敗は lastError を出す", () => {
  const dep = { localId: "local_A", kind: "save", entityType: "form", payload: { settings: { formTitle: "親フォーム" } } };
  const jobsById = new Map([["local_A", dep]]);
  const waiting = { status: "pending", dependsOnLocalIds: ["local_A"] };
  assert.equal(getJobReason(waiting, jobsById), "参照先（親フォーム）のアップロード待ち");

  const failed = { status: "error", dependsOnLocalIds: [], lastError: "Form not found", nextAttemptAt: 123 };
  assert.equal(getJobReason(failed, jobsById), "Form not found（自動再試行待ち）");

  assert.equal(getJobReason({ status: "uploading", dependsOnLocalIds: [] }), "送信中…");
  assert.equal(getJobReason({ status: "pending", dependsOnLocalIds: [] }), "待機中（順番待ち）");
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

test("applyRefRemapToOpPayload: move op の formIds / itemIds 内の local_ id を実 ID へ書き換える", () => {
  const move = { formIds: ["local_A", "RealB"], folderPaths: [], destPath: "dst" };
  const changed = applyRefRemapToOpPayload("move", move, { local_A: "REALA" });
  assert.equal(changed, true);
  assert.deepEqual(move.formIds, ["REALA", "RealB"]);

  const moveItems = { itemIds: ["local_Q"], destPath: "" };
  assert.equal(applyRefRemapToOpPayload("move", moveItems, { local_Q: "REALQ" }), true);
  assert.deepEqual(moveItems.itemIds, ["REALQ"]);
});

test("applyRefRemapToOpPayload: archive op の ids を書き換える", () => {
  const op = { ids: ["local_X", "keep"] };
  const changed = applyRefRemapToOpPayload("archive", op, { local_X: "REALX" });
  assert.equal(changed, true);
  assert.deepEqual(op.ids, ["REALX", "keep"]);
});

test("applyRefRemapToOpPayload: 該当 id が無ければ false（変更なし）", () => {
  const op = { ids: ["A", "B"], path: "x/y" };
  assert.equal(applyRefRemapToOpPayload("archive", op, { local_Z: "REALZ" }), false);
  assert.deepEqual(op.ids, ["A", "B"]);
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

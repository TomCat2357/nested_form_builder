import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreviewLiveRow } from "./previewLiveRow.js";

// buildLiveViewRow を注入して、liveEntry の組み立て（id / "No." / createdAt 等）と
// form 引数（{ id: formId, schema }）を検証する。
test("buildPreviewLiveRow: liveEntry と form を正しく組み立てて builder へ渡す", () => {
  const schema = [{ id: "f1", type: "text", label: "氏名", path: "氏名" }];
  let captured = null;
  const fakeBuilder = (form, liveEntry) => {
    captured = { form, liveEntry };
    return { __row: true };
  };
  const out = buildPreviewLiveRow({
    schema,
    settings: { formId: "FORM_X", recordNo: 7, createdAt: "2026-01-01", createdBy: "a", modifiedBy: "b" },
    recordId: "rec_1",
    responses: { f1: "山田" },
    buildLiveRow: fakeBuilder,
  });

  assert.deepEqual(out, { __row: true });
  assert.deepEqual(captured.form, { id: "FORM_X", schema });
  assert.equal(captured.liveEntry.id, "rec_1");
  assert.equal(captured.liveEntry["No."], 7);
  assert.equal(captured.liveEntry.createdAt, "2026-01-01");
  assert.equal(captured.liveEntry.createdBy, "a");
  assert.equal(captured.liveEntry.modifiedBy, "b");
  assert.equal(typeof captured.liveEntry.data, "object");
});

test("buildPreviewLiveRow: formId 未指定なら form.id は空文字", () => {
  let capturedForm = null;
  buildPreviewLiveRow({
    schema: [],
    settings: {},
    recordId: "r",
    responses: null,
    buildLiveRow: (form) => { capturedForm = form; return null; },
  });
  assert.equal(capturedForm.id, "");
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildImportDetail, sanitizeImportedForm, flattenImportedContents } from "./formImportWorkflow.js";

test("buildImportDetail: スキップ/読込失敗の件数を「（…）」に整形、0 件は空", () => {
  assert.equal(buildImportDetail(0, 0), "");
  assert.equal(buildImportDetail(2, 0), "（スキップ 2 件）");
  assert.equal(buildImportDetail(2, 0, { useRegisteredLabel: true }), "（登録済み（リンク済み）スキップ 2 件）");
  assert.equal(buildImportDetail(0, 3), "（読込失敗 3 件）");
  assert.equal(buildImportDetail(2, 3), "（スキップ 2 件、読込失敗 3 件）");
  assert.equal(buildImportDetail(0, 0, { saveFailed: 1 }), "（保存失敗 1 件）");
  assert.equal(
    buildImportDetail(2, 3, { useRegisteredLabel: true, saveFailed: 1 }),
    "（登録済み（リンク済み）スキップ 2 件、読込失敗 3 件、保存失敗 1 件）"
  );
});

test("sanitizeImportedForm: 不正入力は null", () => {
  assert.equal(sanitizeImportedForm(null), null);
  assert.equal(sanitizeImportedForm("x"), null);
  assert.equal(sanitizeImportedForm(42), null);
});

test("sanitizeImportedForm: schema/settings/フラグを正規化、name → formTitle フォールバック", () => {
  const out = sanitizeImportedForm({
    id: "F1",
    name: "タイトル",
    description: 123, // 非文字列 → ""
    schema: [{ id: "q1" }],
    archived: 1,
    readOnly: 0,
    schemaVersion: 2,
  });
  assert.equal(out.id, "F1");
  assert.equal(out.description, "");
  assert.deepEqual(out.schema, [{ id: "q1" }]);
  assert.equal(out.settings.formTitle, "タイトル");
  assert.equal(out.archived, true);
  assert.equal(out.readOnly, false);
  assert.equal(out.schemaVersion, 2);
});

test("sanitizeImportedForm: schema 非配列は []、schemaVersion 非数は 1", () => {
  const out = sanitizeImportedForm({ id: "F2", schema: "bad" });
  assert.deepEqual(out.schema, []);
  assert.equal(out.schemaVersion, 1);
});

test("sanitizeImportedForm: 既存 settings.formTitle は name で上書きしない", () => {
  const out = sanitizeImportedForm({ id: "F3", name: "n", settings: { formTitle: "既存" } });
  assert.equal(out.settings.formTitle, "既存");
});

test("flattenImportedContents: form+fileId が揃う要素のみ採用、欠落は invalidPayloadCount", () => {
  const { list, invalidPayloadCount } = flattenImportedContents([
    { form: { id: "A", schema: [] }, fileId: "fa", fileUrl: "ua" },
    { form: { id: "B", schema: [] } }, // fileId 欠落
    { fileId: "fc" }, // form 欠落
    null,
    "x",
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].fileId, "fa");
  assert.equal(list[0].fileUrl, "ua");
  assert.equal(list[0].form.id, "A");
  assert.equal(invalidPayloadCount, 4);
});

test("flattenImportedContents: 非配列は空結果", () => {
  assert.deepEqual(flattenImportedContents(null), { list: [], invalidPayloadCount: 0 });
  assert.deepEqual(flattenImportedContents(undefined), { list: [], invalidPayloadCount: 0 });
});

test("flattenImportedContents: fileUrl 欠落は null", () => {
  const { list } = flattenImportedContents([{ form: { id: "A" }, fileId: "fa" }]);
  assert.equal(list[0].fileUrl, null);
});

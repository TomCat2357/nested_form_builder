import assert from "node:assert/strict";
import test from "node:test";
import { buildFormIndex, resolveFormRef } from "./formIdentifierResolver.js";

const mkForm = (id, title, createdAt) => ({
  id,
  settings: { formTitle: title },
  createdAtUnixMs: createdAt,
});

test("buildFormIndex は ID とタイトルの双方向引きを構築する", () => {
  const idx = buildFormIndex([
    mkForm("f1", "苦情データ", 1000),
    mkForm("f2", "別フォーム", 2000),
  ]);
  assert.equal(idx.byId.size, 2);
  assert.equal(idx.byTitle.size, 2);
  assert.equal(idx.byTitle.get("苦情データ").id, "f1");
});

test("buildFormIndex は同名フォームでは createdAt が最古のものを優先する", () => {
  const idx = buildFormIndex([
    mkForm("f_new", "Foo", 5000),
    mkForm("f_old", "Foo", 1000),
  ]);
  assert.equal(idx.byTitle.get("Foo").id, "f_old");
});

test("resolveFormRef はタイトル優先、ID フォールバックする", () => {
  const idx = buildFormIndex([mkForm("f1", "苦情データ", 1000)]);
  assert.equal(resolveFormRef("苦情データ", idx).id, "f1");
  assert.equal(resolveFormRef("f1", idx).id, "f1");
  assert.equal(resolveFormRef("unknown", idx), null);
});

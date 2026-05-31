import assert from "node:assert/strict";
import test from "node:test";
import { buildFormIndex, resolveFormRef, formQualifiedName, isAmbiguousBareTitle } from "./formIdentifierResolver.js";

const mkForm = (id, title, createdAt) => ({
  id,
  settings: { formTitle: title },
  createdAtUnixMs: createdAt,
});

const mkFormF = (id, title, folder, createdAt) => ({
  id,
  settings: { formTitle: title },
  folder,
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

test("formQualifiedName はフォルダ込み名を返す（フォルダ無しは葉名のみ）", () => {
  assert.equal(formQualifiedName(mkFormF("f1", "苦情データ", "受付/2024", 1)), "受付/2024/苦情データ");
  assert.equal(formQualifiedName(mkFormF("f2", "単独", "", 1)), "単独");
  assert.equal(formQualifiedName(null), "");
});

test("resolveFormRef はフォルダ込み名をパス厳密一致で解決する", () => {
  const idx = buildFormIndex([
    mkFormF("fa", "苦情データ", "受付", 1),
    mkFormF("fb", "苦情データ", "営業", 2),
  ]);
  assert.equal(resolveFormRef("受付/苦情データ", idx).id, "fa");
  assert.equal(resolveFormRef("営業/苦情データ", idx).id, "fb");
  assert.equal(resolveFormRef("無い/苦情データ", idx), null);
});

test("resolveFormRef は同名バレ名を曖昧として解決しない（フォルダ込み指定を促す）", () => {
  const idx = buildFormIndex([
    mkFormF("fa", "苦情データ", "受付", 1),
    mkFormF("fb", "苦情データ", "営業", 2),
  ]);
  assert.equal(resolveFormRef("苦情データ", idx), null);
  assert.equal(isAmbiguousBareTitle("苦情データ", idx), true);
});

test("resolveFormRef は一意のバレ名を従来どおり解決し、id フォールバックも残す", () => {
  const idx = buildFormIndex([mkFormF("fa", "単独フォーム", "受付", 1)]);
  assert.equal(resolveFormRef("単独フォーム", idx).id, "fa");
  assert.equal(resolveFormRef("fa", idx).id, "fa");
  assert.equal(isAmbiguousBareTitle("単独フォーム", idx), false);
});

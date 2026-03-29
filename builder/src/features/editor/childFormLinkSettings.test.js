import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHiddenCurrentChildFormOption,
  extractChildFormIdFromInput,
  getChildFormOptionLabel,
  getVisibleChildFormOptions,
  resolveChildFormPasteInput,
} from "./childFormLinkSettings.js";
import { buildSharedFormUrl } from "../../utils/formShareUrl.js";

const allForms = [
  { id: "f_01JTESTACTIVE_abc123", archived: false, settings: { formTitle: "公開フォーム" } },
  { id: "f_01JTESTARCHIVE_xyz987", archived: true, settings: { formTitle: "アーカイブ済みフォーム" } },
];

test("archivedフォームのアプリURLからform_xxxを抽出できる", () => {
  const input = "https://example.com/search?form=f_01JTESTARCHIVE_abc123";
  assert.equal(extractChildFormIdFromInput(input), "f_01JTESTARCHIVE_abc123");
});

test("管理画面コピー相当のURLを生成してform_xxxを抽出できる", () => {
  const url = buildSharedFormUrl("https://example.com/search", "f_01JTESTACTIVE_abc123");
  assert.equal(url, "https://example.com/search?form=f_01JTESTACTIVE_abc123");
  assert.equal(extractChildFormIdFromInput(url), "f_01JTESTACTIVE_abc123");
});

test("実在する未アーカイブフォームURLは一致扱いになる", () => {
  const url = buildSharedFormUrl("https://example.com/search", "f_01JTESTACTIVE_abc123");
  assert.deepEqual(resolveChildFormPasteInput(url, allForms), {
    status: "matched",
    formId: "f_01JTESTACTIVE_abc123",
    form: allForms[0],
    label: "公開フォーム",
  });
});

test("実在するフォームID直貼りも一致扱いになる", () => {
  assert.deepEqual(resolveChildFormPasteInput("f_01JTESTACTIVE_abc123", allForms), {
    status: "matched",
    formId: "f_01JTESTACTIVE_abc123",
    form: allForms[0],
    label: "公開フォーム",
  });
});

test("実在するアーカイブ済みフォームURLも一致扱いになる", () => {
  const url = buildSharedFormUrl("https://example.com/search", "f_01JTESTARCHIVE_xyz987");
  assert.deepEqual(resolveChildFormPasteInput(url, allForms), {
    status: "matched",
    formId: "f_01JTESTARCHIVE_xyz987",
    form: allForms[1],
    label: "アーカイブ済みフォーム",
  });
});

test("存在しないURLやIDはnot_foundになる", () => {
  assert.deepEqual(resolveChildFormPasteInput("https://example.com/search?form=f_01JTESTMISSING_nope", allForms), {
    status: "not_found",
    formId: "f_01JTESTMISSING_nope",
    form: null,
    label: "",
  });
  assert.deepEqual(resolveChildFormPasteInput("invalid-value", allForms), {
    status: "not_found",
    formId: "invalid-value",
    form: null,
    label: "",
  });
});

test("空入力はemptyになる", () => {
  assert.deepEqual(resolveChildFormPasteInput("   ", allForms), {
    status: "empty",
    formId: "",
    form: null,
    label: "",
  });
});

test("childFormIdがarchived候補外でも現在値保持用の隠しoptionを返す", () => {
  const visibleForms = getVisibleChildFormOptions(allForms);

  assert.deepEqual(
    visibleForms.map((form) => form.id),
    ["f_01JTESTACTIVE_abc123"],
  );
  assert.deepEqual(
    buildHiddenCurrentChildFormOption("f_01JTESTARCHIVE_xyz987", visibleForms, allForms),
    {
      id: "f_01JTESTARCHIVE_xyz987",
      label: "アーカイブ済みフォーム",
    },
  );
});

test("表示候補にあるchildFormIdには隠しoptionを追加しない", () => {
  const visibleForms = getVisibleChildFormOptions(allForms);

  assert.equal(buildHiddenCurrentChildFormOption("f_01JTESTACTIVE_abc123", visibleForms), null);
});

test("フォーム表示名はsettings.formTitleを優先する", () => {
  assert.equal(getChildFormOptionLabel(allForms[0]), "公開フォーム");
});

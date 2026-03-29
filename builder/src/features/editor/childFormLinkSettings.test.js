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
  { id: "form_active001", archived: false, settings: { formTitle: "公開フォーム" } },
  { id: "form_archived999", archived: true, settings: { formTitle: "アーカイブ済みフォーム" } },
];

test("archivedフォームのアプリURLからform_xxxを抽出できる", () => {
  const input = "https://example.com/search?form=form_archived123";
  assert.equal(extractChildFormIdFromInput(input), "form_archived123");
});

test("管理画面コピー相当のURLを生成してform_xxxを抽出できる", () => {
  const url = buildSharedFormUrl("https://example.com/search", "form_active001");
  assert.equal(url, "https://example.com/search?form=form_active001");
  assert.equal(extractChildFormIdFromInput(url), "form_active001");
});

test("実在する未アーカイブフォームURLは一致扱いになる", () => {
  const url = buildSharedFormUrl("https://example.com/search", "form_active001");
  assert.deepEqual(resolveChildFormPasteInput(url, allForms), {
    status: "matched",
    formId: "form_active001",
    form: allForms[0],
    label: "公開フォーム",
  });
});

test("実在するアーカイブ済みフォームURLも一致扱いになる", () => {
  const url = buildSharedFormUrl("https://example.com/search", "form_archived999");
  assert.deepEqual(resolveChildFormPasteInput(url, allForms), {
    status: "matched",
    formId: "form_archived999",
    form: allForms[1],
    label: "アーカイブ済みフォーム",
  });
});

test("存在しないURLやIDはnot_foundになる", () => {
  assert.deepEqual(resolveChildFormPasteInput("https://example.com/search?form=form_missing001", allForms), {
    status: "not_found",
    formId: "form_missing001",
    form: null,
    label: "",
  });
  assert.deepEqual(resolveChildFormPasteInput("invalid-value", allForms), {
    status: "not_found",
    formId: "",
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
    ["form_active001"],
  );
  assert.deepEqual(
    buildHiddenCurrentChildFormOption("form_archived999", visibleForms, allForms),
    {
      id: "form_archived999",
      label: "アーカイブ済みフォーム",
    },
  );
});

test("表示候補にあるchildFormIdには隠しoptionを追加しない", () => {
  const visibleForms = getVisibleChildFormOptions(allForms);

  assert.equal(buildHiddenCurrentChildFormOption("form_active001", visibleForms), null);
});

test("フォーム表示名はsettings.formTitleを優先する", () => {
  assert.equal(getChildFormOptionLabel(allForms[0]), "公開フォーム");
});

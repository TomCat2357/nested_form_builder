import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHiddenCurrentChildFormOption,
  extractChildFormIdFromInput,
  getVisibleChildFormOptions,
} from "./childFormLinkSettings.js";

test("archivedフォームのアプリURLからform_xxxを抽出できる", () => {
  const input = "https://example.com/search?form=form_archived123";
  assert.equal(extractChildFormIdFromInput(input), "form_archived123");
});

test("childFormIdがarchived候補外でも現在値保持用の隠しoptionを返す", () => {
  const visibleForms = getVisibleChildFormOptions([
    { id: "form_active001", archived: false },
    { id: "form_archived999", archived: true },
  ]);

  assert.deepEqual(
    visibleForms.map((form) => form.id),
    ["form_active001"],
  );
  assert.deepEqual(
    buildHiddenCurrentChildFormOption("form_archived999", visibleForms),
    {
      id: "form_archived999",
      label: "form_archived999",
    },
  );
});

test("表示候補にあるchildFormIdには隠しoptionを追加しない", () => {
  const visibleForms = getVisibleChildFormOptions([
    { id: "form_active001", archived: false },
    { id: "form_archived999", archived: true },
  ]);

  assert.equal(buildHiddenCurrentChildFormOption("form_active001", visibleForms), null);
});

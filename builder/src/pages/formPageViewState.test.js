import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveFormPageBadge,
  resolveUnsavedConfirmMessage,
  buildPreviewSettings,
} from "./formPageViewState.js";

test("resolveFormPageBadge: 読み取り中が最優先（loading）", () => {
  const badge = resolveFormPageBadge({ loading: true, isReloading: false, isFormReadOnly: true, isViewMode: true });
  assert.deepEqual(badge, { label: "読み取り中...", variant: "loading" });
});

test("resolveFormPageBadge: 読み取り中が最優先（isReloading）", () => {
  const badge = resolveFormPageBadge({ loading: false, isReloading: true, isFormReadOnly: false, isViewMode: false });
  assert.deepEqual(badge, { label: "読み取り中...", variant: "loading" });
});

test("resolveFormPageBadge: 参照のみは閲覧/編集より優先", () => {
  const badge = resolveFormPageBadge({ loading: false, isReloading: false, isFormReadOnly: true, isViewMode: false });
  assert.deepEqual(badge, { label: "参照のみ", variant: "view" });
});

test("resolveFormPageBadge: 閲覧モード", () => {
  const badge = resolveFormPageBadge({ loading: false, isReloading: false, isFormReadOnly: false, isViewMode: true });
  assert.deepEqual(badge, { label: "閲覧モード", variant: "view" });
});

test("resolveFormPageBadge: 編集モード（デフォルト）", () => {
  const badge = resolveFormPageBadge({ loading: false, isReloading: false, isFormReadOnly: false, isViewMode: false });
  assert.deepEqual(badge, { label: "編集モード", variant: "edit" });
});

test("resolveUnsavedConfirmMessage: cancel-edit", () => {
  assert.equal(resolveUnsavedConfirmMessage("cancel-edit"), "保存せずに編集内容を破棄しますか？");
});

test("resolveUnsavedConfirmMessage: navigate: 接頭辞", () => {
  assert.equal(resolveUnsavedConfirmMessage("navigate:abc123"), "保存せずに移動しますか？");
});

test("resolveUnsavedConfirmMessage: back / cancel / null はデフォルト文言", () => {
  assert.equal(resolveUnsavedConfirmMessage("back"), "保存せずに前の画面へ戻りますか？");
  assert.equal(resolveUnsavedConfirmMessage(null), "保存せずに前の画面へ戻りますか？");
  assert.equal(resolveUnsavedConfirmMessage(undefined), "保存せずに前の画面へ戻りますか？");
});

test("buildPreviewSettings: form.settings を展開しつつ識別子・ユーザー情報を上書き合成", () => {
  const settings = buildPreviewSettings({
    form: { id: "F1", settings: { theme: "dark", formTitle: "T", recordId: "should-be-overwritten" }, driveFileUrl: "https://x" },
    currentRecordId: "R9",
    recordNoInput: "0042",
    entry: { pid: "P1", modifiedAt: "2026-01-01", modifiedAtUnixMs: 123 },
    userName: "name",
    userEmail: "e@x",
    userAffiliation: "aff",
    userTitle: "title",
    userPhone: "090",
  });
  assert.equal(settings.theme, "dark");
  assert.equal(settings.formTitle, "T");
  assert.equal(settings.formId, "F1");
  assert.equal(settings.recordId, "R9");
  assert.equal(settings.recordNo, "0042");
  assert.equal(settings.pid, "P1");
  assert.equal(settings.modifiedAt, "2026-01-01");
  assert.equal(settings.modifiedAtUnixMs, 123);
  assert.equal(settings.driveFileUrl, "https://x");
  assert.equal(settings.userName, "name");
  assert.equal(settings.userEmail, "e@x");
  assert.equal(settings.userAffiliation, "aff");
  assert.equal(settings.userTitle, "title");
  assert.equal(settings.userPhone, "090");
});

test("buildPreviewSettings: 空の entry/form でも安全なデフォルト", () => {
  const settings = buildPreviewSettings({
    form: { id: "F1" },
    currentRecordId: null,
    recordNoInput: "",
    entry: null,
    userName: "",
    userEmail: "",
    userAffiliation: "",
    userTitle: "",
    userPhone: "",
  });
  assert.equal(settings.pid, "");
  assert.equal(settings.driveFileUrl, "");
  assert.equal(settings.modifiedAt, undefined);
  assert.equal(settings.recordId, null);
});

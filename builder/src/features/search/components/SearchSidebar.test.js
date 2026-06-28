import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchSidebarButtons, resolveChildStorageMeta } from "./SearchSidebar.buttons.js";

const noop = () => {};

test("buildSearchSidebarButtons は指定順でボタンを返す", () => {
  const buttons = buildSearchSidebarButtons({
    onBack: noop,
    showBack: true,
    onCreate: noop,
    onConfig: noop,
    onDelete: noop,
    onUndelete: noop,
    onPrint: noop,
    onRefresh: noop,
    onExport: noop,
    useCache: false,
    refreshBusy: false,
    refreshDisabled: false,
    exporting: false,
    selectedCount: 2,
    filteredCount: 10,
    isUndoDelete: false,
    printing: false,
  });

  assert.deepEqual(
    buttons.map((button) => button.label),
    ["← 戻る", "新規入力", "削除", "🔄 更新", "検索結果を出力", "印刷様式を出力", "設定"],
  );
});

test("buildSearchSidebarButtons は削除取消しでも並び位置を維持し、非表示ボタンを除外する", () => {
  const buttons = buildSearchSidebarButtons({
    onBack: noop,
    showBack: false,
    onCreate: noop,
    onConfig: null,
    onDelete: noop,
    onUndelete: noop,
    onPrint: noop,
    onRefresh: noop,
    onExport: noop,
    useCache: true,
    refreshBusy: false,
    refreshDisabled: false,
    exporting: false,
    selectedCount: 1,
    filteredCount: 3,
    isUndoDelete: true,
    printing: false,
  });

  assert.deepEqual(
    buttons.map((button) => button.label),
    ["新規入力", "削除取消し", "🔄 更新", "検索結果を出力", "印刷様式を出力"],
  );
});

test("resolveChildStorageMeta: sensitiveAllowed + resolver で子 SS / シート名を解決する（既存子レコードの有無に非依存）", async () => {
  const resolver = async () => ({ childSpreadsheetId: "CHILD_SS", childSheetName: "従事者" });
  const meta = await resolveChildStorageMeta({
    sensitiveAllowed: true,
    searchChildStorageMetaResolver: resolver,
  });
  assert.deepEqual(meta, { childSpreadsheetId: "CHILD_SS", childSheetName: "従事者" });
});

test("resolveChildStorageMeta: 非 admin（sensitiveAllowed=false）では resolver を呼ばず空メタ", async () => {
  let called = false;
  const meta = await resolveChildStorageMeta({
    sensitiveAllowed: false,
    searchChildStorageMetaResolver: async () => { called = true; return { childSpreadsheetId: "LEAK", childSheetName: "Data" }; },
  });
  assert.deepEqual(meta, { childSpreadsheetId: "", childSheetName: "" });
  assert.equal(called, false);
});

test("resolveChildStorageMeta: resolver が空/失敗/未提供なら空メタ（list フォールバックは廃止）", async () => {
  const empty = await resolveChildStorageMeta({
    sensitiveAllowed: true,
    searchChildStorageMetaResolver: async () => ({ childSpreadsheetId: "", childSheetName: "" }),
  });
  assert.deepEqual(empty, { childSpreadsheetId: "", childSheetName: "" });

  const threw = await resolveChildStorageMeta({
    sensitiveAllowed: true,
    searchChildStorageMetaResolver: async () => { throw new Error("boom"); },
  });
  assert.deepEqual(threw, { childSpreadsheetId: "", childSheetName: "" });

  const none = await resolveChildStorageMeta({
    sensitiveAllowed: true,
    searchChildStorageMetaResolver: null,
  });
  assert.deepEqual(none, { childSpreadsheetId: "", childSheetName: "" });
});

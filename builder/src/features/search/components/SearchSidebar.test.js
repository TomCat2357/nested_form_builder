import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchSidebarButtons } from "./SearchSidebar.buttons.js";

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
    ["← 戻る", "新規入力", "削除", "🔄 更新", "検索結果を出力", "印刷フォームを作成", "設定"],
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
    ["新規入力", "削除取消し", "🔄 更新", "検索結果を出力", "印刷フォームを作成"],
  );
});

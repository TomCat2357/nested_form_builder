import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchSidebarButtons, stripChildSpreadsheetIds } from "./SearchSidebar.buttons.js";

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

test("stripChildSpreadsheetIds は childSpreadsheetId / childSheetName を各子オブジェクトから除去する", () => {
  const childFormsByRow = [
    [{ fieldPath: "a", childFormName: "従事者情報", childSpreadsheetId: "CHILD1", childSheetName: "従事者", values: { x: 1 } }],
    [],
    [{ fieldPath: "b", childSpreadsheetId: "CHILD2", childSheetName: "Data" }, { fieldPath: "c" }],
  ];
  const stripped = stripChildSpreadsheetIds(childFormsByRow);
  // childSpreadsheetId / childSheetName は消えるが他のフィールドは保持される。
  assert.equal("childSpreadsheetId" in stripped[0][0], false);
  assert.equal("childSheetName" in stripped[0][0], false);
  assert.equal(stripped[0][0].childFormName, "従事者情報");
  assert.deepEqual(stripped[0][0].values, { x: 1 });
  assert.equal("childSpreadsheetId" in stripped[2][0], false);
  assert.equal("childSheetName" in stripped[2][0], false);
  assert.equal(stripped[2][0].fieldPath, "b");
  // 元データは破壊しない（非変異）。
  assert.equal(childFormsByRow[0][0].childSpreadsheetId, "CHILD1");
  assert.equal(childFormsByRow[0][0].childSheetName, "従事者");
});

test("stripChildSpreadsheetIds は配列以外・null を素通しする", () => {
  assert.equal(stripChildSpreadsheetIds(null), null);
  assert.equal(stripChildSpreadsheetIds(undefined), undefined);
});

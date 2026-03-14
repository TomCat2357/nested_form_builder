const assert = require("node:assert/strict");
const test = require("node:test");
const { Sync_fillEmptySheetCellsFromRecord_, Sync_isBlankCellValue_ } = require("../gas/syncRecordsMerge.js");

test("Sync_isBlankCellValue_ は空文字/null/undefined のみ空扱いにする", () => {
  assert.equal(Sync_isBlankCellValue_(""), true);
  assert.equal(Sync_isBlankCellValue_(null), true);
  assert.equal(Sync_isBlankCellValue_(undefined), true);
  assert.equal(Sync_isBlankCellValue_(0), false);
  assert.equal(Sync_isBlankCellValue_(false), false);
});

test("Sync_fillEmptySheetCellsFromRecord_ は同値時に空セルだけ補完する", () => {
  const rowData = ["rec_1", 1, 1000, 2000, "", "", "", "", "", "existing"];
  const rowFormats = new Array(rowData.length).fill("General");

  const changed = Sync_fillEmptySheetCellsFromRecord_({
    rowData,
    rowFormats,
    order: ["id", "No.", "createdAt", "modifiedAt", "field_a", "field_b"],
    keyToColumn: { id: 1, "No.": 2, createdAt: 3, modifiedAt: 4, field_a: 9, field_b: 10 },
    normalizedRecordData: { field_a: "cache-value", field_b: "cache-should-not-win" },
    normalizeCell: (value) => ({ value, numberFormat: "@" }),
    reservedKeys: { id: true, "No.": true, createdAt: true, modifiedAt: true },
  });

  assert.equal(changed, true);
  assert.equal(rowData[8], "cache-value");
  assert.equal(rowData[9], "existing");
  assert.equal(rowFormats[8], "@");
});

test("Sync_fillEmptySheetCellsFromRecord_ はキャッシュ側が空なら補完しない", () => {
  const rowData = ["rec_1", 1, 1000, 2000, "", "", "", "", "", ""];
  const rowFormats = new Array(rowData.length).fill("General");

  const changed = Sync_fillEmptySheetCellsFromRecord_({
    rowData,
    rowFormats,
    order: ["field_a"],
    keyToColumn: { field_a: 9 },
    normalizedRecordData: { field_a: "" },
    normalizeCell: (value) => ({ value, numberFormat: "@" }),
  });

  assert.equal(changed, false);
  assert.equal(rowData[8], "");
});

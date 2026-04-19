const assert = require("node:assert/strict");
const test = require("node:test");
const {
  Sync_shouldApplyRecordToSheet_,
  Sync_fillEmptySheetCellsFromRecord_,
  Sync_syncFixedMetaColumnsFromRecord_,
  Sync_isBlankCellValue_,
  Sync_resolveNewRecordMetadata_,
} = require("../gas/syncRecordsMerge.js");

test("Sync_isBlankCellValue_ は空文字/null/undefined のみ空扱いにする", () => {
  assert.equal(Sync_isBlankCellValue_(""), true);
  assert.equal(Sync_isBlankCellValue_(null), true);
  assert.equal(Sync_isBlankCellValue_(undefined), true);
  assert.equal(Sync_isBlankCellValue_(0), false);
  assert.equal(Sync_isBlankCellValue_(false), false);
});

test("Sync_shouldApplyRecordToSheet_ は modifiedAt が新しい場合のみキャッシュを適用する", () => {
  assert.equal(Sync_shouldApplyRecordToSheet_({ hasSheetRow: false, cacheModifiedAt: 0, sheetModifiedAt: 0 }), true);
  assert.equal(Sync_shouldApplyRecordToSheet_({ hasSheetRow: true, cacheModifiedAt: 1700000000200, sheetModifiedAt: 0 }), true);
  assert.equal(Sync_shouldApplyRecordToSheet_({ hasSheetRow: true, cacheModifiedAt: 1700000000200, sheetModifiedAt: 1700000000100 }), true);
  assert.equal(Sync_shouldApplyRecordToSheet_({ hasSheetRow: true, cacheModifiedAt: 1700000000200, sheetModifiedAt: 1700000000200 }), false);
  assert.equal(Sync_shouldApplyRecordToSheet_({ hasSheetRow: true, cacheModifiedAt: 1700000000100, sheetModifiedAt: 1700000000200 }), false);
});

test("Sync_fillEmptySheetCellsFromRecord_ は同値時に空セルだけ補完する", () => {
  const rowData = ["rec_1", "", 1, 1000, 2000, "", "", "", "", "", "", "existing"];
  const rowFormats = new Array(rowData.length).fill("General");

  const changed = Sync_fillEmptySheetCellsFromRecord_({
    rowData,
    rowFormats,
    order: ["id", "No.", "createdAt", "modifiedAt", "field_a", "field_b"],
    keyToColumn: { id: 1, "No.": 3, createdAt: 4, modifiedAt: 5, field_a: 11, field_b: 12 },
    normalizedRecordData: { field_a: "cache-value", field_b: "cache-should-not-win" },
    normalizeCell: (value) => ({ value, numberFormat: "@" }),
    reservedKeys: { id: true, "No.": true, createdAt: true, modifiedAt: true },
  });

  assert.equal(changed, true);
  assert.equal(rowData[10], "cache-value");
  assert.equal(rowData[11], "existing");
  assert.equal(rowFormats[10], "@");
});

test("Sync_fillEmptySheetCellsFromRecord_ はキャッシュ側が空なら補完しない", () => {
  const rowData = ["rec_1", "", 1, 1000, 2000, "", "", "", "", "", "", ""];
  const rowFormats = new Array(rowData.length).fill("General");

  const changed = Sync_fillEmptySheetCellsFromRecord_({
    rowData,
    rowFormats,
    order: ["field_a"],
    keyToColumn: { field_a: 11 },
    normalizedRecordData: { field_a: "" },
    normalizeCell: (value) => ({ value, numberFormat: "@" }),
  });

  assert.equal(changed, false);
  assert.equal(rowData[10], "");
});

test("Sync_syncFixedMetaColumnsFromRecord_ は同値時に固定メタ列の空セルだけ補完する", () => {
  const rowData = ["rec_1", "", "", 2000, "", "", "", "", "", ""];
  const rowFormats = new Array(rowData.length).fill("General");

  const changed = Sync_syncFixedMetaColumnsFromRecord_({
    rowData,
    rowFormats,
    record: {
      "No.": "12",
      createdAtUnixMs: 1700000000123,
      deletedAtUnixMs: 1700000000999,
      createdBy: "creator@example.com",
      modifiedBy: "modifier@example.com",
      deletedBy: "deleter@example.com",
      driveFolderUrl: "https://drive.google.com/drive/folders/folder_a",
    },
    mode: "fillBlank",
  });

  assert.equal(changed, true);
  assert.equal(rowData[1], 12);
  assert.equal(rowData[2], 1700000000123);
  assert.equal(rowData[3], 2000);
  assert.equal(rowData[4], 1700000000999);
  assert.equal(rowData[5], "creator@example.com");
  assert.equal(rowData[6], "modifier@example.com");
  assert.equal(rowData[7], "deleter@example.com");
  assert.equal(rowData[8], "https://drive.google.com/drive/folders/folder_a");
  assert.equal(rowFormats[1], "0");
  assert.equal(rowFormats[2], "0");
  assert.equal(rowFormats[4], "0");
});

test("Sync_syncFixedMetaColumnsFromRecord_ は同値時に既存の固定メタ列を上書きしない", () => {
  const rowData = [
    "rec_1",
    3,
    1700000000001,
    1700000000002,
    1700000000003,
    "existing-creator@example.com",
    "existing-modifier@example.com",
    "existing-deleter@example.com",
    "https://drive.google.com/drive/folders/existing",
    "",
    "",
  ];
  const rowFormats = new Array(rowData.length).fill("General");
  rowFormats[1] = "0";
  rowFormats[2] = "0";
  rowFormats[4] = "0";

  const changed = Sync_syncFixedMetaColumnsFromRecord_({
    rowData,
    rowFormats,
    record: {
      "No.": "12",
      createdAtUnixMs: 1700000000123,
      deletedAtUnixMs: 1700000000999,
      createdBy: "creator@example.com",
      modifiedBy: "modifier@example.com",
      deletedBy: "deleter@example.com",
      driveFolderUrl: "https://drive.google.com/drive/folders/cache",
    },
    mode: "fillBlank",
  });

  assert.equal(changed, false);
  assert.equal(rowData[1], 3);
  assert.equal(rowData[2], 1700000000001);
  assert.equal(rowData[4], 1700000000003);
  assert.equal(rowData[5], "existing-creator@example.com");
  assert.equal(rowData[6], "existing-modifier@example.com");
  assert.equal(rowData[7], "existing-deleter@example.com");
  assert.equal(rowData[8], "https://drive.google.com/drive/folders/existing");
});

test("Sync_syncFixedMetaColumnsFromRecord_ は同値時にキャッシュ側が空の固定メタ列を補完しない", () => {
  const rowData = ["rec_1", "", "", 2000, "", "", "", "", "", ""];
  const rowFormats = new Array(rowData.length).fill("General");

  const changed = Sync_syncFixedMetaColumnsFromRecord_({
    rowData,
    rowFormats,
    record: {
      "No.": "12",
      createdAtUnixMs: 1700000000123,
      deletedAt: "",
      createdBy: "creator@example.com",
      modifiedBy: "",
      deletedBy: "",
      driveFolderUrl: "",
    },
    mode: "fillBlank",
  });

  assert.equal(changed, true);
  assert.equal(rowData[1], 12);
  assert.equal(rowData[2], 1700000000123);
  assert.equal(rowData[4], "");
  assert.equal(rowData[5], "creator@example.com");
  assert.equal(rowData[6], "");
  assert.equal(rowData[7], "");
  assert.equal(rowData[8], "");
});

test("Sync_syncFixedMetaColumnsFromRecord_ は modifiedAt が空欄または古い場合に固定メタ列をキャッシュで上書きする", () => {
  const rowData = [
    "rec_1",
    3,
    1700000000001,
    1700000000002,
    1700000000003,
    "sheet-creator@example.com",
    "sheet-modifier@example.com",
    "sheet-deleter@example.com",
    "https://drive.google.com/drive/folders/sheet",
    "",
    "",
  ];
  const rowFormats = new Array(rowData.length).fill("General");

  const changed = Sync_syncFixedMetaColumnsFromRecord_({
    rowData,
    rowFormats,
    record: {
      "No.": "12",
      createdAtUnixMs: 1700000000123,
      modifiedAtUnixMs: 1700000000999,
      deletedAtUnixMs: 1700000000888,
      createdBy: "creator@example.com",
      modifiedBy: "cache-modifier@example.com",
      deletedBy: "cache-deleter@example.com",
      driveFolderUrl: "https://drive.google.com/drive/folders/cache",
    },
    mode: "overwrite",
  });

  assert.equal(changed, true);
  assert.equal(rowData[1], 12);
  assert.equal(rowData[2], 1700000000123);
  assert.equal(rowData[3], 1700000000999);
  assert.equal(rowData[4], 1700000000888);
  assert.equal(rowData[5], "creator@example.com");
  assert.equal(rowData[6], "cache-modifier@example.com");
  assert.equal(rowData[7], "cache-deleter@example.com");
  assert.equal(rowData[8], "https://drive.google.com/drive/folders/cache");
  assert.equal(rowFormats[1], "0");
  assert.equal(rowFormats[2], "0");
  assert.equal(rowFormats[3], "0");
  assert.equal(rowFormats[4], "0");
});

test("Sync_syncFixedMetaColumnsFromRecord_ は overwrite 時に deletedAt と deletedBy をキャッシュどおり空欄へ戻す", () => {
  const rowData = [
    "rec_1",
    3,
    1700000000001,
    1700000000002,
    1700000000003,
    "sheet-creator@example.com",
    "sheet-modifier@example.com",
    "sheet-deleter@example.com",
    "https://drive.google.com/drive/folders/sheet",
    "",
    "",
  ];
  const rowFormats = new Array(rowData.length).fill("General");

  const changed = Sync_syncFixedMetaColumnsFromRecord_({
    rowData,
    rowFormats,
    record: {
      "No.": "",
      createdAt: "",
      modifiedAt: "",
      deletedAt: "",
      createdBy: "",
      modifiedBy: "cache-modifier@example.com",
      deletedBy: "",
      driveFolderUrl: "",
    },
    mode: "overwrite",
  });

  assert.equal(changed, true);
  assert.equal(rowData[1], "");
  assert.equal(rowData[2], "");
  assert.equal(rowData[3], "");
  assert.equal(rowData[4], "");
  assert.equal(rowData[5], "");
  assert.equal(rowData[6], "cache-modifier@example.com");
  assert.equal(rowData[7], "");
  assert.equal(rowData[8], "");
});

test("Sync_syncFixedMetaColumnsFromRecord_ は fixedColMap 指定時に動的な列位置を使う", () => {
  // driveFolderUrl を末尾列(index 20)、他の固定メタは既定位置にマップ
  const rowData = new Array(21).fill("");
  rowData[0] = "rec_1";
  const rowFormats = new Array(21).fill("General");

  const changed = Sync_syncFixedMetaColumnsFromRecord_({
    rowData,
    rowFormats,
    record: {
      "No.": "5",
      createdAtUnixMs: 1700000000100,
      modifiedAtUnixMs: 1700000000200,
      createdBy: "a@example.com",
      modifiedBy: "b@example.com",
      driveFolderUrl: "https://drive.google.com/drive/folders/xyz",
    },
    mode: "overwrite",
    fixedColMap: {
      id: 0, "No.": 1, createdAt: 2, modifiedAt: 3, deletedAt: 4,
      createdBy: 5, modifiedBy: 6, deletedBy: 7, driveFolderUrl: 20,
    },
  });

  assert.equal(changed, true);
  assert.equal(rowData[8], ""); // 旧既定位置は書かれない
  assert.equal(rowData[20], "https://drive.google.com/drive/folders/xyz");
});

test("Sync_syncFixedMetaColumnsFromRecord_ は fixedColMap に driveFolderUrl が無いとき書き込まない", () => {
  // driveFolderUrl 列を持たない古いシート想定
  const rowData = new Array(15).fill("");
  rowData[0] = "rec_1";
  const rowFormats = new Array(15).fill("General");

  const changed = Sync_syncFixedMetaColumnsFromRecord_({
    rowData,
    rowFormats,
    record: {
      "No.": "5",
      createdAtUnixMs: 1700000000100,
      modifiedAtUnixMs: 1700000000200,
      createdBy: "a@example.com",
      modifiedBy: "b@example.com",
      driveFolderUrl: "https://drive.google.com/drive/folders/xyz",
    },
    mode: "overwrite",
    fixedColMap: {
      id: 0, "No.": 1, createdAt: 2, modifiedAt: 3, deletedAt: 4,
      createdBy: 5, modifiedBy: 6, deletedBy: 7,
      // driveFolderUrl なし
    },
  });

  assert.equal(changed, true);
  assert.equal(rowData[1], 5);
  assert.equal(rowData[5], "a@example.com");
  // driveFolderUrl はどの列にも書かれない
  for (var i = 0; i < rowData.length; i++) {
    assert.notEqual(rowData[i], "https://drive.google.com/drive/folders/xyz");
  }
});

test("Sync_resolveNewRecordMetadata_ はキャッシュの No. / createdAt / createdBy を優先する", () => {
  const metadata = Sync_resolveNewRecordMetadata_({
    record: {
      "No.": "12",
      createdAtUnixMs: 1700000000123,
      createdBy: "creator@example.com",
    },
    fallbackRecordNo: 3,
    fallbackCreatedAt: 1700000000999,
    fallbackCreatedBy: "fallback@example.com",
  });

  assert.deepEqual(metadata, {
    recordNo: 12,
    createdAt: 1700000000123,
    createdBy: "creator@example.com",
  });
});

test("Sync_resolveNewRecordMetadata_ は未指定時にフォールバック値を使う", () => {
  const metadata = Sync_resolveNewRecordMetadata_({
    record: {},
    fallbackRecordNo: 4,
    fallbackCreatedAt: 1700000000456,
    fallbackCreatedBy: "fallback@example.com",
    toUnixMs: () => null,
  });

  assert.deepEqual(metadata, {
    recordNo: 4,
    createdAt: 1700000000456,
    createdBy: "fallback@example.com",
  });
});

test("Sync_resolveNewRecordMetadata_ は createdBy が空文字でもそのまま保持する", () => {
  const metadata = Sync_resolveNewRecordMetadata_({
    record: {
      createdBy: "",
    },
    fallbackRecordNo: 7,
    fallbackCreatedAt: 1700000000555,
    fallbackCreatedBy: "fallback@example.com",
    toUnixMs: () => null,
  });

  assert.deepEqual(metadata, {
    recordNo: 7,
    createdAt: 1700000000555,
    createdBy: "",
  });
});

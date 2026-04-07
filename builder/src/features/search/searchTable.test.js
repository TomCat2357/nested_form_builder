import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExportTableData,
  buildSearchTableLayout,
  compareByColumn,
  computeRowValues,
  getKeywordMatchDetail,
  matchesKeyword,
} from "./searchTable.js";
import { toUnixMs, unixMsToSerial } from "../../utils/dateTime.js";

const buildRegressionForm = () => ({
  schema: [
    {
      type: "select",
      label: "top",
      options: [{ label: "opt1" }, { label: "opt2" }],
      childrenByValue: {
        opt1: [
          {
            type: "text",
            label: "xxx",
            childrenByValue: {
              a: [{ type: "text", label: "leaf1" }],
              b: [{ type: "text", label: "leaf2" }],
            },
          },
        ],
        opt2: [{ type: "text", label: "xxx" }],
      },
    },
  ],
});

test("空白セルを挟んだ同一ヘッダーは残す", () => {
  const { headerRows } = buildExportTableData({ form: buildRegressionForm(), entries: [] });
  assert.equal(headerRows[2][5], "xxx");
  assert.equal(headerRows[2][6], "");
  assert.equal(headerRows[2][7], "");
  assert.equal(headerRows[2][8], "xxx");
});

test("連続する同一ヘッダーは2つ目以降を空白化する", () => {
  const { headerRows } = buildExportTableData({ form: buildRegressionForm(), entries: [] });
  assert.equal(headerRows[0][4], "top");
  assert.deepEqual(headerRows[0].slice(5), ["", "", "", ""]);
});



test("検索一覧ヘッダー上段: 連続する同一ラベルは右側を空白化する", () => {
  const form = {
    settings: {},
    displayFieldSettings: [
      { path: "xxx|a", type: "text" },
      { path: "xxx|b", type: "text" },
      { path: "xxx|c", type: "text" },
      { path: "xxx|d", type: "text" },
    ],
  };
  const { headerRows } = buildSearchTableLayout(form, { includeOperations: false });
  assert.deepEqual(headerRows[0].slice(4).map((cell) => cell.label), ["xxx", "", "", ""]);
});

const simplifyColumns = (columns) =>
  (columns || []).map((column) => ({
    key: column?.key || "",
    path: column?.path || null,
    sourceType: column?.sourceType || "",
    segments: Array.isArray(column?.segments) ? [...column.segments] : [],
  }));

const simplifyHeaderRows = (rows) =>
  (rows || []).map((row) =>
    (row || []).map((cell) => ({
      label: cell?.label || "",
      colSpan: Number(cell?.colSpan) || 1,
      rowSpan: Number(cell?.rowSpan) || 1,
      startIndex: Number(cell?.startIndex) || 0,
      columnKey: cell?.column?.key || null,
    })),
  );

test("検索ヘッダーはheaderMatrix有無で変化しない", () => {
  const form = {
    settings: {},
    displayFieldSettings: [
      { path: "B項目", type: "text" },
      { path: "A項目", type: "text" },
      { path: "親|子", type: "text" },
    ],
  };
  const headerMatrix = [
    ["No.", "modifiedAt", "A項目", "B項目", "親", "親"],
    ["", "", "", "", "子", "別子"],
  ];

  const withoutMatrix = buildSearchTableLayout(form, { includeOperations: false });
  const withMatrix = buildSearchTableLayout(form, { headerMatrix, includeOperations: false });

  assert.deepEqual(simplifyColumns(withoutMatrix.columns), simplifyColumns(withMatrix.columns));
  assert.deepEqual(simplifyHeaderRows(withoutMatrix.headerRows), simplifyHeaderRows(withMatrix.headerRows));
});

test("検索列はdisplayFieldSettingsの定義順を保持する", () => {
  const form = {
    settings: {},
    displayFieldSettings: [
      { path: "B項目", type: "text" },
      { path: "A項目", type: "text" },
      { path: "親|子", type: "text" },
    ],
  };

  const layout = buildSearchTableLayout(form, { includeOperations: false });
  const fieldPaths = layout.columns.filter((column) => column?.path).map((column) => column.path);
  assert.deepEqual(fieldPaths, ["B項目", "A項目", "親|子"]);
});
test("検索列は旧 printTemplate 設定でも current schema の PDF 出力を使う", () => {
  const form = {
    settings: {},
    schema: [
      {
        id: "print_pdf_1",
        type: "printTemplate",
        label: "",
        isDisplayed: true,
        printTemplateAction: { enabled: true, outputType: "pdf", fileNameTemplate: "print_${recordId}" },
      },
    ],
    displayFieldSettings: [
      { path: "GoogleDocument", type: "printTemplate" },
    ],
  };

  const layout = buildSearchTableLayout(form, { includeOperations: false });
  const actionColumn = layout.columns.find((column) => column?.actionKind === "printTemplate");
  assert.equal(actionColumn?.path, "PDF");
  const rowValues = computeRowValues({ id: "rec_1", data: {}, dataUnixMs: {} }, layout.columns);
  assert.equal(rowValues[actionColumn.key].display, "PDF");
});

test("検索列は除外指定したメッセージをdisplayFieldSettingsに残っていても含めない", () => {
  const form = {
    settings: {},
    schema: [
      { type: "message", label: "案内", isDisplayed: true, excludeFromSearchAndPrint: true },
      { type: "text", label: "氏名", isDisplayed: true },
    ],
    displayFieldSettings: [
      { path: "案内", type: "message" },
      { path: "氏名", type: "text" },
    ],
  };

  const layout = buildSearchTableLayout(form, { includeOperations: false });
  const fieldPaths = layout.columns.filter((column) => column?.path).map((column) => column.path);
  assert.deepEqual(fieldPaths, ["氏名"]);
});

test("検索列は printTemplate をdisplayFieldSettingsに残っていれば型別アクション列として含める", () => {
  const form = {
    settings: {},
    schema: [
      { type: "text", label: "氏名", isDisplayed: true },
      {
        type: "printTemplate",
        label: "",
        isDisplayed: true,
        printTemplateAction: { enabled: true, outputType: "gmail", fileNameTemplate: "print_${recordId}" },
      },
    ],
    displayFieldSettings: [
      { path: "氏名", type: "text" },
      { path: "Gmail", type: "printTemplate" },
    ],
  };

  const layout = buildSearchTableLayout(form, { includeOperations: false });
  const fieldPaths = layout.columns.filter((column) => column?.path).map((column) => column.path);
  assert.deepEqual(fieldPaths, ["氏名", "Gmail"]);
  const actionColumn = layout.columns.find((column) => column.path === "Gmail");
  assert.equal(actionColumn?.actionKind, "printTemplate");
});

test("検索結果エクスポートの多段ヘッダーは除外指定したメッセージを含めない", () => {
  const form = {
    settings: {},
    schema: [
      { type: "message", label: "案内", isDisplayed: true, excludeFromSearchAndPrint: true },
      { type: "text", label: "氏名", isDisplayed: true },
    ],
  };

  const exportTable = buildExportTableData({ form, entries: [] });
  const flattenedHeaders = exportTable.headerRows.flat().filter(Boolean);
  assert.equal(flattenedHeaders.includes("案内"), false);
  assert.equal(flattenedHeaders.includes("氏名"), true);
});

test("検索結果エクスポートの多段ヘッダーは printTemplate を含めない", () => {
  const form = {
    settings: {},
    schema: [
      { type: "text", label: "氏名", isDisplayed: true },
      {
        type: "printTemplate",
        label: "様式出力",
        isDisplayed: true,
        printTemplateAction: { enabled: true, fileNameTemplate: "print_${recordId}" },
      },
    ],
  };

  const exportTable = buildExportTableData({ form, entries: [] });
  const flattenedHeaders = exportTable.headerRows.flat().filter(Boolean);
  assert.equal(flattenedHeaders.includes("様式出力"), false);
  assert.equal(flattenedHeaders.includes("氏名"), true);
});

test("modifiedAtはJST表示を検索対象にし、raw unix文字列は部分一致検索対象にしない", () => {
  const form = { settings: {} };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const unixMs = Date.UTC(2026, 0, 1, 0, 0, 0); // JST: 2026/01/01 09:00
  const entry = { id: "r_1", "No.": 1, modifiedAtUnixMs: unixMs, modifiedAt: unixMs, data: {}, dataUnixMs: {} };
  const row = { entry, values: computeRowValues(entry, columns) };

  assert.equal(row.values.modifiedAt.display, "2026/01/01 09:00:00");
  assert.equal(matchesKeyword(row, columns, "modifiedAt:2026/01/01 09:00:00"), true);
  assert.equal(matchesKeyword(row, columns, String(unixMs)), false);
});

test("createdAtは表示名が作成日時でJST表示・比較検索できる", () => {
  const form = { settings: {} };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const createdAtColumn = columns.find((column) => column.key === "createdAt");
  assert.ok(createdAtColumn);
  assert.deepEqual(createdAtColumn.segments, ["作成日時"]);

  const unixMs = Date.UTC(2026, 0, 1, 0, 0, 0); // JST: 2026/01/01 09:00
  const entry = {
    id: "r_created",
    "No.": 10,
    createdAtUnixMs: unixMs,
    createdAt: unixMs,
    modifiedAtUnixMs: unixMs,
    modifiedAt: unixMs,
    data: {},
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };

  assert.equal(row.values.createdAt.display, "2026/01/01 09:00:00");
  assert.equal(matchesKeyword(row, columns, "createdAt:2026/01/01 09:00:00"), true);
  assert.equal(matchesKeyword(row, columns, "createdAt>=2026/01/01 09:00:00"), true);
});

test("検索列設定でid列とcreatedAt列を非表示にできる", () => {
  const form = {
    settings: {
      showSearchId: false,
      showSearchCreatedAt: false,
    },
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const keys = columns.map((column) => column.key);
  assert.equal(keys.includes("id"), false);
  assert.equal(keys.includes("createdAt"), false);
  assert.equal(keys.includes("modifiedAt"), true);
});

test("検索列設定でmodifiedAt列を非表示にできる", () => {
  const form = {
    settings: {
      showSearchModifiedAt: false,
    },
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const keys = columns.map((column) => column.key);

  assert.equal(keys.includes("modifiedAt"), false);
  assert.equal(keys.includes("createdAt"), true);
  assert.equal(keys.includes("id"), true);
});

test("id列が非表示でも通常検索でレコードIDにマッチする", () => {
  const form = {
    settings: {
      showSearchId: false,
    },
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const entry = {
    id: "rec_hidden_id_001",
    "No.": 1,
    modifiedAtUnixMs: Date.UTC(2026, 0, 1, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
    data: {},
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };

  assert.equal(columns.some((column) => column.key === "id"), false);
  assert.equal(matchesKeyword(row, columns, "hidden_id_001"), true);
});

test("id列が非表示でも列指定検索(ID:...)でレコードIDにマッチする", () => {
  const form = {
    settings: {
      showSearchId: false,
    },
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const entry = {
    id: "rec_column_id_999",
    "No.": 2,
    modifiedAtUnixMs: Date.UTC(2026, 0, 1, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
    data: {},
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };

  assert.equal(columns.some((column) => column.key === "id"), false);
  assert.equal(matchesKeyword(row, columns, "ID:column_id_999"), true);
});

test("スペース区切りの複数キーワードは暗黙ANDで全語一致になる", () => {
  const form = {
    settings: {},
    displayFieldSettings: [
      { path: "氏名", type: "text" },
      { path: "備考", type: "text" },
    ],
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const entry = {
    id: "rec_multi_word",
    "No.": 1,
    modifiedAtUnixMs: Date.UTC(2026, 0, 1, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
    data: {
      氏名: "山田 太郎",
      備考: "営業部",
    },
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };

  assert.equal(matchesKeyword(row, columns, "山田 営業"), true);
  assert.equal(matchesKeyword(row, columns, "山田 経理"), false);
});

test("全角スペース区切りの複数キーワードも暗黙ANDで全語一致になる", () => {
  const form = {
    settings: {},
    displayFieldSettings: [
      { path: "会社", type: "text" },
      { path: "担当", type: "text" },
    ],
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const entry = {
    id: "rec_multi_word_full_width",
    "No.": 2,
    modifiedAtUnixMs: Date.UTC(2026, 0, 1, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
    data: {
      会社: "株式会社サンプル",
      担当: "佐藤",
    },
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };

  assert.equal(matchesKeyword(row, columns, "株式会社　佐藤"), true);
  assert.equal(matchesKeyword(row, columns, "株式会社　鈴木"), false);
});

test("空白区切りで単語と列指定条件を暗黙AND連結できる", () => {
  const form = {
    settings: {},
    displayFieldSettings: [
      { path: "氏名", type: "text" },
      { path: "部署", type: "text" },
      { path: "役職", type: "text" },
    ],
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const entry = {
    id: "rec_implicit_and_mixed",
    "No.": 3,
    modifiedAtUnixMs: Date.UTC(2026, 0, 1, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
    data: {
      氏名: "山田 太郎",
      部署: "営業部",
      役職: "主任",
    },
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };

  assert.equal(matchesKeyword(row, columns, "山田 部署:営業"), true);
  assert.equal(matchesKeyword(row, columns, "部署:営業 山田"), true);
  assert.equal(matchesKeyword(row, columns, "部署:営業 役職:主任"), true);
  assert.equal(matchesKeyword(row, columns, "部署:営業 役職:部長"), false);
});

test("括弧式と後続条件は空白で暗黙ANDになる", () => {
  const form = {
    settings: {},
    displayFieldSettings: [
      { path: "氏名", type: "text" },
      { path: "部署", type: "text" },
    ],
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const entry = {
    id: "rec_implicit_and_group",
    "No.": 4,
    modifiedAtUnixMs: Date.UTC(2026, 0, 1, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
    data: {
      氏名: "山田 太郎",
      部署: "営業部",
    },
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };

  assert.equal(matchesKeyword(row, columns, "(山田 OR 佐藤) 営業"), true);
  assert.equal(matchesKeyword(row, columns, "(田中 OR 佐藤) 営業"), false);
});

test("語中のand/orは演算子として分割しない", () => {
  const form = {
    settings: {},
    displayFieldSettings: [{ path: "メモ", type: "text" }],
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const entry = {
    id: "rec_word_with_or",
    "No.": 5,
    modifiedAtUnixMs: Date.UTC(2026, 0, 1, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
    data: {
      メモ: "collective azure",
    },
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };

  assert.equal(matchesKeyword(row, columns, "collective azure"), true);
  assert.equal(matchesKeyword(row, columns, "color azure"), false);
});

test("modifiedAt比較検索はYYYY/MM/DD HH:mm形式を解釈できる", () => {
  const form = { settings: {} };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const unixMs = Date.UTC(2026, 0, 1, 3, 30, 0); // JST: 2026/01/01 12:30
  const entry = { id: "r_2", "No.": 2, modifiedAtUnixMs: unixMs, modifiedAt: unixMs, data: {}, dataUnixMs: {} };
  const row = { entry, values: computeRowValues(entry, columns) };

  assert.equal(matchesKeyword(row, columns, "modifiedAt>=2026/01/01 12:00"), true);
  assert.equal(matchesKeyword(row, columns, "modifiedAt<2026/01/01 12:00"), false);
});

test("modifiedAtUnixMsがUNIX秒でもJST表示とソート値はUNIX msで扱う", () => {
  const form = { settings: {} };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const unixMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  const unixSec = Math.floor(unixMs / 1000);
  const entry = { id: "r_sec", "No.": 3, modifiedAtUnixMs: unixSec, modifiedAt: unixSec, data: {}, dataUnixMs: {} };
  const row = { entry, values: computeRowValues(entry, columns) };

  assert.equal(row.values.modifiedAt.display, "2026/01/01 09:00:00");
  assert.equal(row.values.modifiedAt.sort, unixMs);
});

test("modifiedAtソートは数値時刻順で比較する", () => {
  const form = { settings: {} };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const modifiedAtColumn = columns.find((column) => column.key === "modifiedAt");
  assert.ok(modifiedAtColumn);

  const oldUnixMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  const newUnixMs = Date.UTC(2026, 0, 2, 0, 0, 0);
  const oldRow = {
    entry: { id: "old", "No.": 1, modifiedAtUnixMs: oldUnixMs, modifiedAt: oldUnixMs, data: {}, dataUnixMs: {} },
    values: computeRowValues({ id: "old", "No.": 1, modifiedAtUnixMs: oldUnixMs, modifiedAt: oldUnixMs, data: {}, dataUnixMs: {} }, columns),
  };
  const newRow = {
    entry: { id: "new", "No.": 2, modifiedAtUnixMs: newUnixMs, modifiedAt: newUnixMs, data: {}, dataUnixMs: {} },
    values: computeRowValues({ id: "new", "No.": 2, modifiedAtUnixMs: newUnixMs, modifiedAt: newUnixMs, data: {}, dataUnixMs: {} }, columns),
  };

  const asc = [newRow, oldRow].sort((a, b) => compareByColumn(a, b, modifiedAtColumn, "asc"));
  assert.equal(asc[0].entry.id, "old");
  const desc = [newRow, oldRow].sort((a, b) => compareByColumn(a, b, modifiedAtColumn, "desc"));
  assert.equal(desc[0].entry.id, "new");
});

test("date/time項目はシリアル値をYYYY/MM/DD・HH:mmで表示し検索できる", () => {
  const form = {
    settings: {},
    displayFieldSettings: [
      { path: "日付項目", type: "date" },
      { path: "時間項目", type: "time" },
    ],
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });

  const dateUnixMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  const timeUnixMs = toUnixMs("14:30");
  const entry = {
    id: "r_temporal_serial",
    "No.": 4,
    modifiedAtUnixMs: Date.UTC(2026, 0, 2, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 2, 0, 0, 0),
    data: {
      日付項目: unixMsToSerial(dateUnixMs),
      時間項目: unixMsToSerial(timeUnixMs),
    },
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };
  const dateColumn = columns.find((column) => column.path === "日付項目");
  const timeColumn = columns.find((column) => column.path === "時間項目");
  assert.ok(dateColumn);
  assert.ok(timeColumn);

  assert.equal(row.values[dateColumn.key].display, "2026/01/01");
  assert.equal(row.values[timeColumn.key].display, "14:30");
  assert.equal(matchesKeyword(row, columns, "日付項目:2026/01/01"), true);
  assert.equal(matchesKeyword(row, columns, "時間項目:14:30"), true);
});

test("検索結果のチェックボックス表示はフォーム定義順で縮退表示する", () => {
  const form = {
    settings: {},
    schema: [
      {
        type: "checkboxes",
        label: "希望連絡方法",
        options: [{ label: "電話" }, { label: "メール" }, { label: "SMS" }],
      },
    ],
    displayFieldSettings: [{ path: "希望連絡方法", type: "checkboxes" }],
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const checkboxColumn = columns.find((column) => column.path === "希望連絡方法");
  assert.ok(checkboxColumn);

  const entry = {
    id: "r_checkbox_order",
    "No.": 5,
    modifiedAtUnixMs: Date.UTC(2026, 0, 2, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 2, 0, 0, 0),
    data: {
      "希望連絡方法|SMS": true,
      "希望連絡方法|電話": true,
    },
    dataUnixMs: {},
  };

  const values = computeRowValues(entry, columns);
  assert.equal(values[checkboxColumn.key].display, "電話、SMS");
});

test("No.表示時は先頭データ列が必ずNo.になる", () => {
  const form = {
    settings: {},
    displayFieldSettings: [
      { path: "会社名", type: "text" },
      { path: "所在地", type: "text" },
    ],
  };

  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  assert.equal(columns[0].key, "No.");
  assert.deepEqual(columns.slice(0, 6).map((column) => column.key), [
    "No.",
    "id",
    "createdAt",
    "modifiedAt",
    "display:会社名",
    "display:所在地",
  ]);
});

test("No.非表示時は既存順を維持してNo.を挿入しない", () => {
  const form = {
    settings: {
      showRecordNo: false,
    },
    displayFieldSettings: [
      { path: "会社名", type: "text" },
    ],
  };

  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  assert.equal(columns.some((column) => column.key === "No."), false);
  assert.deepEqual(columns.slice(0, 4).map((column) => column.key), [
    "id",
    "createdAt",
    "modifiedAt",
    "display:会社名",
  ]);
});

test("fileUploadのhideFileExtensionが検索結果の表示名に反映される", () => {
  const form = {
    schema: [
      {
        id: "f_upload",
        type: "fileUpload",
        label: "添付ファイル",
        isDisplayed: true,
        hideFileExtension: true,
        allowUploadByUrl: false,
        allowFolderUrlEdit: false,
      },
    ],
    displayFieldSettings: [
      { path: "添付ファイル", type: "fileUpload", fieldId: "f_upload" },
    ],
  };

  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const fileColumn = columns.find((column) => column.sourceType === "fileUpload");
  assert.ok(fileColumn, "fileUpload列が存在する");

  const entry = {
    id: "rec_1",
    "No.": 1,
    modifiedAtUnixMs: 0,
    modifiedAt: 0,
    data: { "添付ファイル": JSON.stringify([{ name: "報告書.pdf", driveFileUrl: "https://example.com" }]) },
    dataUnixMs: {},
  };
  const values = computeRowValues(entry, columns);
  const cellValue = values[fileColumn.key];
  assert.equal(cellValue.display, "報告書");
  assert.equal(cellValue.files[0].displayName, "報告書");
});

test("fileUploadのhideFileExtensionがfalseの場合は拡張子が表示される", () => {
  const form = {
    schema: [
      {
        id: "f_upload",
        type: "fileUpload",
        label: "添付ファイル",
        isDisplayed: true,
        hideFileExtension: false,
        allowUploadByUrl: false,
        allowFolderUrlEdit: false,
      },
    ],
    displayFieldSettings: [
      { path: "添付ファイル", type: "fileUpload", fieldId: "f_upload" },
    ],
  };

  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const fileColumn = columns.find((column) => column.sourceType === "fileUpload");

  const entry = {
    id: "rec_1",
    "No.": 1,
    modifiedAtUnixMs: 0,
    modifiedAt: 0,
    data: { "添付ファイル": JSON.stringify([{ name: "報告書.pdf", driveFileUrl: "https://example.com" }]) },
    dataUnixMs: {},
  };
  const values = computeRowValues(entry, columns);
  const cellValue = values[fileColumn.key];
  assert.equal(cellValue.display, "報告書.pdf");
});

test("schema にIDがないfileUploadでもhideFileExtensionが反映される", () => {
  const form = {
    schema: [
      {
        type: "fileUpload",
        label: "添付ファイル",
        isDisplayed: true,
        hideFileExtension: true,
        allowUploadByUrl: false,
        allowFolderUrlEdit: false,
      },
    ],
    displayFieldSettings: [
      { path: "添付ファイル", type: "fileUpload", fieldId: "f_auto_rg9dm9" },
    ],
  };

  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const fileColumn = columns.find((column) => column.sourceType === "fileUpload");
  assert.ok(fileColumn, "fileUpload列が存在する");

  const entry = {
    id: "rec_1",
    "No.": 1,
    modifiedAtUnixMs: 0,
    modifiedAt: 0,
    data: { "添付ファイル": JSON.stringify([{ name: "要領（R7.4改正）.pdf", driveFileUrl: "https://example.com" }]) },
    dataUnixMs: {},
  };
  const values = computeRowValues(entry, columns);
  const cellValue = values[fileColumn.key];
  assert.equal(cellValue.display, "要領（R7.4改正）");
});

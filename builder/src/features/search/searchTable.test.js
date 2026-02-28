import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExportTableData,
  buildHeaderRowsFromCsv,
  buildSearchTableLayout,
  compareByColumn,
  computeRowValues,
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
  assert.equal(headerRows[2][3], "xxx");
  assert.equal(headerRows[2][4], "");
  assert.equal(headerRows[2][5], "");
  assert.equal(headerRows[2][6], "xxx");
});

test("連続する同一ヘッダーは2つ目以降を空白化する", () => {
  const { headerRows } = buildExportTableData({ form: buildRegressionForm(), entries: [] });
  assert.equal(headerRows[0][2], "top");
  assert.deepEqual(headerRows[0].slice(3), ["", "", "", ""]);
});

test("検索ヘッダーCSV: 空白を挟んだ同一ラベルは省略しない", () => {
  const rows = buildHeaderRowsFromCsv([["xxx", "", "xxx", "xxx"]]);
  assert.deepEqual(rows[0].map((cell) => cell.label), ["xxx", "", "xxx", ""]);
});

test("検索ヘッダーCSV: 連続する同一ラベルは右側を空白化する", () => {
  const rows = buildHeaderRowsFromCsv([["xxx", "xxx", "xxx", "xxx"]]);
  assert.deepEqual(rows[0].map((cell) => cell.label), ["xxx", "", "", ""]);
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
  assert.deepEqual(headerRows[0].slice(2).map((cell) => cell.label), ["xxx", "", "", ""]);
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

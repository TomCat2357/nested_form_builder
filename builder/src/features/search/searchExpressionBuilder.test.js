import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSearchRow,
} from "./searchExpressionBuilder.js";
import { formatCanonical } from "../../utils/dateTime.js";

// テスト用列定義: createDisplayColumn / createBaseColumns 相当のミニマル構造
const META_NO = { key: "No.", searchable: true, sortable: true };
const META_ID = { key: "id", searchable: true };
const META_CREATED = { key: "createdAt", searchable: true };
const META_MODIFIED = { key: "modifiedAt", searchable: true };
const META_CREATED_BY = { key: "createdBy", searchable: true };
const META_MODIFIED_BY = { key: "modifiedBy", searchable: true };
const COL_SALES_DATE = {
  key: "display:販売日",
  path: "販売日",
  sourceType: "date",
  searchable: true,
};
const COL_NAME = {
  key: "display:氏名",
  path: "氏名",
  sourceType: "text",
  searchable: true,
};
const COL_NESTED = {
  key: "display:親質問|子質問",
  path: "親質問|子質問",
  sourceType: "text",
  searchable: true,
};
const COL_NOT_SEARCHABLE = {
  key: "display:備考",
  path: "備考",
  sourceType: "text",
  searchable: false,
};

const COLUMNS = [
  META_NO,
  META_ID,
  META_CREATED,
  META_MODIFIED,
  META_CREATED_BY,
  META_MODIFIED_BY,
  COL_SALES_DATE,
  COL_NAME,
  COL_NESTED,
  COL_NOT_SEARCHABLE,
];

test("buildSearchRow: 表示列は path ベースのキーで露出、日付列は canonical 文字列、検索対象外メタは出さない", () => {
  const salesDateUnixMs = Date.parse("2026-04-01");
  const row = {
    entry: {
      id: "abc",
      createdAt: 1700000000000,
      modifiedAt: 1700000999999,
      createdBy: "u1",
      modifiedBy: "u2",
      data: { "販売日": "2026-04-01", "氏名": "田中" },
      dataUnixMs: { "販売日": salesDateUnixMs },
    },
    values: {
      "No.": { display: "1", search: "1", sort: 1 },
      "id": { display: "abc", search: "abc", sort: "abc" },
      "modifiedAt": { display: "2026/01/02", search: "2026/01/02", sort: 1700000999999 },
      "display:販売日": { display: "2026/04/01", search: "2026/04/01", sort: "2026/04/01" },
      "display:氏名": { display: "田中", search: "田中", sort: "田中" },
      "display:親質問|子質問": { display: "値", search: "値", sort: "値" },
    },
  };
  const out = buildSearchRow(row, COLUMNS);
  // 日付/時刻列は canonical 文字列（date=YYYY-MM-DD）。文字列としての日付比較が動く形。
  assert.equal(out["販売日"], "2026-04-01");
  assert.equal(typeof out["販売日"], "string");
  // それ以外の列は cell.sort/display ベース
  assert.equal(out["氏名"], "田中");
  assert.equal(out["親質問__子質問"], "値");
  assert.equal(out["No."], 1);
  assert.equal(out["id"], "abc");
  // createdAt / modifiedAt は固定メタ列（datetime）。canonical 文字列 YYYY-MM-DD_HH:mm:ss.SSS で渡る。
  assert.equal(out["createdAt"], formatCanonical(1700000000000, "datetime"));
  assert.equal(out["modifiedAt"], formatCanonical(1700000999999, "datetime"));
  // 検索対象外メタ（…By 系）は row dict にも出さない
  assert.equal(Object.prototype.hasOwnProperty.call(out, "createdBy"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(out, "modifiedBy"), false);
});

test("buildSearchRow: 日付列で dataUnixMs が無い場合、entry.data から canonical 文字列に整形", () => {
  const row = {
    entry: {
      id: "abc",
      data: { "販売日": "2026-04-01" },
      dataUnixMs: {},
    },
    values: {
      "display:販売日": { display: "2026/04/01", search: "", sort: "" },
    },
  };
  const out = buildSearchRow(row, [COL_SALES_DATE]);
  assert.equal(typeof out["販売日"], "string");
  // ハイフン保存値はそのまま canonical のハイフン形式に正規化される。
  assert.equal(out["販売日"], "2026-04-01");
});

test("buildSearchRow: 日付列で値が空のとき null を返す", () => {
  const row = {
    entry: { id: "abc", data: {}, dataUnixMs: {} },
    values: {
      "display:販売日": { display: "", search: "", sort: "" },
    },
  };
  const out = buildSearchRow(row, [COL_SALES_DATE]);
  assert.equal(out["販売日"], null);
});

test("buildSearchRow: modifiedAt が ISO 文字列でも canonical datetime 文字列に正規化される", () => {
  const row = {
    entry: {
      id: "abc",
      modifiedAt: "2026-03-02T01:02:03.000Z",
      data: {},
      dataUnixMs: {},
    },
    values: {},
  };
  const out = buildSearchRow(row, [META_MODIFIED]);
  assert.equal(out["modifiedAt"], formatCanonical("2026-03-02T01:02:03.000Z", "datetime"));
});

// 非日付列の空欄は alasql 行で null に統一する（`列名 IS NULL` で空欄行をヒットさせるため）
test("buildSearchRow: 非日付列で sort=null, display=\"\" のとき null を出す（フィールド未定義）", () => {
  const row = {
    entry: { id: "abc", data: {}, dataUnixMs: {} },
    values: {
      "No.": { display: "", search: "", sort: null },
      "display:氏名": { display: "", search: "", sort: null },
    },
  };
  const out = buildSearchRow(row, [META_NO, COL_NAME]);
  assert.strictEqual(out["No."], null);
  assert.strictEqual(out["氏名"], null);
});

test("buildSearchRow: 非日付列で sort=\"\", display=\"\" のとき null を出す（ユーザー入力空文字）", () => {
  // 「フォームの該当フィールドにユーザーが何も入力しなかった」ケース。
  // alasql 行では null に正規化されるので、`氏名 IS NULL` でこの行が拾える。
  const row = {
    entry: { id: "abc", data: { "氏名": "" }, dataUnixMs: {} },
    values: {
      "No.": { display: "", search: "", sort: "" },
      "display:氏名": { display: "", search: "", sort: "" },
    },
  };
  const out = buildSearchRow(row, [META_NO, COL_NAME]);
  assert.strictEqual(out["No."], null);
  assert.strictEqual(out["氏名"], null);
});

test("buildSearchRow: 非日付列で sort=null だが display に値があれば display を採用", () => {
  const row = {
    entry: { id: "abc", data: {}, dataUnixMs: {} },
    values: {
      "display:氏名": { display: "田中", search: "田中", sort: null },
    },
  };
  const out = buildSearchRow(row, [COL_NAME]);
  assert.equal(out["氏名"], "田中");
});

// --- buildSearchRow の schema-only 経路 ---
// 非表示列に対する `IS NOT NULL` / `=` を効かせるための経路。

test("buildSearchRow: 表示テーブル外（schema 由来）の列でも entry.data から拾って AlaSQL 行に出す", () => {
  // 「備考」はテーブル非表示の前提 → values[col.key] に entry がない。
  // それでも `備考 IS NOT NULL` を効かせるため、entry.data["備考"] から拾う。
  const HIDDEN_COL = {
    key: "display:備考",
    path: "備考",
    sourceType: "textarea",
    searchable: true,
  };
  const rowWithValue = {
    entry: { id: "a", data: { "備考": "hello" }, dataUnixMs: {} },
    values: {},
  };
  const rowEmpty = {
    entry: { id: "b", data: { "備考": "" }, dataUnixMs: {} },
    values: {},
  };
  const rowAbsent = {
    entry: { id: "c", data: {}, dataUnixMs: {} },
    values: {},
  };
  assert.equal(buildSearchRow(rowWithValue, [HIDDEN_COL])["備考"], "hello");
  assert.strictEqual(buildSearchRow(rowEmpty, [HIDDEN_COL])["備考"], null);
  assert.strictEqual(buildSearchRow(rowAbsent, [HIDDEN_COL])["備考"], null);
});

test("buildSearchRow: schema-only 列でも日付列は canonical 文字列に正規化される（entry.dataUnixMs/data 経路は既存と同じ）", () => {
  const HIDDEN_DATE_COL = {
    key: "display:納期",
    path: "納期",
    sourceType: "date",
    searchable: true,
  };
  const row = {
    entry: { id: "a", data: { "納期": "2026-05-01" }, dataUnixMs: {} },
    values: {},
  };
  const out = buildSearchRow(row, [HIDDEN_DATE_COL]);
  assert.equal(typeof out["納期"], "string");
  assert.equal(out["納期"], "2026-05-01");
});

test("buildSearchRow: schema-only 列で配列値（checkboxes 等）は「,」連結される", () => {
  const HIDDEN_COL = {
    key: "display:区分",
    path: "区分",
    sourceType: "checkboxes",
    searchable: true,
  };
  const row = {
    entry: { id: "a", data: { "区分": ["A", "C"] }, dataUnixMs: {} },
    values: {},
  };
  assert.equal(buildSearchRow(row, [HIDDEN_COL])["区分"], "A,C");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAllSearchableColumns,
  buildSearchExpression,
  buildSearchableColumnKeys,
  buildSearchRow,
  buildSearchRowView,
  mergeDisplayAndSchemaColumns,
  stripNonSearchableMetaKeys,
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

test("buildSearchableColumnKeys は path ベースの alasql 安全キーを返す（createdAt / modifiedAt は残し、…By 系は除外）", () => {
  const keys = buildSearchableColumnKeys(COLUMNS);
  assert.deepEqual(keys, ["No.", "id", "createdAt", "modifiedAt", "販売日", "氏名", "親質問__子質問"]);
});

test("buildSearchableColumnKeys は searchable=false を除外", () => {
  const keys = buildSearchableColumnKeys([COL_SALES_DATE, COL_NOT_SEARCHABLE]);
  assert.deepEqual(keys, ["販売日"]);
});

test("buildSearchableColumnKeys は createdBy / modifiedBy / deletedAt / deletedBy を除外し createdAt / modifiedAt は残す", () => {
  const keys = buildSearchableColumnKeys([
    { key: "createdAt", searchable: true },
    { key: "createdBy", searchable: true },
    { key: "deletedAt", searchable: true },
    { key: "deletedBy", searchable: true },
    { key: "modifiedBy", searchable: true },
    { key: "modifiedAt", searchable: true },
    { key: "id", searchable: true },
    { key: "No.", searchable: true },
  ]);
  assert.deepEqual(keys, ["createdAt", "modifiedAt", "id", "No."]);
});

test("buildSearchExpression(厳密): 表示列に対する = は識別子が path ベースに解決される", () => {
  const r = buildSearchExpression("WHERE 氏名 = '田中'", COLUMNS);
  assert.equal(r.expr, "`氏名` = '田中'");
  assert.deepEqual(r.errors, []);
});

test("buildSearchExpression(厳密): 日付型列 = 日付リテラルは列を丸めずリテラルのみ canonical 化（生文字列比較）", () => {
  const r = buildSearchExpression("WHERE 販売日 = 2026/04/01", COLUMNS);
  assert.equal(r.expr, "`販売日` = '2026/04/01'");
});

test("buildSearchExpression(厳密): 日付型列 > 日付リテラルもリテラルのみ canonical 化（区切りゆらぎを吸収）", () => {
  const r = buildSearchExpression("WHERE 販売日 > 2020-4-1", COLUMNS);
  assert.equal(r.expr, "`販売日` > '2020/04/01'");
});

test("buildSearchExpression(厳密): createdAt は検索対象（datetime メタ列。リテラルのみ canonical 化）", () => {
  // createdAt は metaByName に含まれ isDateLike 判定が効くので、日付リテラルの区切り/ゼロ埋めゆらぎを吸収する。
  const r = buildSearchExpression("WHERE createdAt >= 2026/1/1", COLUMNS);
  assert.equal(r.expr, "`createdAt` >= '2026/01/01'");
});

test("buildSearchExpression(厳密): modifiedAt は検索対象（列は丸めずリテラルのみ canonical 化）", () => {
  const r = buildSearchExpression("WHERE modifiedAt >= 2026/01/01", COLUMNS);
  // modifiedAt は datetime メタ列。日付リテラルは date kind で canonical 化され、
  // 列はフル精度のまま辞書順比較される（= は完全一致なのでこの日付では当日 0:00 のみ一致）。
  assert.equal(r.expr, "`modifiedAt` >= '2026/01/01'");
});

test("buildSearchExpression(厳密): パイプ列名は __ に正規化される", () => {
  const r = buildSearchExpression("WHERE 親質問|子質問 = '値'", COLUMNS);
  assert.equal(r.expr, "`親質問__子質問` = '値'");
});

test("buildSearchExpression(厳密): 数値列の比較は素通し", () => {
  const r = buildSearchExpression("WHERE No. >= 10", COLUMNS);
  assert.equal(r.expr, "`No.` >= 10");
});

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
  // 日付/時刻列は canonical 文字列（date=YYYY/MM/DD）。文字列としての日付比較が動く形。
  assert.equal(out["販売日"], "2026/04/01");
  assert.equal(typeof out["販売日"], "string");
  // それ以外の列は cell.sort/display ベース
  assert.equal(out["氏名"], "田中");
  assert.equal(out["親質問__子質問"], "値");
  assert.equal(out["No."], 1);
  assert.equal(out["id"], "abc");
  // createdAt / modifiedAt は固定メタ列（datetime）。canonical 文字列 YYYY/MM/DD HH:mm:ss.SSS で渡る。
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
  // 旧ハイフン形式の保存値も canonical のスラッシュ形式に正規化される。
  assert.equal(out["販売日"], "2026/04/01");
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
  // alasql 行では null に正規化されるので、`WHERE 氏名 IS NULL` でこの行が拾える。
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

// 統合: WHERE/SEARCH モードで `列名 IS NULL` が空欄行（null / "" 両方）をヒットさせる
test("buildSearchExpression × buildSearchRow: `WHERE 氏名 IS NULL` が sort=\"\" の行にもヒットする式と行を生成する", () => {
  const expr = buildSearchExpression("WHERE 氏名 IS NULL", COLUMNS);
  assert.equal(expr.expr, "`氏名` IS NULL");

  // ユーザーが氏名欄に何も入力しなかった行
  const emptyInputRow = {
    entry: { id: "x1", data: { "氏名": "" }, dataUnixMs: {} },
    values: { "display:氏名": { display: "", search: "", sort: "" } },
  };
  // 氏名フィールドがそもそも存在しない行
  const absentFieldRow = {
    entry: { id: "x2", data: {}, dataUnixMs: {} },
    values: { "display:氏名": { display: "", search: "", sort: null } },
  };
  // 氏名に値が入っている行
  const valuedRow = {
    entry: { id: "x3", data: { "氏名": "田中" }, dataUnixMs: {} },
    values: { "display:氏名": { display: "田中", search: "田中", sort: "田中" } },
  };

  assert.strictEqual(buildSearchRow(emptyInputRow, [COL_NAME])["氏名"], null);
  assert.strictEqual(buildSearchRow(absentFieldRow, [COL_NAME])["氏名"], null);
  assert.strictEqual(buildSearchRow(valuedRow, [COL_NAME])["氏名"], "田中");
});

// --- view / data 両モードとも日付列は文字列比較（variant 非依存） ---

test("buildSearchExpression(厳密): 日付列は列を丸めず文字列比較（view/data 共通）", () => {
  // view 行も data 行も date 列を canonical 文字列 (YYYY/MM/DD) で持つので、固定長辞書順 = 時系列順。
  const r = buildSearchExpression("WHERE 販売日 >= 2020/04/01", COLUMNS);
  assert.equal(r.expr, "`販売日` >= '2020/04/01'");
  assert.deepEqual(r.errors, []);
});

test("buildSearchExpression(厳密): modifiedAt も文字列比較", () => {
  const r = buildSearchExpression("WHERE modifiedAt >= 2026/01/01", COLUMNS);
  assert.equal(r.expr, "`modifiedAt` >= '2026/01/01'");
});

test("buildSearchRowView: radio はラベル文字列を返す", () => {
  // forEachFormField の path セグメントは field.label から作られる（defaultFieldSegment）
  const form = {
    schema: [
      { id: "f1", label: "回答状況", type: "radio", options: [
        { label: "対応済" },
        { label: "未対応" },
      ] },
    ],
  };
  const row = { entry: { id: "e1", data: { "回答状況": "対応済" } } };
  const out = buildSearchRowView(row, form);
  assert.equal(out["回答状況"], "対応済");
});

test("buildSearchRowView: checkboxes はカンマ連結のラベル文字列を返す", () => {
  const form = {
    schema: [
      { id: "f1", label: "区分", type: "checkboxes", options: [
        { label: "A" },
        { label: "B" },
        { label: "C" },
      ] },
    ],
  };
  const row = {
    entry: {
      id: "e1",
      data: { "区分|A": "●", "区分|C": "●" },
    },
  };
  const out = buildSearchRowView(row, form);
  assert.equal(out["区分"], "A,C");
});

test("buildSearchRowView: date は canonical 文字列で返り、unix ms 数値にはならない", () => {
  const form = {
    schema: [
      { id: "f1", label: "販売日", type: "date" },
    ],
  };
  const row = { entry: { id: "e1", data: { "販売日": "2026/04/01" } } };
  const out = buildSearchRowView(row, form);
  assert.equal(out["販売日"], "2026/04/01");
});

// --- buildAllSearchableColumns / buildSearchRow の schema-only 経路 ---
// 非表示列に対する `IS NOT NULL` / `=` を効かせるための経路。

test("buildAllSearchableColumns: schema を走査して field path 単位の列を返す", () => {
  const form = {
    schema: [
      { id: "f1", label: "氏名", type: "text" },
      { id: "f2", label: "備考", type: "textarea" },
      { id: "f3", label: "販売日", type: "date" },
    ],
  };
  const cols = buildAllSearchableColumns(form);
  const paths = cols.map((c) => c.path).sort();
  assert.deepEqual(paths, ["備考", "氏名", "販売日"]);
  const byPath = Object.fromEntries(cols.map((c) => [c.path, c]));
  assert.equal(byPath["販売日"].sourceType, "date");
  assert.equal(byPath["氏名"].key, "display:氏名");
});

test("buildSearchRow: 表示テーブル外（schema 由来）の列でも entry.data から拾って AlaSQL 行に出す", () => {
  // 「備考」はテーブル非表示の前提 → values[col.key] に entry がない。
  // それでも `WHERE 備考 IS NOT NULL` を効かせるため、entry.data["備考"] から拾う。
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
  assert.equal(out["納期"], "2026/05/01");
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

test("buildSearchRowView: row / form が不足なら空オブジェクト", () => {
  assert.deepEqual(buildSearchRowView(null, { schema: [] }), {});
  assert.deepEqual(buildSearchRowView({ entry: { id: "x" } }, null), {});
});

test("stripNonSearchableMetaKeys: …By/deleted 系メタ列を落とし、id/No_/createdAt/modifiedAt と項目は残す", () => {
  const rows = [
    {
      id: "a",
      No_: 1,
      createdAt: "2026/01/01 00:00:00.000",
      modifiedAt: "2026/05/20 09:00:21.000",
      createdBy: "alice@example.com",
      modifiedBy: "bob@example.com",
      deletedAt: null,
      deletedBy: "carol@example.com",
      "氏名": "田中",
    },
  ];
  const out = stripNonSearchableMetaKeys(rows);
  // 別オブジェクトとして返る（元は破壊しない）
  assert.notStrictEqual(out[0], rows[0]);
  assert.ok(Object.prototype.hasOwnProperty.call(rows[0], "deletedBy"));
  // 検索可なキーは残る
  assert.equal(out[0].id, "a");
  assert.equal(out[0].No_, 1);
  assert.equal(out[0].createdAt, "2026/01/01 00:00:00.000");
  assert.equal(out[0].modifiedAt, "2026/05/20 09:00:21.000");
  assert.equal(out[0]["氏名"], "田中");
  // 検索非対象メタは消える
  for (const key of ["createdBy", "modifiedBy", "deletedAt", "deletedBy"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(out[0], key), false, `${key} は除かれるべき`);
  }
});

test("stripNonSearchableMetaKeys: 該当キーが無い行はクローンせずそのまま返す / 非配列は []", () => {
  const clean = { id: "x", createdAt: "2026/01/01 00:00:00.000" };
  const out = stripNonSearchableMetaKeys([clean]);
  assert.strictEqual(out[0], clean);
  assert.deepEqual(stripNonSearchableMetaKeys(null), []);
  assert.deepEqual(stripNonSearchableMetaKeys(undefined), []);
});

test("mergeDisplayAndSchemaColumns: 表示列が空なら schema 列をそのまま返す", () => {
  const schemaCols = [COL_SALES_DATE, COL_NAME];
  assert.deepEqual(mergeDisplayAndSchemaColumns([], schemaCols), schemaCols);
  assert.deepEqual(mergeDisplayAndSchemaColumns(null, schemaCols), schemaCols);
});

test("mergeDisplayAndSchemaColumns: schema 列が空なら表示列をそのまま返す", () => {
  const cols = [COL_SALES_DATE, META_NO];
  assert.deepEqual(mergeDisplayAndSchemaColumns(cols, []), cols);
  assert.deepEqual(mergeDisplayAndSchemaColumns(cols, null), cols);
  assert.deepEqual(mergeDisplayAndSchemaColumns([], null), []);
});

test("mergeDisplayAndSchemaColumns: path / key の重複を表示列優先で除外する", () => {
  const HIDDEN_DUP_PATH = { key: "display:販売日", path: "販売日", sourceType: "date", searchable: true };
  const HIDDEN_DUP_KEY = { key: "modifiedAt", searchable: true };
  const HIDDEN_NEW = { key: "display:備考", path: "備考", sourceType: "text", searchable: true };
  const merged = mergeDisplayAndSchemaColumns(
    [COL_SALES_DATE, META_MODIFIED],
    [HIDDEN_DUP_PATH, HIDDEN_DUP_KEY, HIDDEN_NEW],
  );
  assert.equal(merged.length, 3);
  assert.equal(merged[0], COL_SALES_DATE);
  assert.equal(merged[1], META_MODIFIED);
  assert.equal(merged[2], HIDDEN_NEW);
});

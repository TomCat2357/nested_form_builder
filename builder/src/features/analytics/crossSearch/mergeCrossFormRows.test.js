import test from "node:test";
import assert from "node:assert/strict";
import { mergeCrossFormRows, crossRecordKey } from "./mergeCrossFormRows.js";
import { buildCrossSearchColumns, CROSS_SEARCH_FORM_NAME_KEY } from "./crossSearchTable.js";

const cfsColumns = [
  { path: "氏名", type: "text" },
  { path: "年齢", type: "number" },
];

test("buildCrossSearchColumns: フォーム名列が最左、検索列にはフォーム名を含めない", () => {
  const { displayColumns, searchColumns } = buildCrossSearchColumns(cfsColumns);
  assert.equal(displayColumns[0].key, CROSS_SEARCH_FORM_NAME_KEY);
  assert.ok(!searchColumns.some((c) => c.key === CROSS_SEARCH_FORM_NAME_KEY));
  // CFS 列が両方に含まれる
  assert.ok(displayColumns.some((c) => c.path === "氏名"));
  assert.ok(searchColumns.some((c) => c.path === "年齢"));
});

test("mergeCrossFormRows: 同一パスを 1 列に統合し、無い列は空欄・出自を持つ", () => {
  const { displayColumns } = buildCrossSearchColumns(cfsColumns);
  const perForm = [
    { formId: "A", formName: "申込", entries: [{ id: "a1", data: { "氏名": "田中", "年齢": 30 } }] },
    { formId: "B", formName: "問合せ", entries: [{ id: "b1", data: { "氏名": "佐藤" } }] }, // 年齢なし
  ];
  const records = mergeCrossFormRows(perForm, displayColumns);
  assert.equal(records.length, 2);

  const [recA, recB] = records;
  // 出自
  assert.equal(recA.entry.__formName, "申込");
  assert.equal(recA.formId, "A");
  assert.equal(recA.values[CROSS_SEARCH_FORM_NAME_KEY].display, "申込");
  assert.equal(recB.values[CROSS_SEARCH_FORM_NAME_KEY].display, "問合せ");

  // 同一パスは同じ列キーに統合され、各レコードは自分のフォームの値を入れる
  assert.equal(recA.values["display:氏名"].display, "田中");
  assert.equal(recB.values["display:氏名"].display, "佐藤");
  // B には「年齢」列が無い → 空欄
  assert.equal(recA.values["display:年齢"].display, "30");
  assert.equal(recB.values["display:年齢"].display, "");

  // rk はフォーム横断で一意
  assert.equal(recA.rk, crossRecordKey("A", "a1"));
  assert.notEqual(recA.rk, recB.rk);
});

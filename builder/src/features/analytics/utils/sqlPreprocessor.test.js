import assert from "node:assert/strict";
import test from "node:test";
import { preprocessSql, canonicalFormAlias } from "./sqlPreprocessor.js";
import { buildFormIndex } from "./formIdentifierResolver.js";
import { buildColumnIndex } from "./columnIdentifierResolver.js";

const formA = {
  id: "f_complaint",
  settings: { formTitle: "苦情データ" },
  createdAtUnixMs: 1000,
  schema: [
    { id: "f_auto_dt", type: "date", label: "受付日" },
    {
      id: "f_auto_grp",
      type: "group",
      label: "基本情報",
      children: [{ id: "f_auto_ku", type: "text", label: "区" }],
    },
  ],
};
const formB = {
  id: "f_other",
  settings: { formTitle: "別フォーム" },
  createdAtUnixMs: 2000,
  schema: [{ id: "f_auto_xx", type: "text", label: "備考" }],
};

const formIndex = buildFormIndex([formA, formB]);
const columnIndexes = {
  [formA.id]: buildColumnIndex(formA),
  [formB.id]: buildColumnIndex(formB),
};
const getColumnIndex = (fid) => columnIndexes[fid] || null;

test("修飾なし列はデフォルトフォームの schema から AlaSQL キーに解決", () => {
  const r = preprocessSql("SELECT [基本情報|区] FROM [data]", {
    defaultFormId: formA.id, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  assert.match(r.transformedSql, /\[基本情報__区\]/);
});

test("field.id を列指定としても解決", () => {
  const r = preprocessSql("SELECT [f_auto_ku] FROM [data]", {
    defaultFormId: formA.id, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  assert.match(r.transformedSql, /\[基本情報__区\]/);
});

test("FROM [フォーム名] が canonical alias に置換される", () => {
  const r = preprocessSql("SELECT * FROM [苦情データ]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  const canon = canonicalFormAlias(formA.id);
  assert.match(r.transformedSql, new RegExp("FROM " + canon + " AS " + canon));
  assert.deepEqual(r.referencedFormIds, [formA.id]);
});

test("FROM [フォームID] でも解決される", () => {
  const r = preprocessSql("SELECT * FROM [f_complaint]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.referencedFormIds, [formA.id]);
});

test("FROM [name] AS f, alias.[col] を解決", () => {
  const r = preprocessSql("SELECT f.[基本情報|区] FROM [苦情データ] AS f", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  assert.match(r.transformedSql, /f\.\[基本情報__区\]/);
});

test("[Form].[Col] 修飾形式を解決", () => {
  const r = preprocessSql("SELECT [苦情データ].[受付日] FROM [苦情データ]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  const canon = canonicalFormAlias(formA.id);
  assert.match(r.transformedSql, new RegExp(canon + "\\.\\[受付日\\]"));
});

test("複数フォームの JOIN で referencedFormIds が両方含まれる", () => {
  const r = preprocessSql(
    "SELECT a.[基本情報|区], b.[備考] FROM [苦情データ] AS a JOIN [別フォーム] AS b ON a.[id] = b.[id]",
    { defaultFormId: formA.id, formIndex, getColumnIndex }
  );
  assert.equal(r.ok, true);
  assert.equal(r.referencedFormIds.length, 2);
  assert.ok(r.referencedFormIds.includes(formA.id));
  assert.ok(r.referencedFormIds.includes(formB.id));
});

test("未定義フォーム参照はエラーを返す", () => {
  const r = preprocessSql("SELECT * FROM [存在しないフォーム]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /未定義のフォーム/);
});

test("文字列リテラル内の [...] は変換しない", () => {
  const r = preprocessSql("SELECT * FROM [data] WHERE name = '[基本情報|区]'", {
    defaultFormId: formA.id, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  assert.match(r.transformedSql, /'\[基本情報\|区\]'/);
});

test("既存 SQL (ブラケットなし) はそのまま動く", () => {
  const r = preprocessSql("SELECT createdAt, COUNT(*) AS count FROM data GROUP BY createdAt", {
    defaultFormId: formA.id, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  assert.match(r.transformedSql, /SELECT createdAt, COUNT/);
  assert.match(r.transformedSql, /FROM data/);
});

test("デフォルトフォームを指定すれば referencedFormIds に含まれる", () => {
  const r = preprocessSql("SELECT [count] FROM data", {
    defaultFormId: formA.id, formIndex, getColumnIndex,
  });
  assert.deepEqual(r.referencedFormIds, [formA.id]);
});

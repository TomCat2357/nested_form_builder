import assert from "node:assert/strict";
import test from "node:test";
import {
  preprocessSql,
  canonicalFormAlias,
  canonicalDataAlias,
  canonicalViewAlias,
  legacyFormAlias,
} from "./sqlPreprocessor.js";
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

test("FROM `フォーム名` が canonical alias に置換される（バッククォート）", () => {
  const r = preprocessSql("SELECT * FROM `苦情データ`", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  const canon = canonicalFormAlias(formA.id);
  assert.match(r.transformedSql, new RegExp("FROM " + canon + " AS " + canon));
  assert.deepEqual(r.referencedFormIds, [formA.id]);
});

test("FROM `name` AS f, alias.`col` を解決（バッククォート）", () => {
  const r = preprocessSql("SELECT f.`基本情報|区` FROM `苦情データ` AS f", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  assert.match(r.transformedSql, /f\.\[基本情報__区\]/);
});

test("`Form`.`Col` 修飾形式を解決（バッククォート）", () => {
  const r = preprocessSql("SELECT `苦情データ`.`受付日` FROM `苦情データ`", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  const canon = canonicalFormAlias(formA.id);
  assert.match(r.transformedSql, new RegExp(canon + "\\.\\[受付日\\]"));
});

test("バッククォートと角括弧の混在で動く", () => {
  const r = preprocessSql("SELECT a.`基本情報|区`, b.[備考] FROM [苦情データ] AS a JOIN `別フォーム` AS b ON a.[id] = b.[id]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  assert.equal(r.referencedFormIds.length, 2);
  assert.ok(r.referencedFormIds.includes(formA.id));
  assert.ok(r.referencedFormIds.includes(formB.id));
});

test("FROM [data] GROUP BY ... — 後続の SQL 予約語をエイリアスとして食わない", () => {
  const r = preprocessSql("SELECT [基本情報|区], COUNT(*) AS c FROM [data] GROUP BY [基本情報|区]", {
    defaultFormId: formA.id, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  // GROUP がエイリアスとして取り込まれていれば `AS GROUP` が現れて AlaSQL で構文エラーになる。
  assert.doesNotMatch(r.transformedSql, /\bAS\s+GROUP\b/i);
  assert.match(r.transformedSql, /FROM data\s+GROUP BY/i);
});

test("FROM `フォーム名` の直後に GROUP BY が来てもパースエラーにならない", () => {
  const r = preprocessSql("SELECT * FROM `苦情データ` GROUP BY [基本情報|区]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  const canon = canonicalFormAlias(formA.id);
  // canonical alias 自身は付与されるが、その後ろに GROUP BY が温存されている必要がある。
  assert.match(r.transformedSql, new RegExp("FROM " + canon + " AS " + canon + "\\s+GROUP BY"));
});

test("FROM [data] WHERE / ORDER BY / LIMIT もエイリアス扱いしない", () => {
  for (const kw of ["WHERE x = 1", "ORDER BY x", "LIMIT 5", "HAVING COUNT(*) > 0"]) {
    const r = preprocessSql("SELECT * FROM [data] " + kw, {
      defaultFormId: formA.id, formIndex, getColumnIndex,
    });
    assert.equal(r.ok, true, kw);
    const head = kw.split(/\s/)[0];
    assert.doesNotMatch(r.transformedSql, new RegExp("\\bAS\\s+" + head + "\\b", "i"));
  }
});

test("文字列リテラル内のバッククォートは変換しない", () => {
  const r = preprocessSql("SELECT * FROM [data] WHERE name = '`基本情報|区`'", {
    defaultFormId: formA.id, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  assert.match(r.transformedSql, /'`基本情報\|区`'/);
});

// ---- variant suffix（:data / :view）と canonical alias ----

test("canonicalFormAlias は canonicalDataAlias の別名（後方互換）", () => {
  assert.equal(canonicalFormAlias(formA.id), canonicalDataAlias(formA.id));
});

test("canonicalDataAlias / canonicalViewAlias は data_<id> / view_<id>", () => {
  assert.equal(canonicalDataAlias("f_x"), "data_f_x");
  assert.equal(canonicalViewAlias("f_x"), "view_f_x");
  assert.equal(legacyFormAlias("f_x"), "form_f_x");
});

test("FROM [タイトル:view] は view_<id> に置換され variant=view が referencedSources に乗る", () => {
  const r = preprocessSql("SELECT * FROM [苦情データ:view]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  const canon = canonicalViewAlias(formA.id);
  assert.match(r.transformedSql, new RegExp("FROM " + canon + " AS " + canon));
  assert.deepEqual(r.referencedSources, [{ formId: formA.id, variant: "view" }]);
});

test("FROM [タイトル:data] は data_<id> に置換され variant=data が referencedSources に乗る", () => {
  const r = preprocessSql("SELECT * FROM [苦情データ:data]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  const canon = canonicalDataAlias(formA.id);
  assert.match(r.transformedSql, new RegExp("FROM " + canon + " AS " + canon));
  assert.deepEqual(r.referencedSources, [{ formId: formA.id, variant: "data" }]);
});

test("FROM [タイトル] は variant=data として解決される（既定）", () => {
  const r = preprocessSql("SELECT * FROM [苦情データ]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.referencedSources, [{ formId: formA.id, variant: "data" }]);
});

test("同一フォームを data / view 両方で参照したら referencedSources に 2 つ乗る", () => {
  const r = preprocessSql(
    "SELECT * FROM [苦情データ] AS d JOIN [苦情データ:view] AS v ON d.[id] = v.[id]",
    { defaultFormId: null, formIndex, getColumnIndex }
  );
  assert.equal(r.ok, true);
  assert.equal(r.referencedSources.length, 2);
  const variants = r.referencedSources.map((s) => s.variant).sort();
  assert.deepEqual(variants, ["data", "view"]);
  // referencedFormIds は formId 単位の dedup なので 1 つだけ
  assert.deepEqual(r.referencedFormIds, [formA.id]);
});

test("FROM view_<id> をそのまま書いても variant=view として解決される（default form）", () => {
  const canonView = canonicalViewAlias(formA.id);
  const r = preprocessSql("SELECT * FROM " + canonView, {
    defaultFormId: formA.id, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  assert.match(r.transformedSql, new RegExp("FROM " + canonView));
  // default form は data / view 両方が登録されているので referencedSources に view が含まれる
  assert.ok(r.referencedSources.some((s) => s.variant === "view" && s.formId === formA.id));
});

test("FROM form_<id>（旧 canonical）は data variant の後方互換 alias", () => {
  const legacy = legacyFormAlias(formA.id);
  const r = preprocessSql("SELECT * FROM " + legacy, {
    defaultFormId: formA.id, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  assert.match(r.transformedSql, new RegExp("FROM " + legacy));
});

test("[Form:view].[Col] 修飾形式（Pass 2）も variant を解釈", () => {
  const r = preprocessSql("SELECT [苦情データ:view].[受付日] FROM [苦情データ:view]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  const canonView = canonicalViewAlias(formA.id);
  assert.match(r.transformedSql, new RegExp(canonView + "\\.\\[受付日\\]"));
  assert.deepEqual(r.referencedSources, [{ formId: formA.id, variant: "view" }]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  preprocessSql,
  canonicalFormAlias,
  canonicalDataAlias,
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

// allowedFormIds: 置換 full-query は自フォームのみ参照可（runFullQuery が {defaultFormId} を渡す）。
// 未指定なら全許可（検索 / Question / Dashboard は従来どおり）。
test("allowedFormIds: 範囲外フォームの FROM はエラー（明確メッセージ）", () => {
  const r = preprocessSql("SELECT * FROM [別フォーム]", {
    defaultFormId: formA.id, formIndex, getColumnIndex,
    allowedFormIds: new Set([formA.id]),
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("参照できません")), r.errors.join(" / "));
});

test("allowedFormIds: _form（自フォーム）は常に許可", () => {
  const r = preprocessSql("SELECT [基本情報|区] FROM _form WHERE [id] = 'x'", {
    defaultFormId: formA.id, formIndex, getColumnIndex,
    allowedFormIds: new Set([formA.id]),
  });
  assert.equal(r.ok, true, r.errors.join(" / "));
  assert.match(r.transformedSql, /\[基本情報__区\]/);
});

test("allowedFormIds: [別フォーム].[列] 修飾参照も範囲外ならエラー", () => {
  const r = preprocessSql("SELECT [別フォーム].[備考] FROM _form", {
    defaultFormId: formA.id, formIndex, getColumnIndex,
    allowedFormIds: new Set([formA.id]),
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("参照できません")), r.errors.join(" / "));
});

test("allowedFormIds 未指定なら他フォーム参照は従来どおり可（回帰ガード）", () => {
  const r = preprocessSql("SELECT * FROM [別フォーム]", {
    defaultFormId: formA.id, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true, r.errors.join(" / "));
  assert.equal(r.referencedFormIds.includes(formB.id), true);
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

test("親子 JOIN: pid 修飾参照が解決され referencedFormIds に両フォーム乗る", () => {
  const r = preprocessSql(
    "SELECT p.`基本情報|区`, COUNT(c.`id`) AS 件数 FROM `苦情データ` AS p LEFT JOIN `別フォーム` AS c ON c.`pid` = p.`id` GROUP BY p.`id`",
    { defaultFormId: formA.id, formIndex, getColumnIndex }
  );
  assert.equal(r.ok, true);
  // pid は既知メタ列として c.[pid] に解決される（未定義列の素通しではなく FIXED_PATHS 経由）。
  assert.match(r.transformedSql, /c\.\[pid\]/);
  assert.match(r.transformedSql, /p\.\[id\]/);
  assert.equal(r.referencedFormIds.length, 2);
  assert.ok(r.referencedFormIds.includes(formA.id));
  assert.ok(r.referencedFormIds.includes(formB.id));
});

test("検索 SQL モード: FROM _form は現フォーム（defaultFormId）の canonical を AS _form で貼る", () => {
  const r = preprocessSql("SELECT * FROM _form", {
    defaultFormId: formA.id, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  const canon = canonicalDataAlias(formA.id);
  assert.match(r.transformedSql, new RegExp("FROM " + canon + " AS _form"));
  assert.deepEqual(r.referencedFormIds, [formA.id]);
});

test("検索 SQL モード: _form.[col] は _form alias 修飾で解決される", () => {
  const r = preprocessSql("SELECT _form.`基本情報|区` FROM _form", {
    defaultFormId: formA.id, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  assert.match(r.transformedSql, /_form\.\[基本情報__区\]/);
});

test("検索 SQL モード: サブクエリで別フォームの pid を参照（横断フィルタ）", () => {
  const r = preprocessSql(
    "SELECT * FROM _form WHERE `id` IN (SELECT `pid` FROM `別フォーム`)",
    { defaultFormId: formA.id, formIndex, getColumnIndex }
  );
  assert.equal(r.ok, true);
  // 現フォームと子フォームの両方が referencedFormIds に乗る（子は自動登録対象）。
  assert.ok(r.referencedFormIds.includes(formA.id));
  assert.ok(r.referencedFormIds.includes(formB.id));
  // サブクエリの FROM 別フォーム → canonical、pid は既知メタ列として解決。
  assert.match(r.transformedSql, new RegExp("FROM " + canonicalDataAlias(formB.id)));
  assert.match(r.transformedSql, /\[pid\]/);
});

test("旧 FROM _ は廃止され未定義フォーム扱いでエラー", () => {
  const r = preprocessSql("SELECT * FROM _", {
    defaultFormId: formA.id, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, false);
});

test("検索 SQL モード: defaultFormId 未指定で FROM _form はエラー", () => {
  const r = preprocessSql("SELECT * FROM _form", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /_form/);
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

// ---- canonical alias と :view/:data suffix の廃止 ----

test("canonicalFormAlias は canonicalDataAlias の別名（後方互換）", () => {
  assert.equal(canonicalFormAlias(formA.id), canonicalDataAlias(formA.id));
});

test("canonicalDataAlias / legacyFormAlias は data_<id> / form_<id>", () => {
  assert.equal(canonicalDataAlias("f_x"), "data_f_x");
  assert.equal(legacyFormAlias("f_x"), "form_f_x");
});

test("FROM [タイトル] は data_<id> に置換され referencedFormIds に乗る", () => {
  const r = preprocessSql("SELECT * FROM [苦情データ]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  const canon = canonicalDataAlias(formA.id);
  assert.match(r.transformedSql, new RegExp("FROM " + canon + " AS " + canon));
  assert.deepEqual(r.referencedFormIds, [formA.id]);
});

test(":view / :data suffix は廃止：FROM [タイトル:view] / [タイトル:data] は未定義フォームとしてエラー", () => {
  const rv = preprocessSql("SELECT * FROM [苦情データ:view]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(rv.ok, false);
  assert.ok(rv.errors.some((e) => e.includes("苦情データ:view")));

  const rd = preprocessSql("SELECT * FROM [苦情データ:data]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(rd.ok, false);
  assert.ok(rd.errors.some((e) => e.includes("苦情データ:data")));
});

test("FROM form_<id>（旧 canonical）は後方互換 alias として解決される", () => {
  const legacy = legacyFormAlias(formA.id);
  const r = preprocessSql("SELECT * FROM " + legacy, {
    defaultFormId: formA.id, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  assert.match(r.transformedSql, new RegExp("FROM " + legacy));
});

test("[Form].[Col] 修飾形式（Pass 2）は data_<id> に解決される", () => {
  const r = preprocessSql("SELECT [苦情データ].[受付日] FROM [苦情データ]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, true);
  const canon = canonicalDataAlias(formA.id);
  assert.match(r.transformedSql, new RegExp(canon + "\\.\\[受付日\\]"));
  assert.deepEqual(r.referencedFormIds, [formA.id]);
});

test("[Form:view].[Col] 修飾形式も :view 廃止でエラー", () => {
  const r = preprocessSql("SELECT [苦情データ:view].[受付日] FROM [苦情データ:view]", {
    defaultFormId: null, formIndex, getColumnIndex,
  });
  assert.equal(r.ok, false);
});

test("FROM [フォルダ/フォーム名] はフォルダ込みで解決し、同名バレ名は曖昧エラー", () => {
  const fa = { id: "fa", settings: { formTitle: "苦情データ" }, folder: "受付", createdAtUnixMs: 1, schema: [{ id: "x", type: "text", label: "X" }] };
  const fb = { id: "fb", settings: { formTitle: "苦情データ" }, folder: "営業", createdAtUnixMs: 2, schema: [{ id: "y", type: "text", label: "Y" }] };
  const idx = buildFormIndex([fa, fb]);
  const gci = (fid) => (fid === "fa" ? buildColumnIndex(fa) : fid === "fb" ? buildColumnIndex(fb) : null);

  // フォルダ込み名 → 一意に解決。
  const ok = preprocessSql("SELECT * FROM [受付/苦情データ]", { defaultFormId: null, formIndex: idx, getColumnIndex: gci });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.referencedFormIds, ["fa"]);
  assert.match(ok.transformedSql, new RegExp("FROM " + canonicalDataAlias("fa")));

  // バレ名（同名複数）→ エラー（フォルダ込み指定を促す）。
  const bad = preprocessSql("SELECT * FROM [苦情データ]", { defaultFormId: null, formIndex: idx, getColumnIndex: gci });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0], /フォルダ込みで指定/);
});

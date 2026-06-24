import assert from "node:assert/strict";
import test from "node:test";
import {
  formRefsToIds,
  formRefsToNames,
  collectFormRefIds,
  canonicalAliasToName,
  templateFormRefsToIds,
  templateFormRefsToNames,
  schemaTemplateFormRefsToIds,
  schemaTemplateFormRefsToNames,
  settingsTemplateFormRefsToIds,
  settingsTemplateFormRefsToNames,
  refreshFormLinkPaths,
} from "./rewriteSqlFormRefs.js";
import { buildFormIndex } from "./formIdentifierResolver.js";

// 苦情データ（フォルダなし）, 別フォーム（フォルダなし）, さらにフォルダ込みフォームを用意。
const formA = {
  id: "f_complaint",
  settings: { formTitle: "苦情データ" },
  createdAtUnixMs: 1000,
};
const formB = {
  id: "f_other",
  settings: { formTitle: "別フォーム" },
  createdAtUnixMs: 2000,
};
const formC = {
  id: "f_in_folder",
  folder: "相談",
  settings: { formTitle: "対応一覧" },
  createdAtUnixMs: 3000,
};

const formIndex = buildFormIndex([formA, formB, formC]);

test("formRefsToIds: FROM [フォーム名] が fileId に置換される", () => {
  const out = formRefsToIds("SELECT * FROM [苦情データ]", formIndex);
  assert.equal(out, "SELECT * FROM [f_complaint]");
});

test("formRefsToIds: JOIN と AS エイリアスを保持しつつ置換", () => {
  const out = formRefsToIds(
    "SELECT * FROM [苦情データ] AS a JOIN [別フォーム] AS b ON a.[x] = b.[y]",
    formIndex,
  );
  assert.equal(
    out,
    "SELECT * FROM [f_complaint] AS a JOIN [f_other] AS b ON a.[x] = b.[y]",
  );
});

test("formRefsToIds: フォルダ込み名 ([相談/対応一覧]) も置換", () => {
  const out = formRefsToIds("SELECT * FROM [相談/対応一覧]", formIndex);
  assert.equal(out, "SELECT * FROM [f_in_folder]");
});

test("formRefsToIds: 修飾付き列参照 [フォーム].[列] の先頭だけ置換（列は不変）", () => {
  const out = formRefsToIds("SELECT [苦情データ].[基本情報|区] FROM [苦情データ]", formIndex);
  assert.equal(out, "SELECT [f_complaint].[基本情報|区] FROM [f_complaint]");
});

test("formRefsToIds: バッククォート参照も fileId 化（[...] に正規化）", () => {
  const out = formRefsToIds("SELECT * FROM `苦情データ`", formIndex);
  assert.equal(out, "SELECT * FROM [f_complaint]");
});

test("formRefsToIds: 既に fileId のときは不変（冪等）", () => {
  const out = formRefsToIds("SELECT * FROM [f_complaint]", formIndex);
  assert.equal(out, "SELECT * FROM [f_complaint]");
});

test("formRefsToIds: [data] エイリアスや未定義フォームは素通し", () => {
  const out = formRefsToIds("SELECT * FROM [data] JOIN [存在しない] AS z ON 1=1", formIndex);
  assert.equal(out, "SELECT * FROM [data] JOIN [存在しない] AS z ON 1=1");
});

test("formRefsToIds: 文字列リテラル / コメント内の FROM [名前] は不変", () => {
  const sql = [
    "SELECT '[苦情データ]' AS lit",  // リテラル
    "-- FROM [苦情データ]",          // 行コメント
    "/* JOIN [別フォーム] */",        // ブロックコメント
    "FROM [苦情データ]",             // 本物だけ置換される
  ].join("\n");
  const out = formRefsToIds(sql, formIndex);
  assert.match(out, /'\[苦情データ\]' AS lit/);
  assert.match(out, /-- FROM \[苦情データ\]/);
  assert.match(out, /\/\* JOIN \[別フォーム\] \*\//);
  assert.match(out, /FROM \[f_complaint\]/);
});

test("formRefsToNames: FROM [fileId] がフォーム名に戻る", () => {
  const out = formRefsToNames("SELECT * FROM [f_complaint]", formIndex);
  assert.equal(out, "SELECT * FROM [苦情データ]");
});

test("formRefsToNames: フォルダ込みフォームは folder/title 形式に戻る", () => {
  const out = formRefsToNames("SELECT * FROM [f_in_folder]", formIndex);
  assert.equal(out, "SELECT * FROM [相談/対応一覧]");
});

test("formRefsToNames: 既に名前 / data / 未知トークンは素通し", () => {
  const out = formRefsToNames("SELECT * FROM [苦情データ] JOIN [data] ON 1=1", formIndex);
  assert.equal(out, "SELECT * FROM [苦情データ] JOIN [data] ON 1=1");
});

test("formRefsToNames: 修飾付き列参照 [fileId].[列] の先頭だけ戻す", () => {
  const out = formRefsToNames("SELECT [f_complaint].[基本情報|区] FROM [f_complaint]", formIndex);
  assert.equal(out, "SELECT [苦情データ].[基本情報|区] FROM [苦情データ]");
});

test("往復安定: 名前 → ID → 名前 で元に戻る", () => {
  const original = "SELECT [苦情データ].[基本情報|区] FROM [苦情データ] AS a JOIN [相談/対応一覧] AS b ON 1=1";
  const ids = formRefsToIds(original, formIndex);
  const back = formRefsToNames(ids, formIndex);
  assert.equal(back, original);
});

test("往復安定: ID → 名前 → ID で元に戻る", () => {
  const stored = "SELECT * FROM [f_complaint] JOIN [f_in_folder] AS b ON 1=1";
  const names = formRefsToNames(stored, formIndex);
  const ids = formRefsToIds(names, formIndex);
  assert.equal(ids, stored);
});

// ---------------------------------------------------------------------------
// collectFormRefIds（保存時に SQL のフォーム参照 fileId を出現順・重複なしで収集）
// ---------------------------------------------------------------------------

test("collectFormRefIds: FROM [フォーム名] の fileId を収集", () => {
  assert.deepEqual(collectFormRefIds("SELECT * FROM [苦情データ]", formIndex), ["f_complaint"]);
});

test("collectFormRefIds: FROM/JOIN を出現順で収集", () => {
  const out = collectFormRefIds(
    "SELECT * FROM [苦情データ] AS a JOIN [別フォーム] AS b ON a.[x] = b.[y]",
    formIndex,
  );
  assert.deepEqual(out, ["f_complaint", "f_other"]);
});

test("collectFormRefIds: 修飾付き列参照と FROM の重複は除去（1 件）", () => {
  const out = collectFormRefIds("SELECT [苦情データ].[基本情報|区] FROM [苦情データ]", formIndex);
  assert.deepEqual(out, ["f_complaint"]);
});

test("collectFormRefIds: フォルダ込み名・既に fileId のときも解決して収集（冪等）", () => {
  assert.deepEqual(collectFormRefIds("SELECT * FROM [相談/対応一覧]", formIndex), ["f_in_folder"]);
  assert.deepEqual(collectFormRefIds("SELECT * FROM [f_complaint]", formIndex), ["f_complaint"]);
});

test("collectFormRefIds: data エイリアス・未定義フォーム・リテラル/コメントは拾わない", () => {
  const sql = [
    "SELECT '[苦情データ]' AS lit",   // リテラル
    "-- FROM [別フォーム]",            // 行コメント
    "FROM [data] JOIN [存在しない] ON 1=1", // data/未定義
  ].join("\n");
  assert.deepEqual(collectFormRefIds(sql, formIndex), []);
});

test("collectFormRefIds: 空 / null は空配列", () => {
  assert.deepEqual(collectFormRefIds("", formIndex), []);
  assert.deepEqual(collectFormRefIds(null, formIndex), []);
});

test("canonicalAliasToName: GUI→SQL の FROM data_<id> が [フォーム名] になる", () => {
  const out = canonicalAliasToName(
    "SELECT COUNT(*) AS [件数] FROM data_f_complaint",
    "f_complaint",
    formIndex,
  );
  assert.equal(out, "SELECT COUNT(*) AS [件数] FROM [苦情データ]");
});

test("canonicalAliasToName: フォルダ込みフォームは folder/title 形式で表示", () => {
  const out = canonicalAliasToName(
    "SELECT * FROM data_f_in_folder WHERE [x] = 1",
    "f_in_folder",
    formIndex,
  );
  assert.equal(out, "SELECT * FROM [相談/対応一覧] WHERE [x] = 1");
});

test("canonicalAliasToName→保存(formRefsToIds): [フォーム名] が fileId に戻る（往復）", () => {
  const compiled = "SELECT COUNT(*) AS [件数] FROM data_f_complaint";
  const display = canonicalAliasToName(compiled, "f_complaint", formIndex);
  assert.equal(display, "SELECT COUNT(*) AS [件数] FROM [苦情データ]");
  const saved = formRefsToIds(display, formIndex);
  assert.equal(saved, "SELECT COUNT(*) AS [件数] FROM [f_complaint]");
});

test("canonicalAliasToName: SELECT の列名に紛れた data_ 風トークンは触らない", () => {
  // FROM 句以外（列名など）にある data_f_complaint は置換対象外。
  const out = canonicalAliasToName(
    "SELECT [data_f_complaint_label] FROM data_f_complaint",
    "f_complaint",
    formIndex,
  );
  assert.equal(out, "SELECT [data_f_complaint_label] FROM [苦情データ]");
});

test("空 / null SQL は素通し", () => {
  assert.equal(formRefsToIds("", formIndex), "");
  assert.equal(formRefsToNames(null, formIndex), "");
});

// ---------------------------------------------------------------------------
// テンプレート文字列中の full-query トークン書換（templateFormRefsToIds/Names）
// ---------------------------------------------------------------------------

test("templateFormRefsToIds: full-query の FROM だけ fileId 化・列は不変・空白保持", () => {
  const tpl = "{{ SELECT [氏名] FROM [相談/対応一覧] ORDER BY [代表的個人] DESC LIMIT 1 }}";
  const out = templateFormRefsToIds(tpl, formIndex);
  assert.equal(out, "{{ SELECT [氏名] FROM [f_in_folder] ORDER BY [代表的個人] DESC LIMIT 1 }}");
});

test("templateFormRefsToNames: full-query の FROM [fileId] が論理パスに戻る", () => {
  const tpl = "{{ SELECT [氏名] FROM [f_in_folder] ORDER BY [代表的個人] DESC LIMIT 1 }}";
  const out = templateFormRefsToNames(tpl, formIndex);
  assert.equal(out, "{{ SELECT [氏名] FROM [相談/対応一覧] ORDER BY [代表的個人] DESC LIMIT 1 }}");
});

test("templateFormRefs: 往復安定（パス→ID→パス / ID→名前→ID）", () => {
  const path = "結果は {{ SELECT [氏名] FROM [相談/対応一覧] LIMIT 1 }} です";
  const ids = templateFormRefsToIds(path, formIndex);
  assert.equal(templateFormRefsToNames(ids, formIndex), path);
  const stored = "{{ SELECT * FROM [f_complaint] }}";
  const names = templateFormRefsToNames(stored, formIndex);
  assert.equal(templateFormRefsToIds(names, formIndex), stored);
});

test("templateFormRefs: 非 full-query トークン（式）と地のテキストは逐語不変", () => {
  const tpl = "こんにちは {{ `氏名` }} 様、件数は {{ COUNT(`x`) }} 件";
  assert.equal(templateFormRefsToIds(tpl, formIndex), tpl);
  assert.equal(templateFormRefsToNames(tpl, formIndex), tpl);
});

test("templateFormRefs: 式トークンと full-query が混在しても full-query だけ書換", () => {
  const tpl = "{{ `氏名` }} / {{ SELECT * FROM [苦情データ] }} / 末尾";
  const out = templateFormRefsToIds(tpl, formIndex);
  assert.equal(out, "{{ `氏名` }} / {{ SELECT * FROM [f_complaint] }} / 末尾");
});

test("templateFormRefs: 著者エスケープ \\{ \\} は逐語保持", () => {
  const tpl = "\\{ そのまま \\} {{ SELECT * FROM [苦情データ] }}";
  const out = templateFormRefsToIds(tpl, formIndex);
  assert.equal(out, "\\{ そのまま \\} {{ SELECT * FROM [f_complaint] }}");
});

test("templateFormRefs: 未解決フォーム参照は両方向で素通し", () => {
  const tpl = "{{ SELECT * FROM [存在しない] }}";
  assert.equal(templateFormRefsToIds(tpl, formIndex), tpl);
  assert.equal(templateFormRefsToNames(tpl, formIndex), tpl);
});

test("templateFormRefs: SELECT 内文字列リテラルの [名前] は書換えない（マスク継承）", () => {
  const tpl = "{{ SELECT '[苦情データ]' AS lit FROM [苦情データ] }}";
  const out = templateFormRefsToIds(tpl, formIndex);
  assert.equal(out, "{{ SELECT '[苦情データ]' AS lit FROM [f_complaint] }}");
});

test("templateFormRefs: 修飾付き列参照 [フォーム].[列] の先頭だけ書換", () => {
  const tpl = "{{ SELECT [苦情データ].[基本情報|区] FROM [苦情データ] }}";
  const out = templateFormRefsToIds(tpl, formIndex);
  assert.equal(out, "{{ SELECT [f_complaint].[基本情報|区] FROM [f_complaint] }}");
});

test("templateFormRefs: 空 / null / ブレース無しは素通し・冪等", () => {
  assert.equal(templateFormRefsToIds("", formIndex), "");
  assert.equal(templateFormRefsToNames(null, formIndex), "");
  assert.equal(templateFormRefsToIds("ただの文字列", formIndex), "ただの文字列");
  const once = templateFormRefsToIds("{{ SELECT * FROM [苦情データ] }}", formIndex);
  assert.equal(templateFormRefsToIds(once, formIndex), once);
});

// ---------------------------------------------------------------------------
// スキーマ / 設定ウォーカー
// ---------------------------------------------------------------------------

const makeSchema = () => [
  { id: "s1", type: "substitution", templateText: "{{ SELECT [氏名] FROM [相談/対応一覧] LIMIT 1 }}" },
  {
    id: "p1",
    type: "printTemplate",
    printTemplateAction: {
      outputType: "gmail",
      gmailTemplateSubject: "{{ SELECT [件名] FROM [苦情データ] LIMIT 1 }}",
      fileNameTemplate: "{`_id`}",
    },
  },
  {
    id: "r1",
    type: "radio",
    options: [{ id: "o1", label: "A" }],
    childrenByValue: {
      A: [{ id: "s2", type: "substitution", templateText: "{{ SELECT * FROM [苦情データ] }}" }],
    },
  },
];

test("schemaTemplateFormRefsToIds: 全テンプレ（ネスト込み）の FROM を fileId 化・入力非破壊", () => {
  const schema = makeSchema();
  const out = schemaTemplateFormRefsToIds(schema, formIndex);
  assert.equal(out[0].templateText, "{{ SELECT [氏名] FROM [f_in_folder] LIMIT 1 }}");
  assert.equal(out[1].printTemplateAction.gmailTemplateSubject, "{{ SELECT [件名] FROM [f_complaint] LIMIT 1 }}");
  assert.equal(out[1].printTemplateAction.fileNameTemplate, "{`_id`}"); // full-query でない → 不変
  assert.equal(out[1].printTemplateAction.outputType, "gmail"); // 非テンプレキー不変
  assert.equal(out[2].childrenByValue.A[0].templateText, "{{ SELECT * FROM [f_complaint] }}");
  // 入力は非破壊
  assert.equal(schema[0].templateText, "{{ SELECT [氏名] FROM [相談/対応一覧] LIMIT 1 }}");
});

test("schemaTemplateFormRefs: 往復で元スキーマに戻る", () => {
  const schema = makeSchema();
  const ids = schemaTemplateFormRefsToIds(schema, formIndex);
  const back = schemaTemplateFormRefsToNames(ids, formIndex);
  assert.deepEqual(back, schema);
});

test("settingsTemplateFormRefs: standardPrintFileNameTemplate のみ書換・他キー不変・非破壊", () => {
  const settings = {
    standardPrintFileNameTemplate: "{{ SELECT [氏名] FROM [苦情データ] LIMIT 1 }}",
    theme: { primary: "#000" },
    externalActions: [{ label: "x", url: "https://e/?q=[苦情データ]" }],
  };
  const out = settingsTemplateFormRefsToIds(settings, formIndex);
  assert.equal(out.standardPrintFileNameTemplate, "{{ SELECT [氏名] FROM [f_complaint] LIMIT 1 }}");
  assert.deepEqual(out.theme, { primary: "#000" });
  assert.deepEqual(out.externalActions, settings.externalActions); // url は素の文字列で不変
  assert.equal(settings.standardPrintFileNameTemplate, "{{ SELECT [氏名] FROM [苦情データ] LIMIT 1 }}");
  // 往復
  assert.deepEqual(settingsTemplateFormRefsToNames(out, formIndex), settings);
});

// ---------------------------------------------------------------------------
// formLink 表示パス追従
// ---------------------------------------------------------------------------

test("refreshFormLinkPaths: childFormId から childFormPath を現在パスに再計算（childFormId 不変）", () => {
  const schema = [
    { id: "fl1", type: "formLink", childFormId: "f_in_folder", childFormPath: "古い/パス" },
    {
      id: "r1",
      type: "radio",
      options: [{ id: "o1", label: "A" }],
      childrenByValue: {
        A: [{ id: "fl2", type: "formLink", childFormId: "f_complaint", childFormPath: "stale" }],
      },
    },
  ];
  const out = refreshFormLinkPaths(schema, formIndex);
  assert.equal(out[0].childFormPath, "相談/対応一覧");
  assert.equal(out[0].childFormId, "f_in_folder");
  assert.equal(out[1].childrenByValue.A[0].childFormPath, "苦情データ");
  // 入力非破壊
  assert.equal(schema[0].childFormPath, "古い/パス");
});

test("refreshFormLinkPaths: 未解決 childFormId は childFormPath を維持", () => {
  const schema = [{ id: "fl1", type: "formLink", childFormId: "f_missing", childFormPath: "そのまま" }];
  const out = refreshFormLinkPaths(schema, formIndex);
  assert.equal(out[0].childFormPath, "そのまま");
  assert.equal(out[0].childFormId, "f_missing");
});

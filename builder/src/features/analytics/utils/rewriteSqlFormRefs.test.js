import assert from "node:assert/strict";
import test from "node:test";
import { formRefsToIds, formRefsToNames, canonicalAliasToName } from "./rewriteSqlFormRefs.js";
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

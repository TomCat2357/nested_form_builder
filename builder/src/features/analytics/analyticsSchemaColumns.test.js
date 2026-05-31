import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAlaSqlTypeMap,
  buildViewAlaSqlTypeMap,
  getFormColumns,
  getFormViewColumns,
} from "./analyticsSchemaColumns.js";

const FORM = {
  schema: [
    { id: "f1", type: "text", label: "氏名" },
    { id: "f2", type: "number", label: "金額" },
    { id: "f3", type: "date", label: "日付" },
    {
      id: "g1", type: "group", label: "詳細",
      children: [
        { id: "f4", type: "select", label: "区分" },
        { id: "f5", type: "checkboxes", label: "同意" },
      ],
    },
  ],
};

test("getFormColumns: key/alaSqlKey/path/label/type を返す（view 形式に一本化・選択肢は string）", () => {
  const cols = getFormColumns(FORM);
  const byKey = new Map(cols.map((c) => [c.key, c]));

  assert.equal(byKey.get("氏名").type, "string");
  assert.equal(byKey.get("金額").type, "number");
  assert.equal(byKey.get("日付").type, "date");
  assert.equal(byKey.get("詳細|区分").type, "string");
  // 選択肢は view 形式ではラベル文字列列＝string（旧 data 形式の boolean ではない）
  assert.equal(byKey.get("詳細|同意").type, "string");

  const meikan = byKey.get("氏名");
  assert.deepEqual(meikan.path, ["氏名"]);
  assert.equal(meikan.label, "氏名");
  assert.equal(typeof meikan.alaSqlKey, "string");

  assert.deepEqual(byKey.get("詳細|区分").path, ["詳細", "区分"]);
  assert.equal(byKey.get("詳細|区分").label, "区分");
});

test("getFormColumns: schema 無し / 不正でもメタ列は返す", () => {
  // view 形式に一本化されたため、schema が無くてもメタ列（6 列）は常に返る。
  assert.equal(getFormColumns(null).length, 6);
  assert.ok(getFormColumns(null).every((c) => c.isMeta));
  assert.equal(getFormColumns({}).length, 6);
  assert.equal(getFormColumns({ schema: "x" }).length, 6);
});

test("getFormColumns: 固定日付キー createdAt はメタ列として date 扱い", () => {
  const cols = getFormColumns({ schema: [{ id: "x", type: "date", label: "受付日" }] });
  const byKey = new Map(cols.map((c) => [c.key, c]));
  // メタ列 createdAt は date
  assert.equal(byKey.get("createdAt").type, "date");
  // schema 由来の date フィールドも date
  assert.equal(byKey.get("受付日").type, "date");
});

test("buildAlaSqlTypeMap: alaSqlKey → 正規化型のマップ（メタ列含む）", () => {
  const map = buildAlaSqlTypeMap(FORM);
  for (const v of map.values()) {
    assert.ok(["number", "date", "string", "unknown"].includes(v));
  }
  assert.ok(map.size >= 5);
  // view 形式に一本化されたため、form 無しでもメタ列（6 列）が出る。
  assert.equal(buildAlaSqlTypeMap(null).size, 6);
});

const CHOICE_FORM = {
  schema: [
    { id: "f1", type: "text", label: "氏名" },
    { id: "f2", type: "checkboxes", label: "好きな果物", options: [{ label: "りんご" }, { label: "みかん" }] },
  ],
};

test("buildAlaSqlTypeMap: 選択肢はフィールド 1 列の string（option 真偽値列は出さない）", () => {
  const map = buildAlaSqlTypeMap(CHOICE_FORM);
  assert.equal(map.get("好きな果物"), "string");
  assert.equal(map.has("好きな果物__りんご"), false);
  assert.equal(map.has("好きな果物__みかん"), false);
});

test("getFormColumns: 選択肢はフィールド 1 列の string（option 列は出さない）", () => {
  const cols = getFormColumns(CHOICE_FORM);
  const byKey = new Map(cols.map((c) => [c.key, c]));
  const fruit = byKey.get("好きな果物");
  assert.ok(fruit, "選択肢フィールド列 好きな果物 が存在する");
  assert.equal(fruit.type, "string");
  // 旧 data 形式の option 列は出さない
  assert.equal(byKey.has("好きな果物|りんご"), false);
});

// ---- view 形式（getFormViewColumns / buildViewAlaSqlTypeMap） ----

test("getFormViewColumns: メタ列が先頭に含まれる", () => {
  const cols = getFormViewColumns(FORM);
  const metaKeys = cols.filter((c) => c.isMeta).map((c) => c.alaSqlKey);
  // 並び順は VIEW_META_COLUMNS の定義順
  assert.deepEqual(metaKeys, ["id", "No_", "createdAt", "modifiedAt", "createdBy", "modifiedBy"]);
});

test("getFormViewColumns: checkboxes は string 扱い（「、」連結文字列が入るため）", () => {
  const cols = getFormViewColumns(FORM);
  const chk = cols.find((c) => c.key === "詳細|同意");
  // data 形式（getFormColumns）では checkboxes は boolean だったが view では string
  assert.equal(chk.type, "string");
});

test("getFormViewColumns: radio/select も string（既定どおり）", () => {
  const cols = getFormViewColumns(FORM);
  assert.equal(cols.find((c) => c.key === "詳細|区分").type, "string");
});

test("getFormViewColumns: number / date は元の型を維持", () => {
  const cols = getFormViewColumns(FORM);
  assert.equal(cols.find((c) => c.key === "金額").type, "number");
  assert.equal(cols.find((c) => c.key === "日付").type, "date");
});

test("getFormViewColumns: schema 無しでもメタ列だけは返す", () => {
  const cols = getFormViewColumns(null);
  assert.equal(cols.length, 6);
  assert.ok(cols.every((c) => c.isMeta));
});

test("buildViewAlaSqlTypeMap: メタ列と schema 列を含む", () => {
  const map = buildViewAlaSqlTypeMap(FORM);
  assert.equal(map.get("id"), "string");
  assert.equal(map.get("createdAt"), "date");
  assert.equal(map.get("No_"), "number");
  assert.equal(map.get("金額"), "number");
  assert.equal(map.get("日付"), "date");
  // checkboxes は view では string
  assert.equal(map.get("詳細__同意"), "string");
});

test("buildViewAlaSqlTypeMap: form 無しでもメタ列は出る", () => {
  const map = buildViewAlaSqlTypeMap(null);
  assert.equal(map.get("id"), "string");
  assert.equal(map.get("No_"), "number");
});

test("getFormViewColumns: メタ列と同名のフィールドラベルがあれば、メタ列を優先（先勝ち）", () => {
  // form schema 側で "id" / "createdAt" というラベルのフィールドを定義してもメタ列が消えない
  const conflictForm = {
    schema: [
      { id: "fA", type: "text", label: "id" },
      { id: "fB", type: "text", label: "createdAt" },
      { id: "fC", type: "text", label: "氏名" },
    ],
  };
  const cols = getFormViewColumns(conflictForm);
  // メタ列の id / createdAt はそのまま残る
  const idCol = cols.find((c) => c.alaSqlKey === "id");
  assert.equal(idCol.isMeta, true);
  // 氏名 はメタ列でないので残る
  assert.ok(cols.find((c) => c.key === "氏名"));
});

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

test("getFormColumns: key/alaSqlKey/path/label/type を返す", () => {
  const cols = getFormColumns(FORM);
  const byKey = new Map(cols.map((c) => [c.key, c]));

  assert.equal(byKey.get("氏名").type, "string");
  assert.equal(byKey.get("金額").type, "number");
  assert.equal(byKey.get("日付").type, "date");
  assert.equal(byKey.get("詳細|区分").type, "string");
  assert.equal(byKey.get("詳細|同意").type, "boolean");

  const meikan = byKey.get("氏名");
  assert.deepEqual(meikan.path, ["氏名"]);
  assert.equal(meikan.label, "氏名");
  assert.equal(typeof meikan.alaSqlKey, "string");

  assert.deepEqual(byKey.get("詳細|区分").path, ["詳細", "区分"]);
  assert.equal(byKey.get("詳細|区分").label, "区分");
});

test("getFormColumns: schema 無し / 不正は空配列", () => {
  assert.deepEqual(getFormColumns(null), []);
  assert.deepEqual(getFormColumns({}), []);
  assert.deepEqual(getFormColumns({ schema: "x" }), []);
});

test("getFormColumns: 固定日付キーは date 扱い", () => {
  const cols = getFormColumns({ schema: [{ id: "x", type: "text", label: "createdAt" }] });
  // ラベルが createdAt の単純フィールドのパスは "createdAt" になり FIXED_DATE_KEYS に当たる
  assert.equal(cols[0].key, "createdAt");
  assert.equal(cols[0].type, "date");
});

test("buildAlaSqlTypeMap: alaSqlKey → 正規化型のマップ", () => {
  const map = buildAlaSqlTypeMap(FORM);
  // 値はすべて正規化済みの列型
  for (const v of map.values()) {
    assert.ok(["number", "date", "string", "boolean", "unknown"].includes(v));
  }
  assert.ok(map.size >= 5);
  assert.equal(buildAlaSqlTypeMap(null).size, 0);
});

const CHOICE_FORM = {
  schema: [
    { id: "f1", type: "text", label: "氏名" },
    { id: "f2", type: "checkboxes", label: "好きな果物", options: [{ label: "りんご" }, { label: "みかん" }] },
  ],
};

test("buildAlaSqlTypeMap: choice 系の 親|選択肢 列を boolean として含む", () => {
  const map = buildAlaSqlTypeMap(CHOICE_FORM);
  // 親列（checkboxes）は boolean、選択肢列も boolean
  assert.equal(map.get("好きな果物"), "boolean");
  assert.equal(map.get("好きな果物__りんご"), "boolean");
  assert.equal(map.get("好きな果物__みかん"), "boolean");
});

test("getFormColumns: choice 系の 親|選択肢 boolean 列を含む（ラベルは選択肢名）", () => {
  const cols = getFormColumns(CHOICE_FORM);
  const byKey = new Map(cols.map((c) => [c.key, c]));
  const apple = byKey.get("好きな果物|りんご");
  assert.ok(apple, "選択肢列 好きな果物|りんご が存在する");
  assert.equal(apple.type, "boolean");
  assert.equal(apple.alaSqlKey, "好きな果物__りんご");
  assert.equal(apple.label, "りんご");
  assert.deepEqual(apple.path, ["好きな果物", "りんご"]);
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

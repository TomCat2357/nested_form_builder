import assert from "node:assert/strict";
import test from "node:test";
import {
  HIDDEN_META_COLUMNS,
  filterDisplayColumns,
  getColumnDisplayLabel,
  rawYFieldsToDisplay,
  displayYFieldsToRaw,
  resolveColumnKey,
  shouldKeepRowFromSql,
} from "./metaColumnDisplay.js";

test("HIDDEN_META_COLUMNS は createdAt 系・modifiedBy・deleted 系・_row を含み modifiedAt/id/No_ は含まない", () => {
  for (const c of ["createdAt", "createdBy", "modifiedBy", "deletedAt", "deletedBy", "_row"]) {
    assert.equal(HIDDEN_META_COLUMNS.has(c), true, `${c} は非表示メタ列に含まれるべき`);
  }
  for (const c of ["id", "No_", "modifiedAt", "本文"]) {
    assert.equal(HIDDEN_META_COLUMNS.has(c), false, `${c} は非表示メタ列に含まれないべき`);
  }
});

test("filterDisplayColumns は非表示メタ列を除外して残りを保持する", () => {
  const cols = ["id", "No_", "createdAt", "createdBy", "modifiedAt", "modifiedBy", "deletedAt", "deletedBy", "_row", "本文"];
  assert.deepEqual(filterDisplayColumns(cols), ["id", "No_", "modifiedAt", "本文"]);
});

test("filterDisplayColumns は配列以外で空配列を返す", () => {
  assert.deepEqual(filterDisplayColumns(null), []);
  assert.deepEqual(filterDisplayColumns(undefined), []);
  assert.deepEqual(filterDisplayColumns("foo"), []);
});

test("filterDisplayColumns({ keepRow: true }) は _row だけ残し他の隠しメタ列は引き続き除外", () => {
  const cols = ["id", "No_", "createdAt", "createdBy", "modifiedAt", "modifiedBy", "deletedAt", "deletedBy", "_row", "本文"];
  assert.deepEqual(
    filterDisplayColumns(cols, { keepRow: true }),
    ["id", "No_", "modifiedAt", "_row", "本文"],
  );
});

test("filterDisplayColumns({ keepRow: false }) は既定挙動と同じ", () => {
  const cols = ["id", "_row", "本文"];
  assert.deepEqual(filterDisplayColumns(cols, { keepRow: false }), ["id", "本文"]);
});

test("shouldKeepRowFromSql: SQL に _row 単語があれば true", () => {
  assert.equal(shouldKeepRowFromSql("SELECT _row, * FROM x"), true);
  assert.equal(shouldKeepRowFromSql("SELECT * FROM x WHERE _row <= 5"), true);
  // 大文字小文字混在も拾う
  assert.equal(shouldKeepRowFromSql("select _ROW from x"), true);
});

test("shouldKeepRowFromSql: 明示参照が無ければ false", () => {
  assert.equal(shouldKeepRowFromSql("SELECT * FROM x"), false);
  assert.equal(shouldKeepRowFromSql(""), false);
  assert.equal(shouldKeepRowFromSql(null), false);
  assert.equal(shouldKeepRowFromSql(undefined), false);
  assert.equal(shouldKeepRowFromSql(42), false);
});

test("shouldKeepRowFromSql: 単語境界で偽陽性は限定的（_row_other 等は true で許容）", () => {
  // /\b_row\b/ では `_row_other` の `_row` 部分が単語の一部なのでマッチしないことを確認。
  // ただし `_row,_other` のようなカンマ区切りはマッチする（実害なし）。
  assert.equal(shouldKeepRowFromSql("SELECT _row_other FROM x"), false);
  assert.equal(shouldKeepRowFromSql("SELECT _row, other FROM x"), true);
});

test("getColumnDisplayLabel は modifiedAt を『最終更新日時』に変換", () => {
  assert.equal(getColumnDisplayLabel("modifiedAt"), "最終更新日時");
});

test("getColumnDisplayLabel はマッピング無しの列名をそのまま返す", () => {
  assert.equal(getColumnDisplayLabel("id"), "id");
  assert.equal(getColumnDisplayLabel("No_"), "No_");
  assert.equal(getColumnDisplayLabel("基本情報__区"), "基本情報__区");
});

const CC = [
  { name: "担当者名", role: "dimension", type: "string", displayLabel: "担当者名" },
  { name: "a_1", role: "metric", aggType: "count", type: "number", displayLabel: "件数" },
  { name: "a_2", role: "metric", aggType: "sum", type: "number", displayLabel: "数量 合計" },
];
const COLS = ["担当者名", "a_1", "a_2"];

test("rawYFieldsToDisplay は alias を displayLabel に変換し未一致トークンは触らない", () => {
  assert.equal(rawYFieldsToDisplay("a_1", CC), "件数");
  assert.equal(rawYFieldsToDisplay("a_1,a_2", CC), "件数,数量 合計");
  assert.equal(rawYFieldsToDisplay("a_1,foo", CC), "件数,foo");
  // 周囲の空白・末尾カンマは保持（入力途中を壊さない）
  assert.equal(rawYFieldsToDisplay("a_1, a_2 ", CC), "件数, 数量 合計 ");
  assert.equal(rawYFieldsToDisplay("a_1,", CC), "件数,");
});

test("rawYFieldsToDisplay は compiledColumns 無し/空/null をそのまま返す", () => {
  assert.equal(rawYFieldsToDisplay("a_1,a_2", null), "a_1,a_2");
  assert.equal(rawYFieldsToDisplay("a_1", []), "a_1");
  assert.equal(rawYFieldsToDisplay("", CC), "");
  assert.equal(rawYFieldsToDisplay(null, CC), null);
});

test("displayYFieldsToRaw は displayLabel を alias に戻す（空白除去一致も）", () => {
  assert.equal(displayYFieldsToRaw("件数", COLS, CC), "a_1");
  assert.equal(displayYFieldsToRaw("件数,数量 合計", COLS, CC), "a_1,a_2");
  // 空白を除いた表記でも fuzzy 一致する
  assert.equal(displayYFieldsToRaw("件数,数量合計", COLS, CC), "a_1,a_2");
  // 既に実列名ならそのまま
  assert.equal(displayYFieldsToRaw("担当者名", COLS, CC), "担当者名");
  // 未一致は触らない、末尾カンマは保持
  assert.equal(displayYFieldsToRaw("件数,foo", COLS, CC), "a_1,foo");
  assert.equal(displayYFieldsToRaw("件数,", COLS, CC), "a_1,");
});

test("rawYFieldsToDisplay と displayYFieldsToRaw はラウンドトリップする", () => {
  for (const raw of ["a_1", "a_1,a_2", "担当者名,a_1", "a_1,foo"]) {
    const display = rawYFieldsToDisplay(raw, CC);
    assert.equal(displayYFieldsToRaw(display, COLS, CC), raw, `round-trip 失敗: ${raw}`);
  }
});

test("resolveColumnKey は旧 agg id (srcAggId) を現在の可読別名へ解決する", () => {
  const compiled = [
    { name: "担当者名", role: "dimension", type: "string", displayLabel: "担当者名" },
    { name: "件数", role: "metric", aggType: "count", type: "number", displayLabel: "件数", srcAggId: "a_1" },
    { name: "数量_合計", role: "metric", aggType: "sum", type: "number", displayLabel: "数量 合計", srcAggId: "a_2" },
  ];
  const cols = ["担当者名", "件数", "数量_合計"];
  // 旧設定で持っていた a_1 / a_2 が新別名へ解決される
  assert.equal(resolveColumnKey("a_1", cols, compiled), "件数");
  assert.equal(resolveColumnKey("a_2", cols, compiled), "数量_合計");
  // 現行の列名・displayLabel 一致は従来どおり
  assert.equal(resolveColumnKey("件数", cols, compiled), "件数");
  assert.equal(resolveColumnKey("数量 合計", cols, compiled), "数量_合計");
  // 未一致はそのまま
  assert.equal(resolveColumnKey("不明", cols, compiled), "不明");
});

import assert from "node:assert/strict";
import test from "node:test";
import { substituteCurrentIdLiteral, collapseQueryResult } from "./fullQuerySql.js";

// ---------------------------------------------------------------------------
// substituteCurrentIdLiteral
// ---------------------------------------------------------------------------

test("substituteCurrentIdLiteral: 裸 _id をクォート済みリテラルに置換", () => {
  const out = substituteCurrentIdLiteral("SELECT [氏名] FROM _form WHERE [id] = _id", "r1");
  assert.match(out, /=\s*'r1'/);
  // 列参照 [id] はそのまま
  assert.match(out, /\[id\]/);
  // _form はこのモジュールでは触らない（preprocessSql 側で解決）
  assert.match(out, /FROM _form/);
});

test("substituteCurrentIdLiteral: [id] 列は置換しない", () => {
  const out = substituteCurrentIdLiteral("SELECT [id] FROM _form", "r1");
  assert.equal(out, "SELECT [id] FROM _form");
});

test("substituteCurrentIdLiteral: 文字列リテラル内の _id は不変", () => {
  const out = substituteCurrentIdLiteral("SELECT '_id' AS x FROM _form WHERE [id] = _id", "r1");
  assert.match(out, /'_id'/); // リテラルは保持
  assert.match(out, /=\s*'r1'/); // WHERE 側は置換
});

test("substituteCurrentIdLiteral: 行コメント内の _id は不変", () => {
  const out = substituteCurrentIdLiteral("SELECT 1 -- _id here\nFROM _form WHERE [id]=_id", "r1");
  assert.match(out, /-- _id here/);
  assert.match(out, /=\s*'r1'/);
});

test("substituteCurrentIdLiteral: バッククォート `_id` / ブラケット [_id] は不変", () => {
  const out1 = substituteCurrentIdLiteral("SELECT `_id` FROM _form", "r1");
  assert.match(out1, /`_id`/);
  const out2 = substituteCurrentIdLiteral("SELECT [_id] FROM _form", "r1");
  assert.match(out2, /\[_id\]/);
});

test("substituteCurrentIdLiteral: x_id / _idx など部分一致は置換しない", () => {
  const out = substituteCurrentIdLiteral("SELECT x_id, _idx, a._id, _id.b FROM _form", "r1");
  assert.match(out, /x_id/);
  assert.match(out, /_idx/);
  assert.match(out, /a\._id/);
  assert.match(out, /_id\.b/);
  assert.ok(!/'r1'/.test(out));
});

test("substituteCurrentIdLiteral: recordId のシングルクォートをエスケープ", () => {
  const out = substituteCurrentIdLiteral("WHERE [id] = _id", "a'b");
  assert.match(out, /=\s*'a''b'/);
});

test("substituteCurrentIdLiteral: 空 recordId は空文字リテラル", () => {
  const out = substituteCurrentIdLiteral("WHERE [id] = _id", "");
  assert.match(out, /=\s*''/);
});

// ---------------------------------------------------------------------------
// collapseQueryResult
// ---------------------------------------------------------------------------

test("collapseQueryResult: 0 行は空文字", () => {
  assert.equal(collapseQueryResult([], ["a"]), "");
  assert.equal(collapseQueryResult(null, null), "");
});

test("collapseQueryResult: 1 行 1 列はスカラ", () => {
  assert.equal(collapseQueryResult([{ v: 42 }], ["v"]), "42");
  assert.equal(collapseQueryResult([{ name: "山田" }], ["name"]), "山田");
});

test("collapseQueryResult: 1 行複数列は ', ' 連結", () => {
  assert.equal(collapseQueryResult([{ a: "x", b: "y" }], ["a", "b"]), "x, y");
});

test("collapseQueryResult: 複数行は行優先で連結", () => {
  assert.equal(
    collapseQueryResult([{ a: "1" }, { a: "2" }, { a: "3" }], ["a"]),
    "1, 2, 3"
  );
});

test("collapseQueryResult: 空セルも位置を保ったまま連結", () => {
  assert.equal(
    collapseQueryResult([{ a: "x", b: "" }, { a: null, b: "z" }], ["a", "b"]),
    "x, , , z"
  );
});

test("collapseQueryResult: columns 未指定は先頭行のキーから推定", () => {
  assert.equal(collapseQueryResult([{ only: "v" }]), "v");
});

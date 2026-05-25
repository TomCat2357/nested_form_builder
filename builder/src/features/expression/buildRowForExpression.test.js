import assert from "node:assert/strict";
import test from "node:test";
import { buildRowForExpression } from "./buildRowForExpression.js";

test("単純なオブジェクトをコピーする", () => {
  const row = buildRowForExpression({ 氏名: "田中", 年齢: 30 });
  assert.equal(row["氏名"], "田中");
  assert.equal(row["年齢"], 30);
});

test("パイプ区切りキーを __ に変換する", () => {
  const row = buildRowForExpression({ "基本情報|区": "新宿区" });
  assert.equal(row["基本情報__区"], "新宿区");
  assert.equal(row["基本情報|区"], undefined);
});

test("fixed パラメータで予約キーを設定する", () => {
  const row = buildRowForExpression({ 氏名: "田中" }, { _id: "abc" });
  assert.equal(row["氏名"], "田中");
  assert.equal(row["_id"], "abc");
});

test("source の同じキーを fixed が上書きする", () => {
  const row = buildRowForExpression({ _id: "old", 氏名: "田中" }, { _id: "new" });
  assert.equal(row["_id"], "new");
});

test("source が null/undefined でも空オブジェクトを返す", () => {
  assert.deepEqual(buildRowForExpression(null), {});
  assert.deepEqual(buildRowForExpression(undefined), {});
});

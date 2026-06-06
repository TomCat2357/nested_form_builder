import assert from "node:assert/strict";
import test from "node:test";
import { stripNonSearchableMetaColumns } from "./analyticsAlaSql.js";

// 検索の SQL モード（runSearchSelect → registerFormAsTable の excludeMetaColumns）は、
// 検索非対象メタ列（createdBy / modifiedBy / deletedAt / deletedBy）を登録テーブルから落とす。
// Question/Dashboard は excludeMetaColumns:false でこれらにアクセスできる（意図した差）。

test("stripNonSearchableMetaColumns: …By / deleted 系メタ列を落とし、id/No_/createdAt/modifiedAt と項目は残す", () => {
  const rows = [
    {
      id: "a",
      No_: 1,
      createdAt: "2026/01/01 00:00:00.000",
      modifiedAt: "2026/05/20 09:00:21.000",
      createdBy: "alice@example.com",
      modifiedBy: "bob@example.com",
      deletedAt: null,
      deletedBy: "carol@example.com",
      "氏名": "田中",
    },
  ];
  const out = stripNonSearchableMetaColumns(rows);
  // 別オブジェクトとして返る（元の pristine 行は破壊しない）
  assert.notStrictEqual(out[0], rows[0]);
  assert.ok(Object.prototype.hasOwnProperty.call(rows[0], "deletedBy"), "元配列の行は変更しない");
  // 検索可なキーは残る
  assert.equal(out[0].id, "a");
  assert.equal(out[0].No_, 1);
  assert.equal(out[0].createdAt, "2026/01/01 00:00:00.000");
  assert.equal(out[0].modifiedAt, "2026/05/20 09:00:21.000");
  assert.equal(out[0]["氏名"], "田中");
  // 検索非対象メタは消える（= WHERE deletedBy = ... 等が解決されない）
  for (const key of ["createdBy", "modifiedBy", "deletedAt", "deletedBy"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(out[0], key), false, `${key} は除かれるべき`);
  }
});

test("stripNonSearchableMetaColumns: 非配列は [] を返す", () => {
  assert.deepEqual(stripNonSearchableMetaColumns(null), []);
  assert.deepEqual(stripNonSearchableMetaColumns(undefined), []);
});

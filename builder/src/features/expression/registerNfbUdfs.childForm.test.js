import assert from "node:assert/strict";
import test from "node:test";
import { ensureNfbUdfsRegistered } from "./registerNfbUdfs.js";

function makeAlaSql() {
  const alasql = { fn: {}, aggr: {} };
  ensureNfbUdfsRegistered(alasql);
  return alasql;
}

const childObj = {
  childFormId: "fileABC",
  childFormName: "親フォルダ/子フォーム",
  childFormUrl: "https://example.com/exec?form=fileABC&pid=p1",
  count: 3,
  records: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
};

test("CHILD_FORM_* UDF が登録される", () => {
  const { fn } = makeAlaSql();
  for (const name of ["CHILD_FORM_NAME", "CHILD_FORM_ID", "CHILD_FORM_URL", "CHILD_FORM_COUNT"]) {
    assert.equal(typeof fn[name], "function", `${name} should be a function`);
  }
});

test("CHILD_FORM_* は合成オブジェクトから各値を読む", () => {
  const { fn } = makeAlaSql();
  assert.equal(fn.CHILD_FORM_NAME(childObj), "親フォルダ/子フォーム");
  assert.equal(fn.CHILD_FORM_ID(childObj), "fileABC");
  assert.equal(fn.CHILD_FORM_URL(childObj), "https://example.com/exec?form=fileABC&pid=p1");
  assert.equal(fn.CHILD_FORM_COUNT(childObj), 3);
});

test("CHILD_FORM_COUNT: count 無しは records.length、records も無しは 0", () => {
  const { fn } = makeAlaSql();
  assert.equal(fn.CHILD_FORM_COUNT({ records: [{ id: "x" }, { id: "y" }] }), 2);
  assert.equal(fn.CHILD_FORM_COUNT({ childFormId: "f" }), 0);
});

test("CHILD_FORM_* は配列で渡されても先頭オブジェクトを読む", () => {
  const { fn } = makeAlaSql();
  assert.equal(fn.CHILD_FORM_ID([childObj]), "fileABC");
  assert.equal(fn.CHILD_FORM_COUNT([childObj]), 3);
});

test("CHILD_FORM_* は null/文字列/未定義に堅牢（空文字 / 0）", () => {
  const { fn } = makeAlaSql();
  for (const v of [null, undefined, "", "なにか", 5]) {
    assert.equal(fn.CHILD_FORM_NAME(v), "");
    assert.equal(fn.CHILD_FORM_ID(v), "");
    assert.equal(fn.CHILD_FORM_URL(v), "");
    assert.equal(fn.CHILD_FORM_COUNT(v), 0);
  }
});

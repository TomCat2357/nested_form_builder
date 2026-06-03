import test from "node:test";
import assert from "node:assert/strict";
import { buildSharedFormUrl, buildSharedRecordUrl, buildChildFormUrl } from "./formShareUrl.js";

const BASE = "https://script.google.com/macros/s/AKfy/exec";

test("buildSharedFormUrl: form のみ付与（record 空は付かない）", () => {
  assert.equal(buildSharedFormUrl(BASE, "F1"), `${BASE}?form=F1`);
  assert.equal(buildSharedFormUrl(BASE, "F1", ""), `${BASE}?form=F1`);
});

test("buildSharedFormUrl: record を付与する", () => {
  assert.equal(buildSharedFormUrl(BASE, "F1", "R9"), `${BASE}?form=F1&record=R9`);
});

test("buildSharedFormUrl: 既存の record クエリは空指定で削除される", () => {
  assert.equal(buildSharedFormUrl(`${BASE}?record=OLD`, "F1"), `${BASE}?form=F1`);
});

test("buildSharedRecordUrl: buildSharedFormUrl と同値", () => {
  assert.equal(buildSharedRecordUrl(BASE, "F1", "R9"), buildSharedFormUrl(BASE, "F1", "R9"));
});

test("buildChildFormUrl: form + pid を付け record は付けない", () => {
  assert.equal(buildChildFormUrl(BASE, "F2", "P5"), `${BASE}?form=F2&pid=P5`);
  assert.equal(buildChildFormUrl(BASE, "F2"), `${BASE}?form=F2`);
});

test("buildChildFormUrl: 既存の record は除去し pid を入れる", () => {
  assert.equal(buildChildFormUrl(`${BASE}?record=OLD`, "F2", "P5"), `${BASE}?form=F2&pid=P5`);
});

test("空の baseUrl / formId は空文字を返す", () => {
  assert.equal(buildSharedFormUrl("", "F1", "R"), "");
  assert.equal(buildSharedFormUrl(BASE, ""), "");
  assert.equal(buildChildFormUrl("", "F2", "P"), "");
  assert.equal(buildChildFormUrl(BASE, ""), "");
});

test("URL コンストラクタ不可（ハッシュ付き相対）でも文字列フォールバックで組む", () => {
  const rel = "index.html#/preview";
  assert.equal(buildSharedFormUrl(rel, "F1", "R9"), "index.html?form=F1&record=R9#/preview");
  assert.equal(buildChildFormUrl(rel, "F2", "P5"), "index.html?form=F2&pid=P5#/preview");
});

import assert from "node:assert/strict";
import test from "node:test";
import { genFormId, genRecordId } from "./ids.js";

const FORM_ID_RE = /^f_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{8}$/;
const RECORD_ID_RE = /^r_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{8}$/;

test("genFormId は base64url 8+8 形式を返す", () => {
  const id = genFormId();
  assert.match(id, FORM_ID_RE);
  assert.equal(id.length, 19);
});

test("genRecordId は base64url 8+8 形式を返す", () => {
  const id = genRecordId();
  assert.match(id, RECORD_ID_RE);
  assert.equal(id.length, 19);
});

test("同一プロセス内で連続生成しても実用上ユニークになる", () => {
  const ids = new Set();
  for (let i = 0; i < 128; i += 1) {
    ids.add(genRecordId());
  }
  assert.equal(ids.size, 128);
});

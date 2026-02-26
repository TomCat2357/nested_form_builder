import assert from "node:assert/strict";
import test from "node:test";
import { genFormId, genRecordId } from "./ids.js";

const ULID_RE = "[0-9A-HJKMNPQRSTVWXYZ]{26}";
const BASE64URL8_RE = "[A-Za-z0-9_-]{8}";
const FORM_ID_RE = new RegExp(`^f_${ULID_RE}_${BASE64URL8_RE}$`);
const RECORD_ID_RE = new RegExp(`^r_${ULID_RE}_${BASE64URL8_RE}$`);
const assertStrictlyIncreasing = (ids) => {
  for (let i = 1; i < ids.length; i += 1) {
    assert.ok(ids[i - 1] < ids[i], `ID must be strictly increasing: ${ids[i - 1]} < ${ids[i]}`);
  }
};

test("genFormId は ULID + base64url8 形式を返す", () => {
  const id = genFormId();
  assert.match(id, FORM_ID_RE);
  assert.equal(id.length, 37);
});

test("genRecordId は ULID + base64url8 形式を返す", () => {
  const id = genRecordId();
  assert.match(id, RECORD_ID_RE);
  assert.equal(id.length, 37);
});

test("同一プロセス内で連続生成しても実用上ユニークになる", () => {
  const ids = new Set();
  for (let i = 0; i < 128; i += 1) {
    ids.add(genRecordId());
  }
  assert.equal(ids.size, 128);
});

test("genRecordId は同一ミリ秒連続生成でも厳密昇順になる", () => {
  const originalNow = Date.now;
  const fixedNow = 4102444800000; // 2100-01-01T00:00:00.000Z
  Date.now = () => fixedNow;
  try {
    const ids = [];
    for (let i = 0; i < 64; i += 1) {
      ids.push(genRecordId());
    }
    assertStrictlyIncreasing(ids);
  } finally {
    Date.now = originalNow;
  }
});

test("genRecordId は時計が逆行しても厳密昇順を維持する", () => {
  const originalNow = Date.now;
  const base = 4102444801000;
  const sequence = [base, base - 10, base - 10, base + 5];
  let index = 0;
  Date.now = () => {
    const cursor = Math.min(index, sequence.length - 1);
    index += 1;
    return sequence[cursor];
  };
  try {
    const ids = [];
    for (let i = 0; i < sequence.length; i += 1) {
      ids.push(genRecordId());
    }
    assertStrictlyIncreasing(ids);
  } finally {
    Date.now = originalNow;
  }
});

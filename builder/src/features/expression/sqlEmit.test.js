import assert from "node:assert/strict";
import test from "node:test";
import { bracketIdent, quoteString } from "./sqlEmit.js";

test("bracketIdent: 通常の識別子を [..] で囲む", () => {
  assert.equal(bracketIdent("col"), "[col]");
  assert.equal(bracketIdent("氏名|姓"), "[氏名|姓]");
});

test("bracketIdent: 識別子に含まれる ] を除去する（alasql 制約への安全側）", () => {
  assert.equal(bracketIdent("a]b"), "[ab]");
  assert.equal(bracketIdent("]]x]]"), "[x]");
});

test("bracketIdent: 非文字列は String 化する", () => {
  assert.equal(bracketIdent(123), "[123]");
});

test("quoteString: 文字列リテラルを '..' で囲む", () => {
  assert.equal(quoteString("abc"), "'abc'");
});

test("quoteString: シングルクォートを '' にエスケープする", () => {
  assert.equal(quoteString("O'Brien"), "'O''Brien'");
  assert.equal(quoteString("''"), "''''''");
});

test("quoteString: 非文字列は String 化する", () => {
  assert.equal(quoteString(42), "'42'");
});

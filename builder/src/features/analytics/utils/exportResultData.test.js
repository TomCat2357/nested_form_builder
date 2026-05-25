import assert from "node:assert/strict";
import test from "node:test";
import { rowsToCsv, sanitizeFileBaseName } from "./exportResultData.js";

test("rowsToCsv: 先頭に BOM、CRLF 区切り、ヘッダ＋データ行", () => {
  const csv = rowsToCsv([{ a: 1, b: "x" }, { a: 2, b: "y" }], ["a", "b"], null);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.equal(csv.slice(1), "a,b\r\n1,x\r\n2,y");
});

test("rowsToCsv: 隠しメタ列（createdAt 等）を除外する", () => {
  const csv = rowsToCsv([{ a: 1, createdAt: 123, createdBy: "u" }], ["a", "createdAt", "createdBy"], null);
  assert.equal(csv.slice(1), "a\r\n1");
});

test("rowsToCsv: カンマ・引用符・改行を含む値をクォートしエスケープする", () => {
  const csv = rowsToCsv([{ a: "x,y", b: 'q"r', c: "line1\nline2" }], ["a", "b", "c"], null);
  assert.equal(csv.slice(1), 'a,b,c\r\n"x,y","q""r","line1\nline2"');
});

test("rowsToCsv: null / undefined は空文字", () => {
  const csv = rowsToCsv([{ a: null, b: undefined, c: 0 }], ["a", "b", "c"], null);
  assert.equal(csv.slice(1), "a,b,c\r\n,,0");
});

test("rowsToCsv: compiledColumns があればヘッダに表示ラベルを使う", () => {
  const compiled = [{ name: "cnt", displayLabel: "件数" }];
  const csv = rowsToCsv([{ cnt: 3 }], ["cnt"], compiled);
  assert.equal(csv.slice(1), "件数\r\n3");
});

test("rowsToCsv: rows が配列でなければヘッダのみ", () => {
  assert.equal(rowsToCsv(null, ["a", "b"], null).slice(1), "a,b");
});

test("rowsToCsv: opts.sql 未指定では _row が CSV から除外される", () => {
  const csv = rowsToCsv([{ a: 1, _row: 1 }, { a: 2, _row: 2 }], ["a", "_row"], null);
  assert.equal(csv.slice(1), "a\r\n1\r\n2");
});

test("rowsToCsv: opts.sql が _row を含むなら CSV にも _row 列を出す", () => {
  const csv = rowsToCsv(
    [{ a: 1, _row: 1 }, { a: 2, _row: 2 }],
    ["a", "_row"],
    null,
    { sql: "SELECT _row, a FROM x" },
  );
  assert.equal(csv.slice(1), "a,_row\r\n1,1\r\n2,2");
});

test("rowsToCsv: opts.sql が _row を含まないなら未指定時と同じ", () => {
  const csv = rowsToCsv(
    [{ a: 1, _row: 1 }],
    ["a", "_row"],
    null,
    { sql: "SELECT a FROM x" },
  );
  assert.equal(csv.slice(1), "a\r\n1");
});

test("sanitizeFileBaseName: 使えない文字を _ に、空なら fallback", () => {
  assert.equal(sanitizeFileBaseName("a/b:c*?", "x"), "a_b_c__");
  assert.equal(sanitizeFileBaseName("   ", "fallback"), "fallback");
  assert.equal(sanitizeFileBaseName(null, "fallback"), "fallback");
  assert.equal(sanitizeFileBaseName("売上 2026", "x"), "売上 2026");
});

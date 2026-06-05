import assert from "node:assert/strict";
import test from "node:test";
import {
  PATH_SEP,
  escapeSegment,
  joinEscaped,
  splitEscaped,
  joinFieldPath,
  splitFieldPath,
  splitFieldKey,
} from "./pathCodec.js";

test("PATH_SEP はスラッシュ", () => {
  assert.equal(PATH_SEP, "/");
});

test("escapeSegment: 区切りとバックスラッシュをエスケープ", () => {
  assert.equal(escapeSegment("cc/c", "/"), "cc\\/c");
  assert.equal(escapeSegment("a\\b", "/"), "a\\\\b");
  assert.equal(escapeSegment("a,b", ","), "a\\,b");
  assert.equal(escapeSegment("普通", "/"), "普通");
  assert.equal(escapeSegment("a|b", "/"), "a|b"); // | は通常文字
});

test("joinFieldPath: 通常パスはスラッシュ連結", () => {
  assert.equal(joinFieldPath(["親", "子", "孫"]), "親/子/孫");
});

test("joinFieldPath: セグメント内の / はエスケープ", () => {
  assert.equal(joinFieldPath(["aaa", "bbb", "cc/c"]), "aaa/bbb/cc\\/c");
});

test("splitFieldPath: 通常分割（trim + 空要素除去）", () => {
  assert.deepEqual(splitFieldPath("親/子/孫"), ["親", "子", "孫"]);
  assert.deepEqual(splitFieldPath(" 親 / 子 "), ["親", "子"]);
  assert.deepEqual(splitFieldPath("/親//子/"), ["親", "子"]);
  assert.deepEqual(splitFieldPath(""), []);
  assert.deepEqual(splitFieldPath(null), []);
});

test("splitFieldPath: バックスラッシュエスケープされた / は名前の一部", () => {
  assert.deepEqual(splitFieldPath("aaa/bbb/cc\\/c"), ["aaa", "bbb", "cc/c"]);
});

test("splitFieldPath: クォートで囲んだセグメントの / は名前の一部", () => {
  assert.deepEqual(splitFieldPath("aaa/bbb/'cc/c'"), ["aaa", "bbb", "cc/c"]);
  assert.deepEqual(splitFieldPath('aaa/bbb/"cc/c"'), ["aaa", "bbb", "cc/c"]);
});

test("splitFieldPath: クォート重ねでクォート自身を表現", () => {
  assert.deepEqual(splitFieldPath("a/'b''c'/d"), ["a", "b'c", "d"]);
});

test("splitFieldPath: | は通常文字として保持される", () => {
  assert.deepEqual(splitFieldPath("売上|目標/担当"), ["売上|目標", "担当"]);
});

test("往復: フィールドパス（/ \\ | を含むセグメント）", () => {
  const cases = [
    ["親", "子", "孫"],
    ["aaa", "bbb", "cc/c"],
    ["a\\b", "c/d"],
    ["売上|目標", "担当"],
    ["only"],
    ["a/b/c"],
    ["\\", "/"],
  ];
  for (const segs of cases) {
    assert.deepEqual(splitFieldKey(joinFieldPath(segs)), segs);
  }
});

test("splitFieldKey: 内部キーは trim せず空要素を保持", () => {
  // 選択肢なし（空ラベル）の機械生成キー "親/" は空セグメントを保持
  assert.deepEqual(splitFieldKey("親/"), ["親", ""]);
  assert.deepEqual(splitFieldKey(" x / y "), [" x ", " y "]);
  assert.deepEqual(splitFieldKey(""), []);
});

test("splitEscaped: 末尾の孤立したバックスラッシュはリテラル", () => {
  assert.deepEqual(splitEscaped("a\\", "/", false), ["a\\"]);
});

test("joinEscaped: 非配列は空文字", () => {
  assert.equal(joinEscaped(null, "/"), "");
  assert.equal(joinEscaped(undefined, ","), "");
});

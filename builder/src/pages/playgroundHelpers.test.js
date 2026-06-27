import test from "node:test";
import assert from "node:assert/strict";

import { formFieldPaths, computeInsertion } from "./playgroundHelpers.js";

// ────────────────────────────────────────────────────────────
// formFieldPaths: スキーマからフィールドパス一覧を取り出す
// ────────────────────────────────────────────────────────────

test("formFieldPaths: schema が無いフォームは空配列", () => {
  assert.deepEqual(formFieldPaths(null), []);
  assert.deepEqual(formFieldPaths({}), []);
  assert.deepEqual(formFieldPaths({ schema: null }), []);
});

test("formFieldPaths: トップレベルのリーフフィールドのパスを返す", () => {
  const form = {
    schema: [
      { id: "f1", type: "text", label: "氏名" },
      { id: "f2", type: "number", label: "年齢" },
    ],
  };
  const paths = formFieldPaths(form);
  assert.ok(paths.includes("氏名"), `氏名 を含むこと: ${JSON.stringify(paths)}`);
  assert.ok(paths.includes("年齢"), `年齢 を含むこと: ${JSON.stringify(paths)}`);
});

test("formFieldPaths: ネストフィールドは | 連結のパスになる", () => {
  const form = {
    schema: [
      {
        id: "g1",
        type: "group",
        label: "基本情報",
        children: [
          { id: "c1", type: "text", label: "区" },
        ],
      },
    ],
  };
  const paths = formFieldPaths(form);
  // フィールドパスの区切りは新形式の "/"（PATH_SEP）。
  assert.ok(paths.includes("基本情報/区"), `基本情報/区 を含むこと: ${JSON.stringify(paths)}`);
});

test("formFieldPaths: 重複パスは排除される", () => {
  const form = {
    schema: [
      { id: "f1", type: "text", label: "氏名" },
      { id: "f2", type: "text", label: "氏名" },
    ],
  };
  const paths = formFieldPaths(form);
  const count = paths.filter((p) => p === "氏名").length;
  assert.equal(count, 1, `氏名 は 1 回だけ: ${JSON.stringify(paths)}`);
});

// ────────────────────────────────────────────────────────────
// computeInsertion: カーソル位置への文字列挿入（純粋部分）
// ────────────────────────────────────────────────────────────

test("computeInsertion: カーソル位置に挿入しキャレットを末尾へ", () => {
  const { next, caret } = computeInsertion("ab", 1, 1, "X");
  assert.equal(next, "aXb");
  assert.equal(caret, 2);
});

test("computeInsertion: 選択範囲を置換する", () => {
  const { next, caret } = computeInsertion("hello", 1, 4, "XY");
  assert.equal(next, "hXYo");
  assert.equal(caret, 3);
});

test("computeInsertion: 空文字列への挿入", () => {
  const { next, caret } = computeInsertion("", 0, 0, "[氏名]");
  assert.equal(next, "[氏名]");
  assert.equal(caret, 4); // "[氏名]" は 4 文字（[ 氏 名 ]）
});

test("computeInsertion: 不正な位置は末尾追記にフォールバック", () => {
  const r1 = computeInsertion("ab", null, null, "Z");
  assert.equal(r1.next, "abZ");
  assert.equal(r1.caret, 3);
  const r2 = computeInsertion("ab", 99, 99, "Z");
  assert.equal(r2.next, "abZ");
  assert.equal(r2.caret, 3);
});

test("computeInsertion: value / snippet が空でも安全", () => {
  assert.deepEqual(computeInsertion(undefined, 0, 0, undefined), { next: "", caret: 0 });
  assert.deepEqual(computeInsertion("ab", 1, 1, undefined), { next: "ab", caret: 1 });
});

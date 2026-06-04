import test from "node:test";
import assert from "node:assert/strict";
import { canAcceptChildren, demoteIntoPrevSibling, promoteChildToParentLevel } from "./questionTreeOps.js";

test("canAcceptChildren: 非選択肢で子を持てるタイプは true", () => {
  assert.equal(canAcceptChildren({ type: "text" }), true);
  assert.equal(canAcceptChildren({ type: "message" }), true);
});

test("canAcceptChildren: 子を持てないタイプは false", () => {
  assert.equal(canAcceptChildren({ type: "printTemplate" }), false);
  assert.equal(canAcceptChildren({ type: "webhook" }), false);
  assert.equal(canAcceptChildren(null), false);
});

test("canAcceptChildren: 選択肢型は選択肢が1つ以上あれば true", () => {
  assert.equal(canAcceptChildren({ type: "radio", options: [{ id: "o1", label: "A" }] }), true);
  assert.equal(canAcceptChildren({ type: "radio", options: [] }), false);
  assert.equal(canAcceptChildren({ type: "select" }), false);
});

test("demoteIntoPrevSibling: 非選択肢の上兄弟の children 末尾へ入る", () => {
  const fields = [
    { id: "a", type: "text", label: "A" },
    { id: "b", type: "text", label: "B" },
  ];
  const next = demoteIntoPrevSibling(fields, 1);
  assert.equal(next.length, 1);
  assert.equal(next[0].id, "a");
  assert.deepEqual(next[0].children.map((c) => c.id), ["b"]);
  // 元配列は破壊しない
  assert.equal(fields.length, 2);
});

test("demoteIntoPrevSibling: 既存 children の末尾に追加される", () => {
  const fields = [
    { id: "a", type: "text", label: "A", children: [{ id: "a1", type: "text", label: "A1" }] },
    { id: "b", type: "text", label: "B" },
  ];
  const next = demoteIntoPrevSibling(fields, 1);
  assert.deepEqual(next[0].children.map((c) => c.id), ["a1", "b"]);
});

test("demoteIntoPrevSibling: 選択肢型は最初の選択肢の childrenByValue へ入る", () => {
  const fields = [
    { id: "a", type: "radio", label: "A", options: [{ id: "o1", label: "選択肢1" }, { id: "o2", label: "選択肢2" }] },
    { id: "b", type: "text", label: "B" },
  ];
  const next = demoteIntoPrevSibling(fields, 1);
  assert.equal(next.length, 1);
  assert.deepEqual(next[0].childrenByValue["選択肢1"].map((c) => c.id), ["b"]);
  assert.equal(next[0].childrenByValue["選択肢2"], undefined);
});

test("demoteIntoPrevSibling: 先頭要素は降格できず null", () => {
  const fields = [{ id: "a", type: "text" }, { id: "b", type: "text" }];
  assert.equal(demoteIntoPrevSibling(fields, 0), null);
});

test("demoteIntoPrevSibling: 上兄弟が子を持てないタイプなら null", () => {
  const fields = [{ id: "a", type: "webhook" }, { id: "b", type: "text" }];
  assert.equal(demoteIntoPrevSibling(fields, 1), null);
});

test("promoteChildToParentLevel: children から取り出し親の直後へ挿入する", () => {
  const fields = [
    { id: "p", type: "text", label: "P", children: [{ id: "c1", type: "text" }, { id: "c2", type: "text" }] },
    { id: "q", type: "text", label: "Q" },
  ];
  const next = promoteChildToParentLevel(fields, 0, (parent) => parent.children.splice(0, 1)[0]);
  assert.deepEqual(next.map((f) => f.id), ["p", "c1", "q"]);
  assert.deepEqual(next[0].children.map((c) => c.id), ["c2"]);
  // 元配列は破壊しない
  assert.equal(fields[0].children.length, 2);
});

test("promoteChildToParentLevel: childrenByValue から取り出し親の直後へ挿入する", () => {
  const fields = [
    {
      id: "p",
      type: "radio",
      options: [{ id: "o1", label: "A" }],
      childrenByValue: { A: [{ id: "c1", type: "text" }] },
    },
  ];
  const next = promoteChildToParentLevel(fields, 0, (parent) => parent.childrenByValue["A"].splice(0, 1)[0]);
  assert.deepEqual(next.map((f) => f.id), ["p", "c1"]);
  assert.deepEqual(next[0].childrenByValue["A"], []);
});

test("promoteChildToParentLevel: 取り出せない場合は null", () => {
  const fields = [{ id: "p", type: "text", children: [] }];
  const next = promoteChildToParentLevel(fields, 0, (parent) => parent.children.splice(0, 1)[0]);
  assert.equal(next, null);
});

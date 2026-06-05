import test from "node:test";
import assert from "node:assert/strict";
import { forEachFormField, extractOptionOrder } from "./fieldMetas.js";

const collectPipePaths = (form) => {
  const out = [];
  forEachFormField(form, ({ pipePath, alaSqlKey }) => out.push({ pipePath, alaSqlKey }));
  return out;
};

test("forEachFormField: 単純な平坦フォームを順序通り走査", () => {
  const form = {
    schema: [
      { type: "text", label: "氏名" },
      { type: "number", label: "年齢" },
    ],
  };
  assert.deepEqual(collectPipePaths(form), [
    { pipePath: "氏名", alaSqlKey: "氏名" },
    { pipePath: "年齢", alaSqlKey: "年齢" },
  ]);
});

test("forEachFormField: ネストした childrenByValue を pipePath で平坦化", () => {
  const form = {
    schema: [
      {
        type: "radio",
        label: "大分類",
        options: [{ label: "A" }],
        childrenByValue: {
          A: [
            { type: "checkboxes", label: "対象種", options: [{ label: "カラス" }] },
          ],
        },
      },
    ],
  };
  const paths = collectPipePaths(form).map((p) => p.pipePath);
  assert.ok(paths.includes("大分類"));
  assert.ok(paths.includes("大分類/A/対象種"));
});

test("forEachFormField: 同一 pipePath は先勝ち（重複コールバックなし）", () => {
  const form = {
    schema: [
      { type: "text", label: "メモ" },
      { type: "text", label: "メモ" }, // 重複ラベル
    ],
  };
  const calls = [];
  forEachFormField(form, (info) => calls.push(info.pipePath));
  assert.deepEqual(calls, ["メモ"]);
});

test("forEachFormField: form / schema が不正な場合は何もしない", () => {
  let called = false;
  const cb = () => { called = true; };
  forEachFormField(null, cb);
  forEachFormField({}, cb);
  forEachFormField({ schema: null }, cb);
  forEachFormField({ schema: [] }, cb);
  forEachFormField({ schema: [{ type: "text", label: "x" }] }, "not a function");
  assert.equal(called, false);
});

test("extractOptionOrder: オブジェクト・文字列・空値を正しく扱う", () => {
  assert.deepEqual(extractOptionOrder({ options: [{ label: "A" }, { label: "B" }] }), ["A", "B"]);
  assert.deepEqual(extractOptionOrder({ options: ["X", "Y"] }), ["X", "Y"]);
  assert.deepEqual(extractOptionOrder({ options: [{ label: "" }, { label: "ok" }] }), ["ok"]);
  assert.equal(extractOptionOrder({ options: [] }), null);
  assert.equal(extractOptionOrder({}), null);
  assert.equal(extractOptionOrder(null), null);
});

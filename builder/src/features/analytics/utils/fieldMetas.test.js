import test from "node:test";
import assert from "node:assert/strict";
import { forEachFormField, forEachChoiceOption, extractOptionOrder } from "./fieldMetas.js";

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
  assert.ok(paths.includes("大分類|A|対象種"));
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

test("forEachChoiceOption: choice 系の各選択肢を 親|選択肢 列として走査する", () => {
  const form = {
    schema: [
      { type: "text", label: "氏名" },
      { type: "checkboxes", label: "好きな果物", options: [{ label: "りんご" }, { label: "みかん" }] },
      { type: "select", label: "区分", options: [{ label: "A" }] },
    ],
  };
  const out = [];
  forEachChoiceOption(form, ({ pipePath, alaSqlKey, optionLabel }) => out.push({ pipePath, alaSqlKey, optionLabel }));
  assert.deepEqual(out, [
    { pipePath: "好きな果物|りんご", alaSqlKey: "好きな果物__りんご", optionLabel: "りんご" },
    { pipePath: "好きな果物|みかん", alaSqlKey: "好きな果物__みかん", optionLabel: "みかん" },
    { pipePath: "区分|A", alaSqlKey: "区分__A", optionLabel: "A" },
  ]);
});

test("forEachChoiceOption: options を持たない choice / 非 choice 型は無視する", () => {
  const form = {
    schema: [
      { type: "checkboxes", label: "オプション無し" },
      { type: "text", label: "メモ" },
      { type: "number", label: "金額" },
    ],
  };
  const out = [];
  forEachChoiceOption(form, ({ pipePath }) => out.push(pipePath));
  assert.deepEqual(out, []);
});

test("forEachChoiceOption: ネストした choice 選択肢も pipePath で平坦化", () => {
  const form = {
    schema: [
      {
        type: "radio",
        label: "大分類",
        options: [{ label: "A" }],
        childrenByValue: {
          A: [{ type: "checkboxes", label: "対象種", options: [{ label: "カラス" }] }],
        },
      },
    ],
  };
  const out = [];
  forEachChoiceOption(form, ({ pipePath }) => out.push(pipePath));
  assert.ok(out.includes("大分類|A"));
  assert.ok(out.includes("大分類|A|対象種|カラス"));
});

test("extractOptionOrder: オブジェクト・文字列・空値を正しく扱う", () => {
  assert.deepEqual(extractOptionOrder({ options: [{ label: "A" }, { label: "B" }] }), ["A", "B"]);
  assert.deepEqual(extractOptionOrder({ options: ["X", "Y"] }), ["X", "Y"]);
  assert.deepEqual(extractOptionOrder({ options: [{ label: "" }, { label: "ok" }] }), ["ok"]);
  assert.equal(extractOptionOrder({ options: [] }), null);
  assert.equal(extractOptionOrder({}), null);
  assert.equal(extractOptionOrder(null), null);
});

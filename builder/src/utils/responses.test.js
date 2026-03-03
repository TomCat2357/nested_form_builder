import test from "node:test";
import assert from "node:assert/strict";
import { restoreResponsesFromData } from "./responses.js";

const schema = [
  {
    id: "f_checkbox",
    type: "checkboxes",
    label: "チェック項目",
    options: [{ label: "A" }, { label: "B" }, { label: "C" }],
    childrenByValue: {
      A: [{ id: "f_child_a", type: "text", label: "A補足" }],
      B: [{ id: "f_child_b", type: "text", label: "B補足" }],
    },
  },
  {
    id: "f_radio",
    type: "radio",
    label: "ラジオ項目",
    options: [{ label: "高" }, { label: "中" }, { label: "低" }],
    childrenByValue: {
      高: [{ id: "f_child_high", type: "text", label: "高補足" }],
      低: [{ id: "f_child_low", type: "text", label: "低補足" }],
    },
  },
  {
    id: "f_select",
    type: "select",
    label: "選択項目",
    options: [{ label: "X" }, { label: "Y" }],
    childrenByValue: {},
  },
];

test("restoreResponsesFromData: choice marker形式を選択ラベルへ復元する", () => {
  const data = {
    "チェック項目|B": "●",
    "チェック項目|A": "●",
    "ラジオ項目|低": "●",
    "選択項目|Y": "●",
  };

  const restored = restoreResponsesFromData(schema, data, {});
  assert.deepEqual(restored.f_checkbox, ["A", "B"]);
  assert.equal(restored.f_radio, "低");
  assert.equal(restored.f_select, "Y");
});

test("restoreResponsesFromData: 直接値形式の選択データも復元する", () => {
  const data = {
    チェック項目: ["C", "A"],
    ラジオ項目: "高",
    選択項目: "X",
  };

  const restored = restoreResponsesFromData(schema, data, {});
  assert.deepEqual(restored.f_checkbox, ["A", "C"]);
  assert.equal(restored.f_radio, "高");
  assert.equal(restored.f_select, "X");
});

test("restoreResponsesFromData: options外のラベルもmarkerから復元する", () => {
  const data = {
    "チェック項目|その他": "●",
    選択項目: { 外部: true },
  };

  const restored = restoreResponsesFromData(schema, data, {});
  assert.deepEqual(restored.f_checkbox, ["その他"]);
  assert.equal(restored.f_select, "外部");
});

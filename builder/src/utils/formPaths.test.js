import test from "node:test";
import assert from "node:assert/strict";
import { collectDisplayFieldSettings } from "./formPaths.js";

test("displayFieldSettingsはフォーム定義順を保持する", () => {
  const schema = [
    { type: "text", label: "B項目", isDisplayed: true },
    { type: "text", label: "A項目", isDisplayed: true },
    { type: "text", label: "C項目", isDisplayed: true },
  ];

  const collected = collectDisplayFieldSettings(schema);
  const paths = collected.map((item) => item.path);
  assert.deepEqual(paths, ["B項目", "A項目", "C項目"]);
});

test("displayFieldSettingsはネストした分岐でも巡回順を保持する", () => {
  const schema = [
    {
      type: "select",
      label: "親",
      isDisplayed: true,
      childrenByValue: {
        分岐B: [
          { type: "text", label: "子2", isDisplayed: true },
          { type: "text", label: "子1", isDisplayed: true },
        ],
        分岐A: [
          { type: "text", label: "子3", isDisplayed: true },
        ],
      },
    },
    { type: "text", label: "末尾", isDisplayed: true },
  ];

  const collected = collectDisplayFieldSettings(schema);
  const paths = collected.map((item) => item.path);
  assert.deepEqual(paths, ["親", "親|分岐B|子2", "親|分岐B|子1", "親|分岐A|子3", "末尾"]);
});

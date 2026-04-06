import assert from "node:assert/strict";
import test from "node:test";
import { collectResponses, sortResponses } from "./collect.js";

test("sortResponsesはチェックボックス選択順ではなくフォーム設定順でキーを並べる", () => {
  const schema = [
    {
      id: "q_parent",
      type: "checkboxes",
      label: "親",
      options: [
        { id: "opt_b", label: "B" },
        { id: "opt_a", label: "A" },
      ],
      childrenByValue: {
        A: [{ id: "q_a", type: "text", label: "A子" }],
        B: [{ id: "q_b", type: "text", label: "B子" }],
      },
    },
  ];
  const responses = {
    q_parent: ["A", "B"],
    q_a: "a-value",
    q_b: "b-value",
  };

  const raw = collectResponses(schema, responses);
  const sorted = sortResponses(raw, schema);

  assert.deepEqual(sorted.keys, ["親|B", "親|A", "親|B|B子", "親|A|A子"]);
  assert.deepEqual(Object.keys(sorted.map), ["親|B", "親|A", "親|B|B子", "親|A|A子"]);
  assert.equal(sorted.map["親|B"], "●");
  assert.equal(sorted.map["親|A"], "●");
  assert.equal(sorted.map["親|B|B子"], "b-value");
  assert.equal(sorted.map["親|A|A子"], "a-value");
});

test("collectResponsesは電話番号を単一値として出力する", () => {
  const schema = [
    { id: "q_phone", type: "phone", label: "電話番号" },
  ];
  const responses = {
    q_phone: "090-1234-5678",
  };

  const raw = collectResponses(schema, responses);
  assert.equal(raw["電話番号"], "090-1234-5678");
});

test("collectResponses と sortResponses は printTemplate を回答データに含めない", () => {
  const schema = [
    { id: "q_name", type: "text", label: "氏名" },
    {
      id: "q_print",
      type: "printTemplate",
      label: "様式出力",
      printTemplateAction: { enabled: true, fileNameTemplate: "print_${recordId}" },
    },
  ];
  const responses = {
    q_name: "山田太郎",
    q_print: "ignored",
  };

  const raw = collectResponses(schema, responses);
  const sorted = sortResponses(raw, schema);

  assert.deepEqual(raw, { 氏名: "山田太郎" });
  assert.deepEqual(sorted.keys, ["氏名"]);
  assert.deepEqual(sorted.map, { 氏名: "山田太郎" });
});

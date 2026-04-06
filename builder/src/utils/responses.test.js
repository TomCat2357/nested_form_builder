import test from "node:test";
import assert from "node:assert/strict";
import { collectDefaultNowResponses, restoreResponsesFromData } from "./responses.js";

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

test("restoreResponsesFromData: 数値は文字列として復元する", () => {
  const restored = restoreResponsesFromData(
    [{ id: "f_number", type: "number", label: "数値項目" }],
    { 数値項目: 123.5 },
    {},
  );

  assert.equal(restored.f_number, "123.5");
});

test("collectDefaultNowResponses: テキスト・選択系・メール・電話番号の初期値を生成する", () => {
  const now = new Date(2026, 2, 8, 9, 15);
  const schema = [
    { id: "f_text_user", type: "text", defaultValueMode: "userName" },
    { id: "f_text_affiliation", type: "text", defaultValueMode: "userAffiliation" },
    { id: "f_text_title", type: "text", defaultValueMode: "userTitle" },
    { id: "f_text_custom", type: "text", defaultValueMode: "custom", defaultValueText: "固定値" },
    { id: "f_email", type: "email", autoFillUserEmail: true },
    {
      id: "f_phone",
      type: "phone",
      autoFillUserPhone: true,
      phoneFormat: "hyphen",
      allowFixedLineOmitAreaCode: false,
      allowMobile: true,
      allowIpPhone: true,
      allowTollFree: true,
    },
    { id: "f_date", type: "date", defaultNow: true },
    { id: "f_time", type: "time", defaultNow: true },
    {
      id: "f_checks",
      type: "checkboxes",
      options: [
        { label: "A", defaultSelected: true },
        { label: "B", defaultSelected: false },
        { label: "C", defaultSelected: true },
      ],
    },
    {
      id: "f_radio",
      type: "radio",
      options: [
        { label: "低", defaultSelected: false },
        { label: "高", defaultSelected: true },
      ],
    },
    {
      id: "f_select",
      type: "select",
      options: [
        { label: "X", defaultSelected: true },
        { label: "Y", defaultSelected: false },
      ],
    },
  ];

  const defaults = collectDefaultNowResponses(schema, now, {
    userName: "山田 太郎",
    userAffiliation: "営業部",
    userTitle: "営業課長",
    userEmail: "user@example.com",
    userPhone: "+81 90-1234-5678",
  });

  assert.equal(defaults.f_text_user, "山田 太郎");
  assert.equal(defaults.f_text_affiliation, "営業部");
  assert.equal(defaults.f_text_title, "営業課長");
  assert.equal(defaults.f_text_custom, "固定値");
  assert.equal(defaults.f_email, "user@example.com");
  assert.equal(defaults.f_phone, "090-1234-5678");
  assert.equal(defaults.f_date, "2026-03-08");
  assert.equal(defaults.f_time, "09:15");
  assert.deepEqual(defaults.f_checks, ["A", "C"]);
  assert.equal(defaults.f_radio, "高");
  assert.equal(defaults.f_select, "X");
});

test("collectDefaultNowResponses: 電話番号を設定に合わせてハイフンなしへ整形する", () => {
  const schema = [
    {
      id: "f_phone",
      type: "phone",
      autoFillUserPhone: true,
      phoneFormat: "plain",
      allowFixedLineOmitAreaCode: false,
      allowMobile: true,
      allowIpPhone: true,
      allowTollFree: true,
    },
  ];

  const defaults = collectDefaultNowResponses(schema, new Date(2026, 2, 8, 9, 15), {
    userPhone: "090-1234-5678",
  });

  assert.equal(defaults.f_phone, "09012345678");
});

test("collectDefaultNowResponses: 固定電話の市外局番省略が許可されていれば 211-2879 を初期値に使う", () => {
  const schema = [
    {
      id: "f_phone",
      type: "phone",
      autoFillUserPhone: true,
      phoneFormat: "hyphen",
      allowFixedLineOmitAreaCode: true,
      allowMobile: true,
      allowIpPhone: true,
      allowTollFree: true,
    },
  ];

  const defaults = collectDefaultNowResponses(schema, new Date(2026, 2, 8, 9, 15), {
    userPhone: "211-2879",
  });

  assert.equal(defaults.f_phone, "211-2879");
});

test("collectDefaultNowResponses: 整形後に許容外なら元の電話番号をそのまま使う", () => {
  const schema = [
    {
      id: "f_phone",
      type: "phone",
      autoFillUserPhone: true,
      phoneFormat: "hyphen",
      allowFixedLineOmitAreaCode: false,
      allowMobile: false,
      allowIpPhone: false,
      allowTollFree: false,
    },
  ];

  const defaults = collectDefaultNowResponses(schema, new Date(2026, 2, 8, 9, 15), {
    userPhone: "+81 90-1234-5678",
  });

  assert.equal(defaults.f_phone, "+81 90-1234-5678");
});

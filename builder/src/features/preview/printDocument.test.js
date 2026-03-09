import assert from "node:assert/strict";
import test from "node:test";
import { buildPrintDocumentPayload } from "./printDocument.js";

test("buildPrintDocumentPayload は表示順を維持しつつ非表示分岐を除外する", () => {
  const schema = [
    { id: "message_1", type: "message", label: "事前案内" },
    {
      id: "contact_method",
      type: "radio",
      label: "連絡方法",
      options: [
        { id: "phone", label: "電話" },
        { id: "mail", label: "メール" },
      ],
      childrenByValue: {
        電話: [{ id: "phone_note", type: "textarea", label: "通話メモ" }],
        メール: [{ id: "reference_url", type: "url", label: "参照URL" }],
      },
    },
    {
      id: "topics",
      type: "checkboxes",
      label: "相談種別",
      options: [
        { id: "a", label: "申請" },
        { id: "b", label: "契約" },
      ],
      childrenByValue: {
        申請: [{ id: "topic_a", type: "text", label: "申請詳細" }],
        契約: [{ id: "topic_b", type: "text", label: "契約詳細" }],
      },
    },
    { id: "empty_field", type: "text", label: "未回答項目" },
  ];
  const responses = {
    contact_method: "メール",
    reference_url: "https://example.com/reference",
    phone_note: "これは表示されない",
    topics: ["契約", "申請"],
    topic_a: "申請A",
    topic_b: "契約B",
  };

  const payload = buildPrintDocumentPayload({
    schema,
    responses,
    settings: {
      formTitle: "相談票",
      recordNo: "12/3",
    },
    recordId: "rec:001",
    exportedAt: new Date("2026-03-09T12:34:56+09:00"),
  });

  assert.equal(payload.formTitle, "相談票");
  assert.equal(payload.recordId, "rec:001");
  assert.equal(payload.recordNo, "12/3");
  assert.match(payload.fileName, /^印刷フォーム_相談票_12-3_20260309_123456$/);
  assert.deepEqual(payload.items, [
    { label: "事前案内", value: "", depth: 0, type: "message" },
    { label: "連絡方法", value: "メール", depth: 0, type: "radio" },
    { label: "参照URL", value: "https://example.com/reference", depth: 1, type: "url" },
    { label: "相談種別", value: "申請, 契約", depth: 0, type: "checkboxes" },
    { label: "申請詳細", value: "申請A", depth: 1, type: "text" },
    { label: "契約詳細", value: "契約B", depth: 1, type: "text" },
    { label: "未回答項目", value: "", depth: 0, type: "text" },
  ]);
});

test("buildPrintDocumentPayload は textarea の改行を保持し recordNo が空でも recordId を使う", () => {
  const schema = [
    { id: "memo", type: "textarea", label: "メモ" },
  ];
  const responses = {
    memo: "1行目\n2行目",
  };

  const payload = buildPrintDocumentPayload({
    schema,
    responses,
    settings: {
      formTitle: "記録票",
      recordNo: "",
    },
    recordId: "record/001",
    exportedAt: new Date("2026-03-09T00:00:01+09:00"),
  });

  assert.match(payload.fileName, /^印刷フォーム_記録票_record-001_20260309_000001$/);
  assert.deepEqual(payload.items, [
    { label: "メモ", value: "1行目\n2行目", depth: 0, type: "textarea" },
  ]);
});

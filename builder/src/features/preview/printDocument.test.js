import assert from "node:assert/strict";
import test from "node:test";
import { buildPrintDocumentPayload, formatRecordMetaDateTime, resolveOmitEmptyRowsOnPrint, resolveShowPrintHeader } from "./printDocument.js";

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
      modifiedAtUnixMs: new Date("2026-03-10T08:09:10+09:00").getTime(),
    },
    recordId: "rec:001",
    exportedAt: new Date("2026-03-09T12:34:56+09:00"),
    omitEmptyRows: false,
  });

  assert.equal(payload.formTitle, "相談票");
  assert.equal(payload.recordId, "rec:001");
  assert.equal(payload.recordNo, "12/3");
  assert.equal(payload.modifiedAt, "2026/03/10 08:09:10");
  assert.equal(payload.showHeader, true);
  assert.match(payload.fileName, /^印刷様式_相談票_12-3_20260309_123456$/);
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

test("buildPrintDocumentPayload は空欄行を省略しても message 行は残す", () => {
  const schema = [
    { id: "message_1", type: "message", label: "セクション見出し" },
    { id: "empty_field", type: "text", label: "未回答項目" },
    { id: "filled_field", type: "text", label: "回答済み項目" },
  ];

  const payload = buildPrintDocumentPayload({
    schema,
    responses: {
      filled_field: "あり",
    },
    settings: {
      formTitle: "相談票",
      recordNo: "15",
    },
    recordId: "rec-015",
    exportedAt: new Date("2026-03-09T12:34:56+09:00"),
    omitEmptyRows: true,
  });

  assert.deepEqual(payload.items, [
    { label: "セクション見出し", value: "", depth: 0, type: "message" },
    { label: "回答済み項目", value: "あり", depth: 0, type: "text" },
  ]);
});

test("buildPrintDocumentPayload は除外指定したメッセージを印刷様式に含めない", () => {
  const schema = [
    { id: "message_hidden", type: "message", label: "周知", excludeFromSearchAndPrint: true },
    { id: "message_visible", type: "message", label: "注意事項" },
    { id: "filled_field", type: "text", label: "回答済み項目" },
  ];

  const payload = buildPrintDocumentPayload({
    schema,
    responses: {
      filled_field: "あり",
    },
    settings: {
      formTitle: "相談票",
    },
    recordId: "rec-print-1",
    exportedAt: new Date("2026-03-09T12:34:56+09:00"),
    omitEmptyRows: false,
  });

  assert.deepEqual(payload.items, [
    { label: "注意事項", value: "", depth: 0, type: "message" },
    { label: "回答済み項目", value: "あり", depth: 0, type: "text" },
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

  assert.match(payload.fileName, /^印刷様式_記録票_record-001_20260309_000001$/);
  assert.deepEqual(payload.items, [
    { label: "メモ", value: "1行目\n2行目", depth: 0, type: "textarea" },
  ]);
});

test("resolveOmitEmptyRowsOnPrint は未設定時 true、false 明示時のみ false を返す", () => {
  assert.equal(resolveOmitEmptyRowsOnPrint({}), true);
  assert.equal(resolveOmitEmptyRowsOnPrint({ omitEmptyRowsOnPrint: true }), true);
  assert.equal(resolveOmitEmptyRowsOnPrint({ omitEmptyRowsOnPrint: false }), false);
});

test("resolveShowPrintHeader は未設定時 true、false 明示時のみ false を返す", () => {
  assert.equal(resolveShowPrintHeader({}), true);
  assert.equal(resolveShowPrintHeader({ showPrintHeader: true }), true);
  assert.equal(resolveShowPrintHeader({ showPrintHeader: false }), false);
});

test("formatRecordMetaDateTime は UNIX ms を最終更新日時表示へ整形する", () => {
  const unixMs = new Date("2026-03-10T08:09:10+09:00").getTime();
  assert.equal(formatRecordMetaDateTime(unixMs), "2026/03/10 08:09:10");
  assert.equal(formatRecordMetaDateTime(""), "");
  assert.equal(formatRecordMetaDateTime(null), "");
});

test("buildPrintDocumentPayload は omitEmptyRowsOnPrint 設定を既定値として使う", () => {
  const schema = [
    { id: "empty_field", type: "text", label: "未回答項目" },
    { id: "filled_field", type: "text", label: "回答済み項目" },
  ];
  const responses = {
    filled_field: "あり",
  };

  const defaultPayload = buildPrintDocumentPayload({
    schema,
    responses,
    settings: {
      formTitle: "相談票",
    },
    recordId: "rec-default",
    exportedAt: new Date("2026-03-09T12:34:56+09:00"),
  });
  assert.deepEqual(defaultPayload.items, [
    { label: "回答済み項目", value: "あり", depth: 0, type: "text" },
  ]);

  const enabledPayload = buildPrintDocumentPayload({
    schema,
    responses,
    settings: {
      formTitle: "相談票",
      omitEmptyRowsOnPrint: true,
    },
    recordId: "rec-true",
    exportedAt: new Date("2026-03-09T12:34:56+09:00"),
  });
  assert.deepEqual(enabledPayload.items, [
    { label: "回答済み項目", value: "あり", depth: 0, type: "text" },
  ]);

  const disabledPayload = buildPrintDocumentPayload({
    schema,
    responses,
    settings: {
      formTitle: "相談票",
      omitEmptyRowsOnPrint: false,
    },
    recordId: "rec-false",
    exportedAt: new Date("2026-03-09T12:34:56+09:00"),
  });
  assert.deepEqual(disabledPayload.items, [
    { label: "未回答項目", value: "", depth: 0, type: "text" },
    { label: "回答済み項目", value: "あり", depth: 0, type: "text" },
  ]);
});

test("buildPrintDocumentPayload は showPrintHeader 設定を既定値として使う", () => {
  const schema = [
    { id: "filled_field", type: "text", label: "回答済み項目" },
  ];
  const responses = {
    filled_field: "あり",
  };

  const defaultPayload = buildPrintDocumentPayload({
    schema,
    responses,
    settings: {
      formTitle: "相談票",
    },
    recordId: "rec-default",
    exportedAt: new Date("2026-03-09T12:34:56+09:00"),
  });
  assert.equal(defaultPayload.showHeader, true);

  const disabledPayload = buildPrintDocumentPayload({
    schema,
    responses,
    settings: {
      formTitle: "相談票",
      showPrintHeader: false,
    },
    recordId: "rec-false",
    exportedAt: new Date("2026-03-09T12:34:56+09:00"),
  });
  assert.equal(disabledPayload.showHeader, false);

  const overriddenPayload = buildPrintDocumentPayload({
    schema,
    responses,
    settings: {
      formTitle: "相談票",
      showPrintHeader: false,
    },
    recordId: "rec-override",
    exportedAt: new Date("2026-03-09T12:34:56+09:00"),
    showHeader: true,
  });
  assert.equal(overriddenPayload.showHeader, true);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFieldValuesMap,
  buildRecordItems,
  collectFileUploadMeta,
  collectChildFormMeta,
  buildPrintDocumentPayload,
  formatRecordMetaDateTime,
  resolveOmitEmptyRowsOnPrint,
  resolveShowPrintHeader,
} from "./printDocument.js";

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
  assert.equal(payload.modifiedAt, "2026-03-10_08:09:10");
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
    { id: "files", type: "fileUpload", label: "添付資料" },
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
    { label: "添付資料", value: "", depth: 0, type: "fileUpload" },
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

test("buildPrintDocumentPayload は printTemplate を印刷項目に含めない", () => {
  const schema = [
    { id: "name", type: "text", label: "氏名" },
    {
      id: "print_action",
      type: "printTemplate",
      label: "様式出力",
      printTemplateAction: { enabled: true, fileNameTemplate: "print_${recordId}" },
    },
  ];

  const payload = buildPrintDocumentPayload({
    schema,
    responses: {
      name: "山田太郎",
    },
    settings: {
      formTitle: "相談票",
    },
    recordId: "rec-print-template",
    exportedAt: new Date("2026-03-09T12:34:56+09:00"),
    omitEmptyRows: false,
  });

  assert.deepEqual(payload.items, [
    { label: "氏名", value: "山田太郎", depth: 0, type: "text" },
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
  assert.equal(formatRecordMetaDateTime(unixMs), "2026-03-10_08:09:10");
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

test("buildPrintDocumentPayload は印刷用 driveSettings に ID と仮フォルダ情報を含める", () => {
  const payload = buildPrintDocumentPayload({
    schema: [
      { id: "name", type: "text", label: "氏名" },
      { id: "upload", type: "fileUpload", label: "添付", driveRootFolderUrl: "https://drive.google.com/drive/folders/root123", driveFolderNameTemplate: "{@_id}_{氏名}" },
    ],
    responses: {
      name: "山田 太郎",
    },
    settings: {
      formTitle: "申請書",
    },
    recordId: "rec-save-1",
    driveFolderState: {
      resolvedUrl: "https://drive.google.com/drive/folders/temp999",
      inputUrl: "",
    },
    useTemporaryFolder: true,
  });

  assert.deepEqual(payload.driveSettings, {
    rootFolderUrl: "https://drive.google.com/drive/folders/root123",
    folderNameTemplate: "{@_id}_{氏名}",
    formId: "",
    recordId: "rec-save-1",
    folderUrl: "https://drive.google.com/drive/folders/temp999",
    useTemporaryFolder: true,
    responses: {
      name: "山田 太郎",
    },
    fieldPaths: {
      name: "氏名",
      upload: "添付",
    },
    fieldValues: {
      name: "山田 太郎",
      upload: "",
    },
    dataValues: {
      "氏名": "山田 太郎",
    },
    fileUploadMeta: {
      upload: {
        fileNames: [],
        fileUrls: [],
        rawFileNames: [],
      },
    },
  });
});

test("buildFieldValuesMap は選択中の分岐だけ値を残し未選択分岐を空文字にする", () => {
  const schema = [
    { id: "name", type: "text", label: "氏名" },
    { id: "memo", type: "textarea", label: "メモ" },
    {
      id: "contact_method",
      type: "radio",
      label: "連絡方法",
      options: [
        { id: "phone", label: "電話" },
        { id: "mail", label: "メール" },
      ],
      childrenByValue: {
        電話: [{ id: "phone_note", type: "text", label: "通話メモ" }],
        メール: [{ id: "mail_address", type: "text", label: "メールアドレス" }],
      },
    },
    {
      id: "topics",
      type: "checkboxes",
      label: "相談種別",
      options: [
        { id: "apply", label: "申請" },
        { id: "contract", label: "契約" },
      ],
      childrenByValue: {
        申請: [{ id: "topic_apply", type: "text", label: "申請詳細" }],
        契約: [{ id: "topic_contract", type: "text", label: "契約詳細" }],
      },
    },
    { id: "files", type: "fileUpload", label: "添付", allowUploadByUrl: true },
  ];
  const responses = {
    name: "山田 太郎",
    memo: "1行目\n2行目",
    contact_method: "メール",
    phone_note: "非表示になる値",
    mail_address: "user@example.com",
    topics: ["申請"],
    topic_apply: "申請A",
    topic_contract: "非表示になる契約詳細",
    files: [
      { name: "見積書.pdf" },
      { name: "申請書.docx" },
    ],
  };

  assert.deepEqual(buildFieldValuesMap(schema, responses), {
    name: "山田 太郎",
    memo: "1行目\n2行目",
    contact_method: "メール",
    phone_note: "",
    mail_address: "user@example.com",
    topics: "申請",
    topic_apply: "申請A",
    topic_contract: "",
    files: "見積書.pdf, 申請書.docx",
  });
});

test("buildFieldValuesMap は hideFileExtension: true の場合に拡張子を除去する", () => {
  const schema = [
    { id: "name", type: "text", label: "名前" },
    { id: "files", type: "fileUpload", label: "添付", hideFileExtension: true },
  ];
  const responses = {
    name: "山田 太郎",
    files: [
      { name: "見積書.pdf" },
      { name: "申請書.docx" },
    ],
  };

  const result = buildFieldValuesMap(schema, responses);
  assert.equal(result.files, "見積書, 申請書");
  assert.equal(result.name, "山田 太郎");
});

test("buildFieldValuesMap は hideFileExtension: false の場合に拡張子を保持する", () => {
  const schema = [
    { id: "files", type: "fileUpload", label: "添付", hideFileExtension: false },
  ];
  const responses = {
    files: [{ name: "見積書.pdf" }],
  };

  assert.equal(buildFieldValuesMap(schema, responses).files, "見積書.pdf");
});

test("collectFileUploadMeta は hideFileExtension: true のフィールドのみ収集する", () => {
  const schema = [
    { id: "f1", type: "fileUpload", label: "添付1", hideFileExtension: true },
    { id: "f2", type: "fileUpload", label: "添付2", hideFileExtension: false },
    { id: "f3", type: "text", label: "名前" },
    {
      id: "q1", type: "radio", label: "分岐", options: [{ label: "A" }],
      childrenByValue: {
        A: [{ id: "f4", type: "fileUpload", label: "添付3", hideFileExtension: true }],
      },
    },
  ];

  const meta = collectFileUploadMeta(schema);
  assert.deepEqual(meta, {
    f1: { hideFileExtension: true },
    f4: { hideFileExtension: true },
  });
});

test("buildPrintDocumentPayload は children を持つ入力フィールドで親が空のとき子を出力しない", () => {
  const schema = [
    {
      id: "f_parent",
      type: "text",
      label: "親",
      children: [{ id: "f_child", type: "text", label: "子" }],
    },
  ];

  const filled = buildPrintDocumentPayload({
    schema,
    responses: { f_parent: "あり", f_child: "子値" },
    settings: { formTitle: "T" },
    exportedAt: new Date("2026-03-09T12:34:56+09:00"),
    omitEmptyRows: false,
  });
  assert.deepEqual(filled.items, [
    { label: "親", value: "あり", depth: 0, type: "text" },
    { label: "子", value: "子値", depth: 1, type: "text" },
  ]);

  const empty = buildPrintDocumentPayload({
    schema,
    responses: { f_parent: "", f_child: "孤児" },
    settings: { formTitle: "T" },
    exportedAt: new Date("2026-03-09T12:34:56+09:00"),
    omitEmptyRows: false,
  });
  assert.deepEqual(empty.items, [
    { label: "親", value: "", depth: 0, type: "text" },
  ]);
});

test("collectFileUploadMeta は children 配下の fileUpload も収集する", () => {
  const schema = [
    {
      id: "p1",
      type: "text",
      label: "親",
      children: [{ id: "c1", type: "fileUpload", label: "添付", hideFileExtension: true }],
    },
  ];
  const meta = collectFileUploadMeta(schema);
  assert.deepEqual(meta, { c1: { hideFileExtension: true } });
});

test("collectChildFormMeta は子データのある全 formLink を拾う（includeChildData 非依存）", () => {
  const schema = [
    { id: "l1", type: "formLink", label: "子A", childFormId: "fA" },
    { id: "l2", type: "formLink", label: "子B", childFormId: "fB" },
    { id: "l3", type: "formLink", label: "子C", childFormId: "fC" },
    {
      id: "p1",
      type: "text",
      label: "親",
      children: [{ id: "l4", type: "formLink", label: "ネスト子", childFormId: "fD" }],
    },
  ];
  const childDataByFieldId = {
    l1: { childFormId: "fA", count: 2, records: [] },
    l2: { childFormId: "fB", count: 1, records: [] },
    l4: { childFormId: "fD", count: 0, records: [] },
    // l3 はマップに無い → meta に含まれない
  };
  const meta = collectChildFormMeta(schema, childDataByFieldId);
  assert.deepEqual(Object.keys(meta).sort(), ["l1", "l2", "l4"]);
  assert.equal(meta.l1.childFormId, "fA");
});

test("buildPrintDocumentPayload は childFormMeta を driveSettings に載せる", () => {
  const schema = [
    { id: "l1", type: "formLink", label: "子A", childFormId: "fA", includeChildData: true },
  ];
  const payload = buildPrintDocumentPayload({
    schema,
    responses: {},
    settings: { formTitle: "親フォーム", formId: "parent" },
    recordId: "p1",
    childDataByFieldId: { l1: { childFormId: "fA", childFormName: "子A", count: 2, records: [] } },
  });
  assert.ok(payload.driveSettings, "driveSettings should exist");
  assert.deepEqual(Object.keys(payload.driveSettings.childFormMeta), ["l1"]);
  assert.equal(payload.driveSettings.childFormMeta.l1.count, 2);
});

test("buildPrintDocumentPayload は childData 無しなら childFormMeta を付けない", () => {
  const schema = [
    { id: "l1", type: "formLink", label: "子A", childFormId: "fA", includeChildData: true },
  ];
  const payload = buildPrintDocumentPayload({
    schema,
    responses: {},
    settings: { formTitle: "親フォーム", formId: "parent" },
    recordId: "p1",
  });
  // driveSettings 自体が無いか、あっても childFormMeta は無い
  assert.ok(!payload.driveSettings || !("childFormMeta" in payload.driveSettings));
});

test("buildRecordItems は子フォームデータを items 列へネスト展開する", () => {
  const schema = [
    { id: "t1", type: "text", label: "氏名" },
    { id: "l1", type: "formLink", label: "添付フォーム", childFormId: "fA" },
  ];
  const childDataByFieldId = {
    l1: {
      childFormId: "fA",
      count: 2,
      records: [
        { id: "c1", no: 1, items: [{ question: "品名", value: "ボルト", type: "text" }, { question: "数量", value: "10", type: "number" }] },
        { id: "c2", no: 2, items: [{ question: "品名", value: "ナット", type: "text" }] },
      ],
    },
  };
  const items = buildRecordItems(schema, { t1: "山田" }, { childDataByFieldId });
  assert.deepEqual(items, [
    { question: "氏名", value: "山田", type: "text" },
    { question: "添付フォーム/#1/品名", value: "ボルト", type: "text" },
    { question: "添付フォーム/#1/数量", value: "10", type: "number" },
    { question: "添付フォーム/#2/品名", value: "ナット", type: "text" },
  ]);
  // 空の formLink placeholder 行は出さない
  assert.ok(!items.some((it) => it.question === "添付フォーム"));
});

test("buildRecordItems は子データ無しの formLink を skip（空行を出さない）", () => {
  const schema = [
    { id: "t1", type: "text", label: "氏名" },
    { id: "l1", type: "formLink", label: "添付フォーム", childFormId: "fA" },
  ];
  // childDataByFieldId 自体を渡さない（第3引数省略）→ 後方互換で formLink は skip
  const items = buildRecordItems(schema, { t1: "山田" });
  assert.deepEqual(items, [{ question: "氏名", value: "山田", type: "text" }]);
});

test("buildRecordItems は no が空ならインデックスマーカーを使う", () => {
  const schema = [{ id: "l1", type: "formLink", label: "明細", childFormId: "fA" }];
  const childDataByFieldId = {
    l1: { childFormId: "fA", count: 1, records: [{ id: "c1", no: "", items: [{ question: "値", value: "x", type: "text" }] }] },
  };
  const items = buildRecordItems(schema, {}, { childDataByFieldId });
  assert.deepEqual(items, [{ question: "明細/#1/値", value: "x", type: "text" }]);
});

test("buildPrintDocumentPayload は子データをヘッダ/マーカー/子行として描画する", () => {
  const schema = [{ id: "l1", type: "formLink", label: "添付フォーム", childFormId: "fA" }];
  const childDataByFieldId = {
    l1: {
      childFormId: "fA",
      count: 2,
      records: [
        { id: "c1", no: 1, items: [{ question: "品名", value: "ボルト", type: "text" }] },
        { id: "c2", no: 2, items: [{ question: "品名", value: "ナット", type: "text" }] },
      ],
    },
  };
  const payload = buildPrintDocumentPayload({
    schema,
    responses: {},
    settings: { formTitle: "親フォーム", formId: "parent", omitEmptyRowsOnPrint: false },
    recordId: "p1",
    childDataByFieldId,
  });
  assert.deepEqual(payload.items, [
    { label: "添付フォーム", value: "2件", depth: 0, type: "formLink" },
    { label: "#1", value: "", depth: 1, type: "formLinkRecord" },
    { label: "品名", value: "ボルト", depth: 2, type: "text" },
    { label: "#2", value: "", depth: 1, type: "formLinkRecord" },
    { label: "品名", value: "ナット", depth: 2, type: "text" },
  ]);
});

test("buildPrintDocumentPayload は omitEmptyRows で空子行を落としヘッダ/マーカーは残す", () => {
  const schema = [{ id: "l1", type: "formLink", label: "明細", childFormId: "fA" }];
  const childDataByFieldId = {
    l1: {
      childFormId: "fA",
      count: 1,
      records: [{ id: "c1", no: 1, items: [{ question: "品名", value: "", type: "text" }, { question: "数量", value: "3", type: "number" }] }],
    },
  };
  const payload = buildPrintDocumentPayload({
    schema,
    responses: {},
    settings: { formTitle: "親", formId: "parent", omitEmptyRowsOnPrint: true },
    recordId: "p1",
    childDataByFieldId,
  });
  assert.deepEqual(payload.items, [
    { label: "明細", value: "1件", depth: 0, type: "formLink" },
    { label: "#1", value: "", depth: 1, type: "formLinkRecord" },
    { label: "数量", value: "3", depth: 2, type: "number" },
  ]);
});

test("buildPrintDocumentPayload は truncated をヘッダ value に反映し slice 分のみ描画する", () => {
  const schema = [{ id: "l1", type: "formLink", label: "明細", childFormId: "fA" }];
  const childDataByFieldId = {
    l1: {
      childFormId: "fA",
      count: 250,
      truncated: true,
      records: [{ id: "c1", no: 1, items: [{ question: "値", value: "a", type: "text" }] }],
    },
  };
  const payload = buildPrintDocumentPayload({
    schema,
    responses: {},
    settings: { formTitle: "親", formId: "parent", omitEmptyRowsOnPrint: false },
    recordId: "p1",
    childDataByFieldId,
  });
  assert.equal(payload.items[0].type, "formLink");
  assert.equal(payload.items[0].value, "250件（先頭1件を表示）");
  // records は 1 件のみ反復
  assert.equal(payload.items.filter((it) => it.type === "formLinkRecord").length, 1);
});

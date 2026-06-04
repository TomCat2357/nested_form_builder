import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSchemaIDs, findFirstFileUploadField, supportsChildren, supportsSupplementaryComment, validateLabelCharacters } from "./schema.js";

test("normalizeSchemaIDs: time の includeSeconds を timePrecision へ移行する", () => {
  const schema = normalizeSchemaIDs([
    { type: "time", label: "分まで", includeSeconds: false },
    { type: "time", label: "秒まで", includeSeconds: true },
    { type: "time", label: "未設定" },
    { type: "time", label: "明示ミリ秒", timePrecision: "millisecond" },
  ]);
  assert.equal(schema[0].timePrecision, "minute");
  assert.equal(schema[1].timePrecision, "second");
  assert.equal(schema[2].timePrecision, "second");
  assert.equal(schema[3].timePrecision, "millisecond");
  // legacy フラグは除去される
  for (const f of schema) assert.equal(f.includeSeconds, undefined);
});

test("normalizeSchemaIDs: 非 time 型に付いた timePrecision は除去する", () => {
  const schema = normalizeSchemaIDs([
    { type: "text", label: "テキスト", timePrecision: "second" },
  ]);
  assert.equal(schema[0].timePrecision, undefined);
});

test("normalizeSchemaIDs は旧フィールド型を新仕様へ移行する", () => {
  const schema = normalizeSchemaIDs([
    { type: "textarea", label: "備考", placeholder: "自由入力" },
    { type: "regex", label: "会員番号", pattern: "^[0-9]+$" },
    { type: "userName", label: "氏名" },
    { type: "email", label: "メール", defaultNow: true, placeholder: "legacy@example.com" },
    { type: "text", label: "役職", defaultValueMode: "userTitle" },
  ]);

  assert.equal(schema[0].type, "text");
  assert.equal(schema[0].multiline, true);

  assert.equal(schema[1].type, "text");
  assert.equal(schema[1].inputRestrictionMode, "pattern");
  assert.equal(schema[1].pattern, "^[0-9]+$");

  assert.equal(schema[2].type, "text");
  assert.equal(schema[2].defaultValueMode, "userName");

  assert.equal(schema[3].type, "email");
  assert.equal(schema[3].autoFillUserEmail, true);
  assert.equal("defaultNow" in schema[3], false);

  assert.equal(schema[4].type, "text");
  assert.equal(schema[4].defaultValueMode, "userTitle");
});

test("normalizeSchemaIDs は初期選択と電話番号設定を正規化する", () => {
  const schema = normalizeSchemaIDs([
    {
      type: "radio",
      label: "種別",
      options: [
        { label: "A", defaultSelected: true },
        { label: "B", defaultSelected: true },
      ],
    },
    {
      type: "phone",
      label: "電話番号",
    },
    {
      type: "text",
      label: "備考",
      inputRestrictionMode: "maxLength",
    },
  ]);

  assert.deepEqual(
    schema[0].options.map((opt) => ({ label: opt.label, defaultSelected: opt.defaultSelected })),
    [
      { label: "A", defaultSelected: true },
      { label: "B", defaultSelected: false },
    ],
  );

  assert.equal(schema[1].phoneFormat, "hyphen");
  assert.equal(schema[1].allowFixedLineOmitAreaCode, false);
  assert.equal(schema[1].allowMobile, true);
  assert.equal(schema[1].allowIpPhone, true);
  assert.equal(schema[1].allowTollFree, true);
  assert.equal(schema[1].autoFillUserPhone, false);
  assert.equal(schema[2].maxLength, 20);
});

test("normalizeSchemaIDs は数値設定を numberMode へ正規化し不要な値を除去する", () => {
  const schema = normalizeSchemaIDs([
    { type: "number", label: "件数" },
    { type: "number", label: "下限のみ", integerOnly: "true", minValue: "-5", maxValue: "" },
    { type: "number", label: "上限のみ", integerOnly: false, minValue: "", maxValue: "10.5" },
    { type: "number", label: "明示モード", numberMode: "naturalNumber", minValue: 1 },
    { type: "text", label: "備考", integerOnly: true, numberMode: "integer", minValue: 1, maxValue: 2 },
  ]);

  // 既定は制限なし。旧 integerOnly は削除される。
  assert.equal(schema[0].numberMode, "unrestricted");
  assert.equal("integerOnly" in schema[0], false);
  assert.equal("minValue" in schema[0], false);
  assert.equal("maxValue" in schema[0], false);

  // 旧 integerOnly:"true" は numberMode:"integer" へ移行。
  assert.equal(schema[1].numberMode, "integer");
  assert.equal("integerOnly" in schema[1], false);
  assert.equal(schema[1].minValue, -5);
  assert.equal("maxValue" in schema[1], false);

  assert.equal(schema[2].numberMode, "unrestricted");
  assert.equal("integerOnly" in schema[2], false);
  assert.equal("minValue" in schema[2], false);
  assert.equal(schema[2].maxValue, 10.5);

  // 明示的な numberMode は維持される。
  assert.equal(schema[3].numberMode, "naturalNumber");
  assert.equal(schema[3].minValue, 1);

  // 非数値型は numberMode / integerOnly / min / max を剥がす。
  assert.equal("integerOnly" in schema[4], false);
  assert.equal("numberMode" in schema[4], false);
  assert.equal("minValue" in schema[4], false);
  assert.equal("maxValue" in schema[4], false);
});

test("normalizeSchemaIDs は fileUpload 設定を allowUploadByUrl へ正規化する", () => {
  const schema = normalizeSchemaIDs([
    { type: "fileUpload", label: "添付資料", allowUploadByUrl: "true", allowFolderUrlEdit: "true", driveRootFolderUrl: "https://drive.google.com/drive/folders/abc", driveFolderNameTemplate: "{@_id}" },
    { type: "fileUpload", label: "既定値確認" },
    { type: "text", label: "備考", allowUploadByUrl: true, allowFolderUrlEdit: true, driveRootFolderUrl: "should-be-removed" },
  ]);

  assert.equal(schema[0].allowUploadByUrl, true);
  assert.equal(schema[0].allowFolderUrlEdit, true);
  assert.equal(schema[0].driveRootFolderUrl, "https://drive.google.com/drive/folders/abc");
  assert.equal(schema[0].driveFolderNameTemplate, "{@_id}");
  assert.equal(schema[1].allowUploadByUrl, false);
  assert.equal(schema[1].allowFolderUrlEdit, false);
  assert.equal(schema[1].hideFileExtension, true);
  assert.equal(schema[1].driveRootFolderUrl, "");
  assert.equal(schema[1].driveFolderNameTemplate, "");
  assert.equal("allowUploadByUrl" in schema[2], false);
  assert.equal("allowFolderUrlEdit" in schema[2], false);
  assert.equal("driveRootFolderUrl" in schema[2], false);
  assert.equal("driveFolderNameTemplate" in schema[2], false);
});

test("normalizeSchemaIDs は旧 fileUpload の printTemplateAction を独立カードへ移行する", () => {
  const schema = normalizeSchemaIDs([
    {
      id: "upload_1",
      type: "fileUpload",
      label: "添付資料",
      isDisplayed: true,
      printTemplateAction: {
        enabled: true,
        templateUrl: "https://example.com/template",
        fileNameTemplate: "出力_${recordId}",
        outputType: "spreadsheet",
      },
    },
    { id: "memo_1", type: "text", label: "備考" },
  ]);

  assert.equal(schema.length, 3);
  assert.equal(schema[0].type, "fileUpload");
  assert.equal("printTemplateAction" in schema[0], false);
  assert.equal(schema[1].type, "printTemplate");
  assert.equal(schema[1].label, "添付資料 様式出力");
  assert.equal(schema[1].isDisplayed, true);
  assert.deepEqual(schema[1].printTemplateAction, {
    enabled: true,
    outputType: "pdf",
    useCustomTemplate: false,
    templateUrl: "https://example.com/template",
    fileNameTemplate: "出力_${recordId}",
    gmailAttachPdf: false,
    gmailTemplateTo: "",
    gmailTemplateCc: "",
    gmailTemplateBcc: "",
    gmailTemplateSubject: "",
    gmailTemplateBody: "",
  });
  assert.equal(schema[2].id, "memo_1");
});

test("normalizeSchemaIDs は printTemplate の outputType=googleDoc を保持する", () => {
  const schema = normalizeSchemaIDs([
    {
      id: "out_1",
      type: "printTemplate",
      label: "ドキュメント出力",
      printTemplateAction: {
        enabled: true,
        outputType: "googleDoc",
        useCustomTemplate: true,
        templateUrl: "https://docs.google.com/document/d/abc/edit",
        fileNameTemplate: "{`_id`}_doc",
      },
    },
  ]);

  assert.equal(schema[0].type, "printTemplate");
  assert.equal(schema[0].printTemplateAction.outputType, "googleDoc");
  assert.equal(schema[0].printTemplateAction.useCustomTemplate, true);
  assert.equal(schema[0].printTemplateAction.templateUrl, "https://docs.google.com/document/d/abc/edit");
  assert.equal(schema[0].printTemplateAction.fileNameTemplate, "{`_id`}_doc");
});

test("normalizeSchemaIDs は webhook の webhookAction を正規化し required を除去する", () => {
  const schema = normalizeSchemaIDs([
    {
      id: "wh_1",
      type: "webhook",
      label: "通知を送信",
      required: true,
      webhookAction: { url: "https://script.google.com/macros/x/exec", adminOnly: "yes" },
    },
  ]);

  assert.equal(schema[0].type, "webhook");
  assert.deepEqual(schema[0].webhookAction, {
    url: "https://script.google.com/macros/x/exec",
    adminOnly: true,
  });
  assert.equal("required" in schema[0], false);
});

test("normalizeSchemaIDs は非 webhook 型から webhookAction を除去する", () => {
  const schema = normalizeSchemaIDs([
    {
      id: "t_1",
      type: "text",
      label: "氏名",
      webhookAction: { url: "https://example.com", adminOnly: true },
    },
  ]);

  assert.equal("webhookAction" in schema[0], false);
});

test("normalizeSchemaIDs は formLink の childFormId/childFormPath を保持し required を除去する", () => {
  const schema = normalizeSchemaIDs([
    {
      id: "fl_1",
      type: "formLink",
      label: "子フォームを開く",
      required: true,
      childFormId: "file123",
      childFormPath: "親フォルダ/子フォーム",
    },
  ]);

  assert.equal(schema[0].type, "formLink");
  assert.equal(schema[0].childFormId, "file123");
  assert.equal(schema[0].childFormPath, "親フォルダ/子フォーム");
  assert.equal("required" in schema[0], false);
});

test("normalizeSchemaIDs は非 formLink 型から childFormId/childFormPath を除去する", () => {
  const schema = normalizeSchemaIDs([
    {
      id: "t_2",
      type: "text",
      label: "氏名",
      childFormId: "file123",
      childFormPath: "x",
    },
  ]);

  assert.equal("childFormId" in schema[0], false);
  assert.equal("childFormPath" in schema[0], false);
});

test("findFirstFileUploadField はトップレベルの fileUpload を返す", () => {
  const fields = [
    { type: "text", label: "名前" },
    { type: "fileUpload", label: "資料", driveRootFolderUrl: "https://example.com/folder" },
    { type: "fileUpload", label: "別資料" },
  ];
  const result = findFirstFileUploadField(fields);
  assert.equal(result.label, "資料");
  assert.equal(result.driveRootFolderUrl, "https://example.com/folder");
});

test("findFirstFileUploadField はネストされた fileUpload を返す", () => {
  const fields = [
    { type: "text", label: "名前" },
    {
      type: "radio", label: "種別",
      childrenByValue: {
        "A": [{ type: "fileUpload", label: "A資料", driveFolderNameTemplate: "{@_id}" }],
        "B": [{ type: "text", label: "備考" }],
      },
    },
  ];
  const result = findFirstFileUploadField(fields);
  assert.equal(result.label, "A資料");
  assert.equal(result.driveFolderNameTemplate, "{@_id}");
});

test("findFirstFileUploadField は fileUpload がない場合 null を返す", () => {
  const fields = [
    { type: "text", label: "名前" },
    { type: "number", label: "数値" },
  ];
  assert.equal(findFirstFileUploadField(fields), null);
  assert.equal(findFirstFileUploadField([]), null);
  assert.equal(findFirstFileUploadField(null), null);
});

test("supportsChildren は入力タイプと message に true を返す", () => {
  // message は「回答」概念を持たないが、子質問を無条件（常に表示）で持てる。
  ["text", "number", "email", "phone", "url", "date", "time", "fileUpload", "message"].forEach((t) => {
    assert.equal(supportsChildren(t), true, `${t} should support children`);
  });
  ["radio", "select", "checkboxes", "printTemplate", "substitution", "webhook", "formLink"].forEach((t) => {
    assert.equal(supportsChildren(t), false, `${t} should not support children`);
  });
});

test("supportsSupplementaryComment は placeholder 非対応タイプで true を返す", () => {
  ["radio", "select", "checkboxes", "date", "time", "fileUpload", "message", "printTemplate", "webhook", "formLink", "substitution"].forEach((t) => {
    assert.equal(supportsSupplementaryComment(t), true, `${t} should support comment`);
  });
  ["text", "number", "email", "phone", "url", "regex", "textarea"].forEach((t) => {
    assert.equal(supportsSupplementaryComment(t), false, `${t} should not support comment`);
  });
});

test("normalizeSchemaIDs は補足コメントを非対応型で削除し空文字も prune する", () => {
  const schema = normalizeSchemaIDs([
    { type: "radio", label: "選好", options: [{ label: "A" }], supplementaryComment: "記入の補足" },
    { type: "date", label: "日付", supplementaryComment: "   " },
    { type: "text", label: "氏名", supplementaryComment: "テキストには出ない" },
    { type: "message", label: "お知らせ", supplementaryComment: "メッセージ補足" },
  ]);
  assert.equal(schema[0].supplementaryComment, "記入の補足");
  assert.equal("supplementaryComment" in schema[1], false); // 空文字は prune
  assert.equal("supplementaryComment" in schema[2], false); // placeholder 対応型は削除
  assert.equal(schema[3].supplementaryComment, "メッセージ補足");
});

test("normalizeSchemaIDs は入力タイプの children を正規化し ID を割り当てる", () => {
  const schema = normalizeSchemaIDs([
    {
      type: "text",
      label: "親テキスト",
      children: [
        { type: "text", label: "子1" },
        { type: "number", label: "子2" },
      ],
    },
  ]);
  assert.ok(Array.isArray(schema[0].children));
  assert.equal(schema[0].children.length, 2);
  assert.match(schema[0].children[0].id, /^f_/);
  assert.equal(schema[0].children[0].label, "子1");
  assert.equal(schema[0].children[1].type, "number");
});

test("normalizeSchemaIDs は children をネストして再帰的に正規化する", () => {
  const schema = normalizeSchemaIDs([
    {
      type: "text", label: "L1",
      children: [
        {
          type: "text", label: "L2",
          children: [{ type: "text", label: "L3" }],
        },
      ],
    },
  ]);
  assert.equal(schema[0].children[0].children[0].label, "L3");
  assert.match(schema[0].children[0].children[0].id, /^f_/);
});

test("normalizeSchemaIDs は children を持たないタイプから children を除去する", () => {
  const schema = normalizeSchemaIDs([
    {
      type: "substitution", label: "置換",
      children: [{ type: "text", label: "孤児" }],
    },
    {
      type: "radio", label: "ラジオ",
      options: [{ label: "A" }],
      children: [{ type: "text", label: "孤児2" }],
    },
  ]);
  assert.equal("children" in schema[0], false);
  assert.equal("children" in schema[1], false);
});

test("normalizeSchemaIDs は message の children（常に表示の子質問）を保持する", () => {
  const schema = normalizeSchemaIDs([
    {
      type: "message", label: "お知らせ",
      children: [{ type: "text", label: "子1" }],
    },
  ]);
  assert.equal(Array.isArray(schema[0].children), true);
  assert.equal(schema[0].children.length, 1);
  assert.equal(schema[0].children[0].label, "子1");
  assert.match(schema[0].children[0].id, /^f_/);
});

test("normalizeSchemaIDs は children のネストで MAX_DEPTH をカウントする", async () => {
  const { validateMaxDepth, MAX_DEPTH } = await import("./schema.js");
  let nested = { type: "text", label: "leaf" };
  for (let i = 0; i < MAX_DEPTH; i += 1) {
    nested = { type: "text", label: `L${i}`, children: [nested] };
  }
  const result = validateMaxDepth([nested], MAX_DEPTH);
  assert.equal(result.ok, false, "MAX_DEPTH+1 段で不可となるべき");
});

test("findFirstFileUploadField は children 配下の fileUpload も見つける", () => {
  const fields = [
    {
      type: "text", label: "親",
      children: [{ type: "fileUpload", label: "添付", driveFolderNameTemplate: "{@_id}" }],
    },
  ];
  const result = findFirstFileUploadField(fields);
  assert.equal(result.label, "添付");
});

test("validateLabelCharacters: 通常ラベルは accept", () => {
  const fields = [
    { type: "text", label: "氏名" },
    { type: "text", label: "受付日|タイムスタンプ" },
    { type: "number", label: "年齢123" },
    { type: "text", label: "住所 (現在)" },
  ];
  const result = validateLabelCharacters(fields);
  assert.equal(result.ok, true);
});

test("validateLabelCharacters: バッククォート文字を含むラベルを reject", () => {
  const fields = [
    { type: "text", label: "氏名" },
    { type: "text", label: "禁止`バッククォート" },
  ];
  const result = validateLabelCharacters(fields);
  assert.equal(result.ok, false);
  assert.equal(result.invalidLabels.length, 1);
  assert.equal(result.invalidLabels[0].label, "禁止`バッククォート");
  assert.equal(result.invalidLabels[0].char, "`");
});

test("validateLabelCharacters: 入れ子の子ラベルも検出", () => {
  const fields = [
    {
      type: "text",
      label: "親",
      children: [
        { type: "text", label: "良いラベル" },
        { type: "text", label: "悪い`ラベル" },
      ],
    },
  ];
  const result = validateLabelCharacters(fields);
  assert.equal(result.ok, false);
  assert.equal(result.invalidLabels.length, 1);
  assert.equal(result.invalidLabels[0].label, "悪い`ラベル");
  assert.ok(result.invalidLabels[0].path.includes("悪い`ラベル"));
});

test("validateLabelCharacters: 空ラベルは無視", () => {
  const fields = [
    { type: "text", label: "" },
    { type: "text", label: "  " },
  ];
  const result = validateLabelCharacters(fields);
  assert.equal(result.ok, true);
});

test("normalizeSchemaIDs: formLink の includeChildData を永続化（既定 false）", () => {
  const schema = normalizeSchemaIDs([
    { type: "formLink", label: "子ON", childFormId: "fA", includeChildData: true },
    { type: "formLink", label: "子OFF", childFormId: "fB", includeChildData: false },
    { type: "formLink", label: "子未設定", childFormId: "fC" },
  ]);
  assert.equal(schema[0].includeChildData, true);
  assert.equal(schema[1].includeChildData, false);
  assert.equal(schema[2].includeChildData, false);
});

test("normalizeSchemaIDs: 非 formLink へ変えると includeChildData を落とす", () => {
  const schema = normalizeSchemaIDs([
    { type: "text", label: "テキスト", includeChildData: true, childFormId: "fA" },
  ]);
  assert.equal("includeChildData" in schema[0], false);
  assert.equal("childFormId" in schema[0], false);
});

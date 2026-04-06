import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSchemaIDs } from "./schema.js";

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

test("normalizeSchemaIDs は数値設定を正規化し不要な値を除去する", () => {
  const schema = normalizeSchemaIDs([
    { type: "number", label: "件数" },
    { type: "number", label: "下限のみ", integerOnly: "true", minValue: "-5", maxValue: "" },
    { type: "number", label: "上限のみ", integerOnly: false, minValue: "", maxValue: "10.5" },
    { type: "text", label: "備考", integerOnly: true, minValue: 1, maxValue: 2 },
  ]);

  assert.equal(schema[0].integerOnly, false);
  assert.equal("minValue" in schema[0], false);
  assert.equal("maxValue" in schema[0], false);

  assert.equal(schema[1].integerOnly, true);
  assert.equal(schema[1].minValue, -5);
  assert.equal("maxValue" in schema[1], false);

  assert.equal(schema[2].integerOnly, false);
  assert.equal("minValue" in schema[2], false);
  assert.equal(schema[2].maxValue, 10.5);

  assert.equal("integerOnly" in schema[3], false);
  assert.equal("minValue" in schema[3], false);
  assert.equal("maxValue" in schema[3], false);
});

test("normalizeSchemaIDs は fileUpload 設定を allowUploadByUrl へ正規化する", () => {
  const schema = normalizeSchemaIDs([
    { type: "fileUpload", label: "添付資料", allowUploadByUrl: "true", allowFolderUrlEdit: "true", allowMultipleFiles: true },
    { type: "fileUpload", label: "既定値確認" },
    { type: "text", label: "備考", allowUploadByUrl: true, allowFolderUrlEdit: true },
  ]);

  assert.equal(schema[0].allowUploadByUrl, true);
  assert.equal(schema[0].allowFolderUrlEdit, true);
  assert.equal("allowMultipleFiles" in schema[0], false);
  assert.equal(schema[1].allowUploadByUrl, false);
  assert.equal(schema[1].allowFolderUrlEdit, false);
  assert.equal("allowUploadByUrl" in schema[2], false);
  assert.equal("allowFolderUrlEdit" in schema[2], false);
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
    outputType: "googleDoc",
    useCustomTemplate: false,
    templateUrl: "https://example.com/template",
    fileNameTemplate: "出力_${recordId}",
    gmailTemplateTo: "",
    gmailTemplateCc: "",
    gmailTemplateBcc: "",
    gmailTemplateSubject: "",
    gmailTemplateBody: "",
  });
  assert.equal(schema[2].id, "memo_1");
});

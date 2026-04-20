import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STANDARD_PRINT_FILE_NAME_TEMPLATE,
  normalizePrintTemplateAction,
  requiresPrintTemplateFileName,
  resolveEffectivePrintTemplateFileNameTemplate,
  resolveSharedPrintFileNameTemplate,
} from "./printTemplateAction.js";

test("normalizePrintTemplateAction は Gmail 設定項目を文字列で正規化する", () => {
  const action = normalizePrintTemplateAction({
    enabled: true,
    outputType: "gmail",
    gmailAttachPdf: true,
    gmailTemplateTo: "{メールアドレス}",
    gmailTemplateCc: null,
    gmailTemplateBcc: "bcc@example.com",
    gmailTemplateSubject: "{ID} のご案内",
    gmailTemplateBody: "本文テンプレート",
  });

  assert.deepEqual(action, {
    enabled: true,
    outputType: "gmail",
    useCustomTemplate: false,
    templateUrl: "",
    fileNameTemplate: "",
    gmailAttachPdf: true,
    gmailTemplateTo: "{メールアドレス}",
    gmailTemplateCc: "",
    gmailTemplateBcc: "bcc@example.com",
    gmailTemplateSubject: "{ID} のご案内",
    gmailTemplateBody: "本文テンプレート",
  });
});

test("resolveSharedPrintFileNameTemplate はフォーム共通ファイル名設定を trim して返す", () => {
  assert.equal(
    resolveSharedPrintFileNameTemplate({ standardPrintFileNameTemplate: "  {ID}_共通PDF  " }),
    "{ID}_共通PDF",
  );
  assert.equal(resolveSharedPrintFileNameTemplate({}), "");
});

test("requiresPrintTemplateFileName は Gmail で gmailAttachPdf が false の場合は false を返す", () => {
  assert.equal(requiresPrintTemplateFileName({ outputType: "gmail" }), false);
  assert.equal(requiresPrintTemplateFileName({ outputType: "gmail", gmailAttachPdf: true }), true);
  assert.equal(requiresPrintTemplateFileName({ outputType: "pdf" }), true);
});

test("resolveEffectivePrintTemplateFileNameTemplate は PDF で共通設定へフォールバックする", () => {
  assert.equal(
    resolveEffectivePrintTemplateFileNameTemplate(
      { outputType: "pdf", fileNameTemplate: "" },
      { standardPrintFileNameTemplate: "{ID}_共通" },
    ),
    "{ID}_共通",
  );
  assert.equal(
    resolveEffectivePrintTemplateFileNameTemplate(
      { outputType: "pdf", fileNameTemplate: "{ID}_個別" },
      { standardPrintFileNameTemplate: "{ID}_共通" },
    ),
    "{ID}_個別",
  );
  assert.equal(
    resolveEffectivePrintTemplateFileNameTemplate(
      { outputType: "pdf", fileNameTemplate: "" },
      {},
    ),
    DEFAULT_STANDARD_PRINT_FILE_NAME_TEMPLATE,
  );
});

test("resolveEffectivePrintTemplateFileNameTemplate は Gmail の gmailAttachPdf でフォーム共通か既定値のみを使う", () => {
  assert.equal(
    resolveEffectivePrintTemplateFileNameTemplate(
      { outputType: "gmail", fileNameTemplate: "{ID}_旧個別", gmailAttachPdf: true },
      { standardPrintFileNameTemplate: "{ID}_共通PDF" },
    ),
    "{ID}_共通PDF",
  );
  assert.equal(
    resolveEffectivePrintTemplateFileNameTemplate(
      { outputType: "gmail", fileNameTemplate: "{ID}_旧個別", gmailAttachPdf: true },
      {},
    ),
    DEFAULT_STANDARD_PRINT_FILE_NAME_TEMPLATE,
  );
  assert.equal(
    resolveEffectivePrintTemplateFileNameTemplate(
      { outputType: "gmail", fileNameTemplate: "{ID}_旧個別", gmailAttachPdf: false },
      { standardPrintFileNameTemplate: "{ID}_共通DOC" },
    ),
    "",
  );
  assert.equal(
    resolveEffectivePrintTemplateFileNameTemplate(
      { outputType: "gmail", fileNameTemplate: "{ID}_旧個別" },
      { standardPrintFileNameTemplate: "{ID}_共通PDF" },
    ),
    "",
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STANDARD_PRINT_FILE_NAME_TEMPLATE,
  getPrintTemplateOutputLabel,
  normalizePrintTemplateAction,
  normalizePrintTemplateOutputType,
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

test("normalizePrintTemplateOutputType は pdf / gmail / googleDoc を保持し、未知値は pdf に丸める", () => {
  assert.equal(normalizePrintTemplateOutputType("pdf"), "pdf");
  assert.equal(normalizePrintTemplateOutputType("gmail"), "gmail");
  assert.equal(normalizePrintTemplateOutputType("googleDoc"), "googleDoc");
  assert.equal(normalizePrintTemplateOutputType("spreadsheet"), "pdf");
  assert.equal(normalizePrintTemplateOutputType(undefined), "pdf");
});

test("getPrintTemplateOutputLabel は googleDoc を「Google ドキュメント」と表示する", () => {
  assert.equal(getPrintTemplateOutputLabel("googleDoc"), "Google ドキュメント");
  assert.equal(getPrintTemplateOutputLabel({ outputType: "googleDoc" }), "Google ドキュメント");
  assert.equal(getPrintTemplateOutputLabel({ outputType: "gmail" }), "Gmail");
  assert.equal(getPrintTemplateOutputLabel({ outputType: "spreadsheet" }), "PDF");
});

test("normalizePrintTemplateAction は googleDoc 出力タイプとカスタムテンプレ URL を保持する", () => {
  const action = normalizePrintTemplateAction({
    enabled: true,
    outputType: "googleDoc",
    useCustomTemplate: true,
    templateUrl: "https://docs.google.com/document/d/abc/edit",
    fileNameTemplate: "{`_id`}_doc",
  });
  assert.equal(action.outputType, "googleDoc");
  assert.equal(action.useCustomTemplate, true);
  assert.equal(action.templateUrl, "https://docs.google.com/document/d/abc/edit");
  assert.equal(action.fileNameTemplate, "{`_id`}_doc");
});

test("requiresPrintTemplateFileName は googleDoc でファイル名を必須にする", () => {
  assert.equal(requiresPrintTemplateFileName({ outputType: "googleDoc" }), true);
});

test("resolveEffectivePrintTemplateFileNameTemplate は googleDoc を PDF と同様に解決する", () => {
  assert.equal(
    resolveEffectivePrintTemplateFileNameTemplate(
      { outputType: "googleDoc", fileNameTemplate: "{ID}_個別Doc" },
      { standardPrintFileNameTemplate: "{ID}_共通" },
    ),
    "{ID}_個別Doc",
  );
  assert.equal(
    resolveEffectivePrintTemplateFileNameTemplate(
      { outputType: "googleDoc", fileNameTemplate: "" },
      { standardPrintFileNameTemplate: "{ID}_共通" },
    ),
    "{ID}_共通",
  );
  assert.equal(
    resolveEffectivePrintTemplateFileNameTemplate(
      { outputType: "googleDoc", fileNameTemplate: "" },
      {},
    ),
    DEFAULT_STANDARD_PRINT_FILE_NAME_TEMPLATE,
  );
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

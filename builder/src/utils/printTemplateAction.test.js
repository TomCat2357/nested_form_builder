import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STANDARD_PRINT_FILE_NAME_TEMPLATE,
  extractDriveFileId,
  getPrintTemplateOutputLabel,
  normalizePrintTemplateAction,
  normalizePrintTemplateOutputType,
  requiresPrintTemplateFileName,
  resolveEffectivePrintTemplateFileNameTemplate,
  resolvePrintTemplateId,
  resolveStandardPrintTemplateId,
  resolveSharedPrintFileNameTemplate,
} from "./printTemplateAction.js";

const REAL_ID = "1AbcDEF_ghiJKLmnopQRstuvWXyz12345";

test("resolvePrintTemplateId は templateId を優先し、旧 templateUrl からも素 fileId を解決する", () => {
  assert.equal(resolvePrintTemplateId({ templateId: REAL_ID }), REAL_ID);
  assert.equal(resolvePrintTemplateId({ templateId: "", templateUrl: `https://docs.google.com/document/d/${REAL_ID}/edit` }), REAL_ID);
  assert.equal(resolvePrintTemplateId({}), "");
  assert.equal(resolvePrintTemplateId(null), "");
});

test("resolveStandardPrintTemplateId は新 standardPrintTemplateId を優先し旧 URL から後方互換解決する", () => {
  assert.equal(resolveStandardPrintTemplateId({ standardPrintTemplateId: REAL_ID }), REAL_ID);
  assert.equal(resolveStandardPrintTemplateId({ standardPrintTemplateUrl: `https://docs.google.com/document/d/${REAL_ID}/edit` }), REAL_ID);
  assert.equal(resolveStandardPrintTemplateId({}), "");
});

test("extractDriveFileId は Docs/Drive の各種 URL からファイル ID を取り出す", () => {
  assert.equal(
    extractDriveFileId("https://docs.google.com/document/d/1AbcDEF_ghiJKLmnopQRstuvWXyz12345/edit"),
    "1AbcDEF_ghiJKLmnopQRstuvWXyz12345",
  );
  assert.equal(
    extractDriveFileId("https://drive.google.com/open?id=1AbcDEF_ghiJKLmnopQRstuvWXyz12345"),
    "1AbcDEF_ghiJKLmnopQRstuvWXyz12345",
  );
  assert.equal(extractDriveFileId(""), "");
  assert.equal(extractDriveFileId(null), "");
  assert.equal(extractDriveFileId("not a url"), "");
});

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
    templateId: "",
    templatePath: "",
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

test("normalizePrintTemplateAction は googleDoc 出力タイプと素 fileId（templateId）を保持する", () => {
  const action = normalizePrintTemplateAction({
    enabled: true,
    outputType: "googleDoc",
    useCustomTemplate: true,
    templateId: "1AbcDEF_ghiJKLmnopQRstuvWXyz12345",
    fileNameTemplate: "{`_id`}_doc",
  });
  assert.equal(action.outputType, "googleDoc");
  assert.equal(action.useCustomTemplate, true);
  assert.equal(action.templateId, "1AbcDEF_ghiJKLmnopQRstuvWXyz12345");
  assert.equal(action.templateUrl, undefined);
  assert.equal(action.fileNameTemplate, "{`_id`}_doc");
});

test("normalizePrintTemplateAction は旧 templateUrl（URL）から templateId へ後方互換移行する", () => {
  const action = normalizePrintTemplateAction({
    enabled: true,
    outputType: "googleDoc",
    useCustomTemplate: true,
    templateUrl: "https://docs.google.com/document/d/1AbcDEF_ghiJKLmnopQRstuvWXyz12345/edit",
  });
  assert.equal(action.templateId, "1AbcDEF_ghiJKLmnopQRstuvWXyz12345");
  assert.equal(action.templateUrl, undefined);
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

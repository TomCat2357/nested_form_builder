import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePrintTemplateAction,
  requiresPrintTemplateFileName,
  resolveEffectivePrintTemplateFileNameTemplate,
  resolveSharedPrintFileNameTemplate,
  usesPrintTemplatePdfLink,
} from "./printTemplateAction.js";

test("normalizePrintTemplateAction は Gmail 設定項目を文字列で正規化する", () => {
  const action = normalizePrintTemplateAction({
    enabled: true,
    outputType: "gmail",
    gmailTemplateTo: "{メールアドレス}",
    gmailTemplateCc: null,
    gmailTemplateBcc: "bcc@example.com",
    gmailTemplateSubject: "{ID} のご案内",
    gmailTemplateBody: "本文 {_PDF}",
  });

  assert.deepEqual(action, {
    enabled: true,
    outputType: "gmail",
    useCustomTemplate: false,
    templateUrl: "",
    fileNameTemplate: "",
    gmailTemplateTo: "{メールアドレス}",
    gmailTemplateCc: "",
    gmailTemplateBcc: "bcc@example.com",
    gmailTemplateSubject: "{ID} のご案内",
    gmailTemplateBody: "本文 {_PDF}",
  });
});

test("resolveSharedPrintFileNameTemplate はフォーム共通ファイル名設定を trim して返す", () => {
  assert.equal(
    resolveSharedPrintFileNameTemplate({ standardPrintFileNameTemplate: "  {ID}_共通PDF  " }),
    "{ID}_共通PDF",
  );
  assert.equal(resolveSharedPrintFileNameTemplate({}), "");
});

test("usesPrintTemplatePdfLink は Gmail 本文の {_PDF} 利用有無を判定する", () => {
  assert.equal(usesPrintTemplatePdfLink({ outputType: "gmail", gmailTemplateBody: "本文 {_PDF}" }), true);
  assert.equal(usesPrintTemplatePdfLink({ outputType: "gmail", gmailTemplateBody: "本文のみ" }), false);
});

test("requiresPrintTemplateFileName は Gmail で {_PDF} を使わない場合は false を返す", () => {
  assert.equal(requiresPrintTemplateFileName({ outputType: "gmail", gmailTemplateBody: "本文のみ" }), false);
  assert.equal(requiresPrintTemplateFileName({ outputType: "gmail", gmailTemplateBody: "本文 {_PDF}" }), true);
  assert.equal(requiresPrintTemplateFileName({ outputType: "pdf" }), true);
});

test("resolveEffectivePrintTemplateFileNameTemplate は GoogleDocument/PDF で共通設定へフォールバックする", () => {
  assert.equal(
    resolveEffectivePrintTemplateFileNameTemplate(
      { outputType: "googleDoc", fileNameTemplate: "" },
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
});

test("resolveEffectivePrintTemplateFileNameTemplate は Gmail の {_PDF} で共通設定を優先し旧個別設定へ後方互換フォールバックする", () => {
  assert.equal(
    resolveEffectivePrintTemplateFileNameTemplate(
      { outputType: "gmail", fileNameTemplate: "{ID}_旧個別", gmailTemplateBody: "本文 {_PDF}" },
      { standardPrintFileNameTemplate: "{ID}_共通PDF" },
    ),
    "{ID}_共通PDF",
  );
  assert.equal(
    resolveEffectivePrintTemplateFileNameTemplate(
      { outputType: "gmail", fileNameTemplate: "{ID}_旧個別", gmailTemplateBody: "本文 {_PDF}" },
      {},
    ),
    "{ID}_旧個別",
  );
  assert.equal(
    resolveEffectivePrintTemplateFileNameTemplate(
      { outputType: "gmail", fileNameTemplate: "{ID}_旧個別", gmailTemplateBody: "本文のみ" },
      { standardPrintFileNameTemplate: "{ID}_共通PDF" },
    ),
    "",
  );
});

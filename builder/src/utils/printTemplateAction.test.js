import test from "node:test";
import assert from "node:assert/strict";
import { normalizePrintTemplateAction } from "./printTemplateAction.js";

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

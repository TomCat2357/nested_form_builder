import test from "node:test";
import assert from "node:assert/strict";
import { normalizePrintTemplateAction } from "./printTemplateAction.js";
import { validateOutputAction } from "./recordOutputActions.js";

const settingsWithFileName = { standardPrintFileNameTemplate: "{{`_id`}}_{{TIME_FORMAT(NOW(), 'YYYY-MM-DD')}}" };

test("validateOutputAction はカスタムテンプレ未指定（URL空）を正常とみなす（pdf / googleDoc / gmail+添付）", () => {
  for (const outputType of ["pdf", "googleDoc"]) {
    const action = normalizePrintTemplateAction({ enabled: true, outputType, fileNameTemplate: "{{`_id`}}_出力" });
    assert.deepEqual(validateOutputAction(action, {}), { valid: true });
  }
  const gmailAction = normalizePrintTemplateAction({
    enabled: true,
    outputType: "gmail",
    gmailAttachPdf: true,
  });
  assert.deepEqual(validateOutputAction(gmailAction, settingsWithFileName), { valid: true });
});

test("validateOutputAction はカスタムテンプレ ON だが URL 未入力ならエラー（googleDoc / gmail+添付）", () => {
  const docAction = normalizePrintTemplateAction({
    enabled: true,
    outputType: "googleDoc",
    useCustomTemplate: true,
    templateUrl: "   ",
    fileNameTemplate: "{{`_id`}}_出力",
  });
  assert.equal(validateOutputAction(docAction, {}).valid, false);

  const gmailAction = normalizePrintTemplateAction({
    enabled: true,
    outputType: "gmail",
    gmailAttachPdf: true,
    useCustomTemplate: true,
    templateUrl: "",
  });
  assert.equal(validateOutputAction(gmailAction, settingsWithFileName).valid, false);
});

test("validateOutputAction は gmail で PDF 添付なしなら useCustomTemplate を無視する", () => {
  const action = normalizePrintTemplateAction({
    enabled: true,
    outputType: "gmail",
    gmailAttachPdf: false,
    useCustomTemplate: true,
    templateUrl: "",
  });
  assert.deepEqual(validateOutputAction(action, {}), { valid: true });
});

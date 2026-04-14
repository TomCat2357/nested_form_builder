import {
  normalizePrintTemplateAction,
  requiresPrintTemplateFileName,
  resolveEffectivePrintTemplateFileNameTemplate,
} from "./printTemplateAction.js";

/**
 * 出力アクション実行前のバリデーション
 * @param {Object} action - normalizePrintTemplateAction 済みのアクション
 * @param {Object} settings - フォーム設定
 * @returns {{ valid: boolean, error?: string }}
 */
export const validateOutputAction = (action, settings) => {
  const effectiveFileNameTemplate = resolveEffectivePrintTemplateFileNameTemplate(action, settings);
  if (requiresPrintTemplateFileName(action) && !effectiveFileNameTemplate) {
    return {
      valid: false,
      error: action.outputType === "gmail"
        ? "PDF 添付を使うには、フォーム設定の印刷様式出力ファイル名規則を設定してください"
        : "出力ファイル名が設定されていません",
    };
  }
  if (action.outputType !== "gmail" && action.useCustomTemplate && !String(action.templateUrl || "").trim()) {
    return { valid: false, error: "カスタムテンプレートURLを設定してください" };
  }
  return { valid: true };
};

/**
 * PDF base64 データをブラウザダウンロードする
 * @param {string} base64 - base64エンコードされたPDFデータ
 * @param {string} fileName - ダウンロードファイル名
 */
export const downloadPdfFromBase64 = (base64, fileName) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

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
        ? "PDF 添付を使うには、フォーム設定の標準様式出力ファイル名規則を設定してください"
        : "出力ファイル名が設定されていません",
    };
  }
  if (action.outputType !== "gmail" && action.useCustomTemplate && !String(action.templateUrl || "").trim()) {
    return { valid: false, error: "カスタムテンプレートURLを設定してください" };
  }
  return { valid: true };
};

/**
 * 出力結果のアラート表示用オプションを構築
 * @param {Object} result - GAS API の戻り値
 * @param {string} [fallbackOutputType] - result.outputType が未設定時のフォールバック
 * @returns {{ message: string, url: string, linkLabel: string }}
 */
export const buildRecordOutputAlertOptions = (result, fallbackOutputType) => {
  const outputType = result?.outputType || fallbackOutputType || "";
  return {
    message: "様式出力を準備しました。",
    url: result?.openUrl || "",
    linkLabel: outputType === "gmail" ? "Gmail下書きを開く" : "ファイルを開く",
  };
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

/**
 * executeRecordOutputAction の結果をハンドリングする
 * @param {Object} result - GAS API の戻り値
 * @param {Object} callbacks
 * @param {Function} callbacks.showOutputAlert - ({ message, url, linkLabel }) => void
 * @param {string} [callbacks.fallbackOutputType] - result.outputType が未設定時のフォールバック
 * @param {Function} [callbacks.onDriveFolderStateUpdate] - (result) => void
 */
export const handleRecordOutputResult = (result, callbacks) => {
  if (!result) return;
  const { showOutputAlert, fallbackOutputType, onDriveFolderStateUpdate } = callbacks;

  if ((result.fileId || result.folderUrl) && typeof onDriveFolderStateUpdate === "function") {
    onDriveFolderStateUpdate(result);
  }
  if (result.openUrl && typeof showOutputAlert === "function") {
    showOutputAlert(buildRecordOutputAlertOptions(result, fallbackOutputType));
  }
  if (result.pdfBase64 && result.fileName) {
    downloadPdfFromBase64(result.pdfBase64, result.fileName);
  }
};

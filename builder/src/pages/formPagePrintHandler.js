/**
 * FormPage の「印刷様式を出力」ハンドラ。
 *
 * FormPage.jsx から純関数として抽出。React state は ctx 引数経由。
 */

import { createRecordPrintDocument } from "../services/gasClient.js";
import {
  buildFieldValuesMap,
  collectFileUploadMeta,
} from "../features/preview/printDocument.js";
import { resolveSharedPrintFileNameTemplate } from "../utils/printTemplateAction.js";
import { createEmptyDriveFolderState } from "../utils/driveFolderState.js";
import { buildFolderUrlsByFieldFromStates } from "./formPageHelpers.js";

/**
 * 印刷様式出力。常にマイドライブ直下に保存。
 *
 * @param {object} ctx FormPage 由来のコンテキスト
 *   previewRef, form, entry, normalizedSchema, fieldPaths,
 *   omitEmptyRowsOnPrint, responsesRef, driveFolderStatesRef,
 *   setIsCreatingPrintDocument, showAlert, showOutputAlert
 */
export async function performFormPagePrintDocument(ctx) {
  const {
    previewRef,
    form,
    entry,
    normalizedSchema,
    fieldPaths,
    omitEmptyRowsOnPrint,
    responsesRef,
    driveFolderStatesRef,
    setIsCreatingPrintDocument,
    showAlert,
    showOutputAlert,
  } = ctx;

  const preview = previewRef.current;
  if (!preview || typeof preview.getPrintDocumentPayload !== "function") {
    showAlert("印刷様式の出力準備がまだできていません。少し待ってからもう一度お試しください。");
    return;
  }

  setIsCreatingPrintDocument(true);
  try {
    const payload = preview.getPrintDocumentPayload({
      omitEmptyRows: omitEmptyRowsOnPrint,
      driveFolderState: createEmptyDriveFolderState(),
    });
    // 印刷様式出力は常にマイドライブ直下に配置
    if (payload.driveSettings) {
      payload.driveSettings.rootFolderUrl = "";
      payload.driveSettings.folderUrl = "";
      payload.driveSettings.folderNameTemplate = "";
      payload.driveSettings.useTemporaryFolder = false;
    }
    const fileNameTemplate = resolveSharedPrintFileNameTemplate(form?.settings || {});
    if (fileNameTemplate) {
      const currentResponses = responsesRef.current || {};
      payload.fileNameTemplate = fileNameTemplate;
      if (payload.driveSettings) {
        payload.driveSettings.fileNameTemplate = fileNameTemplate;
      }
      payload.templateContext = {
        responses: currentResponses,
        fieldPaths,
        fieldValues: buildFieldValuesMap(normalizedSchema, currentResponses),
        fileUploadMeta: collectFileUploadMeta(normalizedSchema, {
          responses: currentResponses,
          folderUrlsByField: buildFolderUrlsByFieldFromStates(driveFolderStatesRef.current || {}),
        }),
        recordId: payload.recordId || "",
        formId: form?.id || "",
        recordNo: entry?.["No."] || "",
        formTitle: form?.settings?.formTitle || "",
      };
    }
    const result = await createRecordPrintDocument(payload);
    showOutputAlert({ message: "マイドライブに Google ドキュメントを保存しました。", url: result.fileUrl, linkLabel: "ファイルを開く" });
  } catch (error) {
    console.error("[FormPage] failed to create print document:", error);
    showAlert(`印刷様式の出力に失敗しました: ${error?.message || error}`);
  } finally {
    setIsCreatingPrintDocument(false);
  }
}

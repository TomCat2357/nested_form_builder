import { useState, useCallback } from "react";
import { findFirstFileUploadField } from "../../core/schema.js";
import {
  buildPrintDocumentPayload,
  buildFieldValuesMap,
} from "../preview/printDocument.js";
import { restoreResponsesFromData } from "../../utils/responses.js";
import {
  executeRecordOutputAction,
  executeBatchGoogleDocOutput,
} from "../../services/gasClient.js";
import {
  normalizePrintTemplateAction,
  resolveEffectivePrintTemplateFileNameTemplate,
  resolveSharedPrintFileNameTemplate,
  DEFAULT_STANDARD_PRINT_FILE_NAME_TEMPLATE,
} from "../../utils/printTemplateAction.js";
import {
  validateOutputAction,
  downloadPdfFromBase64,
} from "../../utils/recordOutputActions.js";

export function useSearchPagePrintActions({
  form,
  normalizedSchema,
  fieldLabels,
  omitEmptyRowsOnPrint,
  selectedPrintableRows,
  showAlert,
  showOutputAlert,
}) {
  const [isCreatingPrintDocument, setIsCreatingPrintDocument] = useState(false);

  const createPrintDocument = useCallback(async () => {
    setIsCreatingPrintDocument(true);
    try {
      const action = {
        enabled: true,
        outputType: "googleDoc",
        useCustomTemplate: false,
        templateUrl: "",
        fileNameTemplate: "",
      };
      const effectiveFileNameTemplate = resolveSharedPrintFileNameTemplate(form?.settings || {}) || DEFAULT_STANDARD_PRINT_FILE_NAME_TEMPLATE;

      const firstUploadField = findFirstFileUploadField(normalizedSchema);
      const recordPayloads = selectedPrintableRows.map(({ entry }) => {
        const restoredResponses = restoreResponsesFromData(normalizedSchema, entry?.data || {}, entry?.dataUnixMs || {});
        const fieldValues = buildFieldValuesMap(normalizedSchema, restoredResponses);
        const driveSettings = {
          rootFolderUrl: firstUploadField?.driveRootFolderUrl || "",
          folderNameTemplate: firstUploadField?.driveFolderNameTemplate || "",
          formId: form?.id || "",
          recordId: entry.id,
          folderUrl: entry.driveFolderUrl || "",
          responses: restoredResponses,
          fieldLabels,
          fieldValues,
          fileNameTemplate: effectiveFileNameTemplate,
        };
        return {
          action,
          settings: {
            standardPrintTemplateUrl: form?.settings?.standardPrintTemplateUrl || "",
            standardPrintFileNameTemplate: form?.settings?.standardPrintFileNameTemplate || "",
          },
          recordContext: {
            formTitle: form?.settings?.formTitle || "",
            formId: form?.id || "",
            recordId: entry.id,
            recordNo: entry?.["No."] || "",
            modifiedAt: entry?.modifiedAtUnixMs ?? entry?.modifiedAt ?? "",
            printPayload: buildPrintDocumentPayload({
              schema: normalizedSchema,
              responses: restoredResponses,
              settings: {
                ...(form?.settings || {}),
                formId: form?.id || "",
                recordNo: entry?.["No."],
                modifiedAt: entry?.modifiedAt,
                modifiedAtUnixMs: entry?.modifiedAtUnixMs,
              },
              recordId: entry.id,
              omitEmptyRows: omitEmptyRowsOnPrint,
              driveFolderState: {
                resolvedUrl: entry.driveFolderUrl || "",
                inputUrl: entry.driveFolderUrl || "",
              },
              useTemporaryFolder: true,
            }),
          },
          driveSettings,
        };
      });

      const combinedFileName = (form?.settings?.formTitle || "出力") + "_一括出力";
      const result = await executeBatchGoogleDocOutput({
        records: recordPayloads,
        fileNameTemplate: combinedFileName,
      });

      if (result?.openUrl) {
        showOutputAlert({
          message: `${selectedPrintableRows.length}件の印刷様式を出力しました。`,
          url: result.openUrl,
          linkLabel: "Google ドキュメントを開く",
        });
      }
    } catch (error) {
      console.error("[SearchPage] failed to create print document:", error);
      showAlert(`印刷様式の出力に失敗しました: ${error?.message || error}`);
    } finally {
      setIsCreatingPrintDocument(false);
    }
  }, [
    fieldLabels,
    form?.id,
    form?.settings,
    normalizedSchema,
    omitEmptyRowsOnPrint,
    selectedPrintableRows,
    showAlert,
    showOutputAlert,
  ]);

  const handleCellAction = useCallback(async (column, entry) => {
    if (!column || !entry) return;

    if (column.actionKind === "folderLink") {
      if (!entry.driveFolderUrl) {
        showAlert("保存先フォルダが未確定です。");
        return;
      }
      window.open(entry.driveFolderUrl, "_blank", "noopener,noreferrer");
      return;
    }

    if (column.actionKind !== "printTemplate") return;

    const action = normalizePrintTemplateAction(column.action);
    const validation = validateOutputAction(action, form?.settings || {});
    if (!validation.valid) {
      showAlert(validation.error);
      return;
    }

    const effectiveFileNameTemplate = resolveEffectivePrintTemplateFileNameTemplate(action, form?.settings || {});
    const restoredResponses = restoreResponsesFromData(normalizedSchema, entry?.data || {}, entry?.dataUnixMs || {});
    const fieldValues = buildFieldValuesMap(normalizedSchema, restoredResponses);
    const firstUploadFieldSingle = findFirstFileUploadField(normalizedSchema);
    const driveSettings = {
      rootFolderUrl: firstUploadFieldSingle?.driveRootFolderUrl || "",
      folderNameTemplate: firstUploadFieldSingle?.driveFolderNameTemplate || "",
      formId: form?.id || "",
      recordId: entry.id,
      folderUrl: entry.driveFolderUrl || "",
      responses: restoredResponses,
      fieldLabels,
      fieldValues,
      fileNameTemplate: effectiveFileNameTemplate,
    };

    const payload = {
      action,
      settings: {
        standardPrintTemplateUrl: form?.settings?.standardPrintTemplateUrl || "",
        standardPrintFileNameTemplate: form?.settings?.standardPrintFileNameTemplate || "",
      },
      recordContext: {
        formTitle: form?.settings?.formTitle || "",
        formId: form?.id || "",
        recordId: entry.id,
        recordNo: entry?.["No."] || "",
        modifiedAt: entry?.modifiedAtUnixMs ?? entry?.modifiedAt ?? "",
        printPayload: buildPrintDocumentPayload({
          schema: normalizedSchema,
          responses: restoredResponses,
          settings: {
            ...(form?.settings || {}),
            formId: form?.id || "",
            recordNo: entry?.["No."],
            modifiedAt: entry?.modifiedAt,
            modifiedAtUnixMs: entry?.modifiedAtUnixMs,
          },
          recordId: entry.id,
          omitEmptyRows: omitEmptyRowsOnPrint,
          driveFolderState: {
            resolvedUrl: entry.driveFolderUrl || "",
            inputUrl: entry.driveFolderUrl || "",
          },
          useTemporaryFolder: true,
        }),
      },
      driveSettings,
    };

    const result = await executeRecordOutputAction(payload);
    if (result?.openUrl) {
      const outputType = result.outputType || action.outputType || "";
      showOutputAlert({
        message: "様式出力を準備しました。",
        url: result.openUrl,
        linkLabel: outputType === "gmail" ? "Gmail下書きを開く" : "ファイルを開く",
      });
    }
    if (result?.pdfBase64 && result?.fileName) {
      downloadPdfFromBase64(result.pdfBase64, result.fileName);
    }
  }, [
    fieldLabels,
    form?.id,
    form?.settings,
    normalizedSchema,
    omitEmptyRowsOnPrint,
    showAlert,
    showOutputAlert,
  ]);

  const handleCreatePrintDocument = useCallback(async () => {
    if (selectedPrintableRows.length === 0) {
      showAlert("印刷するレコードを選択してください。");
      return;
    }

    await createPrintDocument();
  }, [selectedPrintableRows.length, showAlert, createPrintDocument]);

  return {
    isCreatingPrintDocument,
    handleCellAction,
    handleCreatePrintDocument,
  };
}

import { useState, useCallback } from "react";
import {
  buildPrintDocumentPayload,
  buildFieldValuesMap,
  collectFileUploadMeta,
} from "../preview/printDocument.js";
import { restoreResponsesFromData, collectFileUploadFolderUrls } from "../../utils/responses.js";
import {
  createRecordPrintDocument,
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

  const createSinglePrintDocument = useCallback(async (entry) => {
    const restoredResponses = restoreResponsesFromData(normalizedSchema, entry?.data || {}, entry?.dataUnixMs || {});
    const fieldValues = buildFieldValuesMap(normalizedSchema, restoredResponses);
    const fileUploadMeta = collectFileUploadMeta(normalizedSchema, {
      responses: restoredResponses,
      folderUrlsByField: collectFileUploadFolderUrls(normalizedSchema, entry?.data || {}),
    });
    const fileNameTemplate = resolveSharedPrintFileNameTemplate(form?.settings || {});

    const payload = buildPrintDocumentPayload({
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
      folderUrlsByField: collectFileUploadFolderUrls(normalizedSchema, entry?.data || {}),
    });

    if (fileNameTemplate) {
      payload.fileNameTemplate = fileNameTemplate;
      payload.templateContext = {
        responses: restoredResponses,
        fieldLabels,
        fieldValues,
        fileUploadMeta,
        recordId: entry.id,
        formId: form?.id || "",
        recordNo: entry?.["No."] || "",
        formTitle: form?.settings?.formTitle || "",
      };
    }

    // 検索ページからの出力は常にマイドライブ直下に配置
    if (payload.driveSettings) {
      payload.driveSettings.rootFolderUrl = "";
      payload.driveSettings.folderUrl = "";
      payload.driveSettings.folderNameTemplate = "";
      payload.driveSettings.useTemporaryFolder = false;
      if (fileNameTemplate) {
        payload.driveSettings.fileNameTemplate = fileNameTemplate;
      }
    }

    const result = await createRecordPrintDocument(payload);
    if (result?.fileUrl) {
      showOutputAlert({
        message: "印刷様式を出力しました。",
        url: result.fileUrl,
        linkLabel: "Google ドキュメントを開く",
      });
    }
  }, [fieldLabels, form?.id, form?.settings, normalizedSchema, omitEmptyRowsOnPrint, showOutputAlert]);

  const createBatchPrintDocument = useCallback(async () => {
    const action = {
      enabled: true,
      outputType: "googleDoc",
      useCustomTemplate: false,
      templateUrl: "",
      fileNameTemplate: "",
    };
    const effectiveFileNameTemplate = resolveSharedPrintFileNameTemplate(form?.settings || {}) || DEFAULT_STANDARD_PRINT_FILE_NAME_TEMPLATE;

    const recordPayloads = selectedPrintableRows.map(({ entry }) => {
      const restoredResponses = restoreResponsesFromData(normalizedSchema, entry?.data || {}, entry?.dataUnixMs || {});
      const fieldValues = buildFieldValuesMap(normalizedSchema, restoredResponses);
      const fileUploadMeta = collectFileUploadMeta(normalizedSchema, {
        responses: restoredResponses,
        folderUrlsByField: collectFileUploadFolderUrls(normalizedSchema, entry?.data || {}),
      });
      const driveSettings = {
        rootFolderUrl: "",
        folderNameTemplate: "",
        formId: form?.id || "",
        recordId: entry.id,
        folderUrl: "",
        responses: restoredResponses,
        fieldLabels,
        fieldValues,
        fileUploadMeta,
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
            folderUrlsByField: collectFileUploadFolderUrls(normalizedSchema, entry?.data || {}),
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
  }, [
    fieldLabels,
    form?.id,
    form?.settings,
    normalizedSchema,
    omitEmptyRowsOnPrint,
    selectedPrintableRows,
    showOutputAlert,
  ]);

  const createPrintDocument = useCallback(async () => {
    setIsCreatingPrintDocument(true);
    try {
      if (selectedPrintableRows.length === 1) {
        await createSinglePrintDocument(selectedPrintableRows[0].entry);
      } else {
        await createBatchPrintDocument();
      }
    } catch (error) {
      console.error("[SearchPage] failed to create print document:", error);
      showAlert(`印刷様式の出力に失敗しました: ${error?.message || error}`);
    } finally {
      setIsCreatingPrintDocument(false);
    }
  }, [
    selectedPrintableRows,
    createSinglePrintDocument,
    createBatchPrintDocument,
    showAlert,
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
    const fileUploadMetaSingle = collectFileUploadMeta(normalizedSchema, {
      responses: restoredResponses,
      folderUrlsByField: collectFileUploadFolderUrls(normalizedSchema, entry?.data || {}),
    });
    const driveSettings = {
      rootFolderUrl: "",
      folderNameTemplate: "",
      formId: form?.id || "",
      recordId: entry.id,
      folderUrl: "",
      responses: restoredResponses,
      fieldLabels,
      fieldValues,
      fileUploadMeta: fileUploadMetaSingle,
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

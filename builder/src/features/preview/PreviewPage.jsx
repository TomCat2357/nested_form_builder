import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { collectResponses, sortResponses } from "../../core/collect.js";
import { computeSchemaHash } from "../../core/schema.js";
import { collectValidationErrors, formatValidationErrors } from "../../core/validate.js";
import * as gasClientModule from "../../services/gasClient.js";
const { submitResponses, hasScriptRun } = gasClientModule;
import { normalizeSpreadsheetId } from "../../utils/spreadsheet.js";
import { styles as s } from "../editor/styles.js";
import { useAlert } from "../../app/hooks/useAlert.js";
import { collectDefaultNowResponses } from "../../utils/responses.js";
import { genRecordId } from "../../core/ids.js";
import { resolveTemplateTokens, buildLabelValueMap, collectFileUploadFieldIds, extractFileUrls } from "../../utils/tokenReplacer.js";
import { evaluateAllComputedFields } from "../../core/computedFields.js";
import {
  buildPrintDocumentPayload,
  buildFieldLabelsMap,
  buildFieldValuesMap,
  collectFileUploadMeta,
  formatRecordMetaDateTime,
} from "./printDocument.js";
import {
  normalizePrintTemplateAction,
  resolveEffectivePrintTemplateFileNameTemplate,
} from "../../utils/printTemplateAction.js";
import {
  validateOutputAction,
  downloadPdfFromBase64,
} from "../../utils/recordOutputActions.js";
import {
  appendDriveFileId,
  normalizeDriveFolderState,
  resolveEffectiveDriveFolderUrl,
} from "../../utils/driveFolderState.js";
import { buildSharedFormUrl, buildSharedRecordUrl } from "../../utils/formShareUrl.js";
import { RendererRecursive } from "./FieldRenderer.jsx";

const PreviewPage = React.forwardRef(function PreviewPage(
  {
    schema,
    responses,
    setResponses,
    settings = {},
    showOutputJson = true,
    onSave,
    onRecordNoChange,
    saveButtonLabel = "回答保存",
    showSaveButton = true,
    readOnly = false,
    entryId,
    onChildFormJump,
    driveFolderState,
    onDriveFolderStateChange,
    canDeleteDriveFolder,
    onDeleteDriveFolder,
  },
  ref,
) {
  const { showAlert, showOutputAlert } = useAlert();
  const initialRecordId = settings.recordId;
  const recordIdRef = useRef(initialRecordId || genRecordId());
  const currentUserName = typeof settings.userName === "string" ? settings.userName : "";
  const currentUserEmail = typeof settings.userEmail === "string" ? settings.userEmail : "";
  const currentUserAffiliation = typeof settings.userAffiliation === "string" ? settings.userAffiliation : "";
  const currentUserTitle = typeof settings.userTitle === "string" ? settings.userTitle : "";
  const currentUserPhone = typeof settings.userPhone === "string" ? settings.userPhone : "";
  const defaultNowMap = useMemo(
    () => collectDefaultNowResponses(schema, new Date(), {
      userName: currentUserName,
      userEmail: currentUserEmail,
      userAffiliation: currentUserAffiliation,
      userTitle: currentUserTitle,
      userPhone: currentUserPhone,
    }),
    [schema, currentUserName, currentUserEmail, currentUserAffiliation, currentUserTitle, currentUserPhone],
  );

  useEffect(() => {
    if (initialRecordId && recordIdRef.current !== initialRecordId) {
      recordIdRef.current = initialRecordId;
    }
  }, [initialRecordId]);

  useEffect(() => {
    // 既往データ編集時は自動初期値設定をスキップ
    if (settings.recordId) return;

    if (!defaultNowMap || Object.keys(defaultNowMap).length === 0) return;
    setResponses((prev) => {
      const current = prev || {};
      let changed = false;
      const next = { ...current };
      const appliedKeys = [];
      Object.keys(defaultNowMap).forEach((key) => {
        const currentValue = next[key];
        if (currentValue === undefined || currentValue === null || currentValue === "") {
          next[key] = defaultNowMap[key];
          changed = true;
          appliedKeys.push(key);
        }
      });
      if (changed) {
        console.log("[PreviewPage] defaultNow values applied", {
          recordId: settings.recordId || null,
          appliedCount: appliedKeys.length,
          appliedKeys: appliedKeys.slice(0, 8),
        });
      }
      return changed ? next : current;
    });
  }, [defaultNowMap, setResponses, settings.recordId]);

  const formTitle = settings.formTitle || "受付フォーム";
  const modifiedAtDisplay = formatRecordMetaDateTime(settings.modifiedAtUnixMs ?? settings.modifiedAt);
  const fieldLabels = useMemo(() => buildFieldLabelsMap(schema), [schema]);
  const fieldValues = useMemo(() => buildFieldValuesMap(schema, responses), [schema, responses]);

  const gasClientRef = useRef(gasClientModule);
  const fileUploadMeta = useMemo(() => collectFileUploadMeta(schema), [schema]);
  const fileUrls = useMemo(() => {
    const ids = new Set();
    collectFileUploadFieldIds(schema, ids);
    const parts = [];
    for (const fid of ids) {
      const urls = extractFileUrls((responses || {})[fid]);
      if (urls) parts.push(urls);
    }
    return parts.join(", ");
  }, [schema, responses]);
  const driveSettings = useMemo(() => ({
    formId: settings.formId || "",
    recordId: recordIdRef.current,
    responses: responses || {},
    fieldLabels,
    fieldValues,
    fileUploadMeta,
    fileUrls,
  }), [settings.formId, responses, fieldLabels, fieldValues, fileUploadMeta, fileUrls]);

  const baseLabelValueMap = useMemo(
    () => buildLabelValueMap(fieldLabels, fieldValues, responses),
    [fieldLabels, fieldValues, responses],
  );

  const tokenContext = useMemo(() => {
    const baseUrl = typeof window !== "undefined" ? (window.__GAS_WEBAPP_URL__ || window.location.origin) : "";
    const formId = settings.formId || "";
    const recordId = recordIdRef.current;
    const folderUrl = resolveEffectiveDriveFolderUrl(driveFolderState) || "";
    const formUrl = buildSharedFormUrl(baseUrl, formId);
    const recordUrl = buildSharedRecordUrl(baseUrl, formId, recordId);
    return { now: new Date(), recordId, folderUrl, formUrl, recordUrl };
  }, [settings.formId, driveFolderState]);

  const { computedValues, computedErrors } = useMemo(
    () => evaluateAllComputedFields(schema, responses, baseLabelValueMap, tokenContext),
    [schema, responses, baseLabelValueMap, tokenContext],
  );

  const resolveTokens = useMemo(() => {
    const labelValueMap = { ...baseLabelValueMap };
    if (computedValues) {
      const fieldLabelsMap = fieldLabels || {};
      for (const [fid, val] of Object.entries(computedValues)) {
        const label = fieldLabelsMap[fid];
        if (label && val != null) labelValueMap[label] = String(val);
      }
    }
    const ctx = { ...tokenContext, labelValueMap };
    return (text) => resolveTemplateTokens(text, ctx);
  }, [baseLabelValueMap, computedValues, fieldLabels, tokenContext]);

  const mergedResponses = useMemo(() => {
    if (!computedValues || Object.keys(computedValues).length === 0) return responses;
    return { ...responses, ...computedValues };
  }, [responses, computedValues]);

  const sortedData = useMemo(() => {
    const raw = collectResponses(schema, mergedResponses);
    return sortResponses(raw, schema, mergedResponses);
  }, [schema, mergedResponses]);
  const output = sortedData.map;
  const sortedKeys = sortedData.keys;

  const [isSaving, setIsSaving] = useState(false);
  const updateDriveFolderStateFromPrintResult = (result) => {
    if (typeof onDriveFolderStateChange !== "function") return;
    onDriveFolderStateChange((prevState) => {
      const prev = normalizeDriveFolderState(prevState);
      const currentEffectiveFolderUrl = resolveEffectiveDriveFolderUrl(prev);
      const nextResolvedUrl = typeof result?.folderUrl === "string" && result.folderUrl.trim()
        ? result.folderUrl.trim()
        : (currentEffectiveFolderUrl || prev.resolvedUrl);
      const keepAutoCreated = prev.autoCreated && prev.resolvedUrl.trim() && prev.resolvedUrl.trim() === nextResolvedUrl;
      return normalizeDriveFolderState({
        ...prev,
        resolvedUrl: nextResolvedUrl,
        inputUrl: prev.inputUrl.trim() ? prev.inputUrl : nextResolvedUrl,
        autoCreated: keepAutoCreated || result?.autoCreated === true,
        pendingPrintFileIds: appendDriveFileId(prev.pendingPrintFileIds, result?.fileId),
      });
    });
  };
  const handleFieldTemplateAction = async (field) => {
    const action = normalizePrintTemplateAction(field?.printTemplateAction);
    if (!action.enabled) return;

    const validation = validateOutputAction(action, settings);
    if (!validation.valid) {
      showAlert(validation.error);
      return;
    }

    const effectiveFileNameTemplate = resolveEffectivePrintTemplateFileNameTemplate(action, settings);
    const effectiveFolderUrl = resolveEffectiveDriveFolderUrl(driveFolderState);
    const baseDriveTemplateSettings = {
      ...driveSettings,
      ...(effectiveFolderUrl ? { folderUrl: effectiveFolderUrl } : {}),
      recordId: recordIdRef.current,
      responses: responses || {},
      fieldLabels,
      fieldValues,
      fileUrls,
    };
    try {
      const result = await gasClientRef.current.executeRecordOutputAction({
        action,
        settings: {
          standardPrintTemplateUrl: settings.standardPrintTemplateUrl || "",
          standardPrintFileNameTemplate: settings.standardPrintFileNameTemplate || "",
        },
        recordContext: {
          formTitle,
          formId: settings.formId || "",
          recordId: recordIdRef.current,
          recordNo: settings.recordNo || "",
          modifiedAt: settings.modifiedAtUnixMs ?? settings.modifiedAt ?? "",
          printPayload: getPrintDocumentPayload({
            driveFolderState,
            useTemporaryFolder: true,
          }),
        },
        driveSettings: {
          ...baseDriveTemplateSettings,
          fileNameTemplate: effectiveFileNameTemplate,
        },
      });
      if (result?.fileId || result?.folderUrl) {
        updateDriveFolderStateFromPrintResult(result);
      }
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
    } catch (error) {
      showAlert(`様式出力に失敗しました: ${error?.message || error}`);
    }
  };

  const getPrintDocumentPayload = (options = {}) => buildPrintDocumentPayload({
    schema,
    responses,
    settings,
    recordId: recordIdRef.current,
    omitEmptyRows: options.omitEmptyRows,
    driveFolderState: options.driveFolderState ?? driveFolderState,
    useTemporaryFolder: options.useTemporaryFolder === true,
  });

  const handleSaveToSheet = async (options = {}) => {
    let alertShown = false;
    setIsSaving(true);
    try {
      if (readOnly) {
        throw new Error("read_only_mode");
      }
      const validationResult = collectValidationErrors(schema, responses);
      if (validationResult.errors.length > 0) {
        showAlert(formatValidationErrors(validationResult), "入力エラー");
        alertShown = true;
        throw new Error("validation_failed");
      }

      let spreadsheetId = null;
      if (!onSave) {
        const scriptRunAvailable = hasScriptRun();
        spreadsheetId = normalizeSpreadsheetId(settings.spreadsheetId || "");
        if (!spreadsheetId) {
          showAlert("Spreadsheet ID / URL が未入力です");
          alertShown = true;
          throw new Error("missing_spreadsheet_id");
        }
        if (!scriptRunAvailable) {
          showAlert("この機能はGoogle Apps Script環境でのみ利用可能です");
          alertShown = true;
          throw new Error("missing_script_run");
        }
      }

      const payload = {
        version: 1,
        formTitle,
        schemaHash: computeSchemaHash(schema),
        id: recordIdRef.current,
        responses: output,
        order: sortedKeys,
      };

      if (onSave) {
        const result = await onSave({
          payload,
          sortedKeys,
          recordId: recordIdRef.current,
          responses,
          options,
        });
        return result ?? payload;
      }
      const res = await submitResponses({
        spreadsheetId,
        sheetName: settings.sheetName || "Data",
        payload,
      });
      const msg = res?.spreadsheetUrl
        ? `送信しました（${res.sheetName} に追記 / 行: ${res.rowNumber}）`
        : "送信しました";
      showAlert(msg);
      return res;
    } catch (error) {
      console.error("[PreviewPage] Error in handleSaveToSheet:", error);
      const suppressAlert = alertShown
        || error?.message === "validation_failed"
        || error?.message === "missing_spreadsheet_id"
        || error?.message === "missing_script_run"
        || error?.message === "read_only_mode";
      if (!options?.silent && !suppressAlert) {
        showAlert(`送信に失敗しました: ${error?.message || error}`);
      }
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      submit: handleSaveToSheet,
      getRecordId: () => recordIdRef.current,
      getOutput: () => ({ map: output, keys: sortedKeys }),
      getPrintDocumentPayload,
    }),
    [getPrintDocumentPayload, handleSaveToSheet, output, sortedKeys],
  );

  return (
    <div className="nf-card" data-depth="0">
      <h2 className="preview-title">{formTitle}</h2>
      {settings.showRecordNo !== false && (
        <div className="nf-mb-12">
          <label className="preview-label">No.</label>
          <input
            type="text"
            value={settings.recordNo || ""}
            readOnly={readOnly}
            className={`nf-input${readOnly ? " nf-input--readonly" : ""}`}
            onChange={(event) => {
              if (readOnly || typeof onRecordNoChange !== "function") return;
              onRecordNoChange(event.target.value);
            }}
          />
        </div>
      )}
      <div className="nf-mb-12">
        <label className="preview-label">ID</label>
        <input type="text" value={recordIdRef.current} readOnly className="nf-input nf-input--readonly" />
      </div>
      <div className="nf-mb-12">
        <label className="preview-label">最終更新日時</label>
        <input type="text" value={modifiedAtDisplay || "-"} readOnly className="nf-input nf-input--readonly" />
      </div>
      <RendererRecursive
        fields={schema}
        responses={responses}
        onChange={setResponses}
        readOnly={readOnly}
        entryId={entryId}
        onChildFormJump={onChildFormJump}
        driveSettings={driveSettings}
        gasClientRef={gasClientRef}
        driveFolderState={driveFolderState}
        onDriveFolderStateChange={onDriveFolderStateChange}
        onTemplateAction={handleFieldTemplateAction}
        canDeleteDriveFolder={canDeleteDriveFolder}
        onDeleteDriveFolder={onDeleteDriveFolder}
        resolveTokens={resolveTokens}
        computedValues={computedValues}
        computedErrors={computedErrors}
      />
      {showOutputJson && (
        <div className="nf-mt-12">
          <label className="preview-label">回答JSON</label>
          <textarea
            readOnly
            value={JSON.stringify(output, null, 2)}
            className={`${s.input.className} preview-json`}
          />
        </div>
      )}
      {showSaveButton && !readOnly && (
        <div className="nf-row nf-gap-8 nf-mt-12 nf-justify-end">
          <button type="button" className={s.btn.className} onClick={handleSaveToSheet} disabled={isSaving}>
            {isSaving ? "保存中..." : saveButtonLabel}
          </button>
        </div>
      )}
</div>
  );
});

export default PreviewPage;

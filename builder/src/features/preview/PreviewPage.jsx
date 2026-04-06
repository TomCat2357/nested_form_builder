import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { collectResponses, sortResponses } from "../../core/collect.js";
import { computeSchemaHash } from "../../core/schema.js";
import { collectValidationErrors, formatValidationErrors, isNumberInputDraftAllowed, validateByPattern } from "../../core/validate.js";
import * as gasClientModule from "../../services/gasClient.js";
const { submitResponses, hasScriptRun } = gasClientModule;
import { normalizeSpreadsheetId } from "../../utils/spreadsheet.js";
import { styles as s } from "../editor/styles.js";
import { useAlert } from "../../app/hooks/useAlert.js";
import { collectDefaultNowResponses } from "../../utils/responses.js";
import { resolveLabelSize, resolveTextColor } from "../../core/styleSettings.js";
import { genRecordId } from "../../core/ids.js";
import { getStandardPhonePlaceholder } from "../../core/phone.js";
import {
  buildPrintDocumentPayload,
  buildFieldLabelsMap,
  buildFieldValuesMap,
  CHOICE_TYPES,
  formatRecordMetaDateTime,
  hasVisibleValue,
  isTextareaField,
  toSelectedChoiceLabels,
} from "./printDocument.js";
import {
  getPrintTemplateOutputLabel,
  normalizePrintTemplateAction,
  requiresPrintTemplateFileName,
  resolveEffectivePrintTemplateFileNameTemplate,
} from "../../utils/printTemplateAction.js";
import {
  appendDriveFileId,
  normalizeDriveFolderState,
  resolveEffectiveDriveFolderUrl,
} from "../../utils/driveFolderState.js";
import FileUploadField from "./FileUploadField.jsx";

const resolveConfiguredPlaceholder = (field, fallback = "") => {
  if (field?.showPlaceholder !== true) return "";
  return field?.placeholder || fallback;
};

const getNumberInputMode = (field) => (field?.integerOnly ? "numeric" : "decimal");

const FieldRenderer = ({
  field,
  value,
  onChange,
  renderChildrenAll,
  renderChildrenForOption,
  readOnly = false,
  driveSettings,
  gasClientRef,
  driveFolderState,
  onDriveFolderStateChange,
  onTemplateAction,
}) => {
  const validation = validateByPattern(field, value);
  const selectedChoiceLabels = toSelectedChoiceLabels(field, value);
  const selectedSingleChoice = selectedChoiceLabels[0] || "";
  const showInlineValidation = !validation.ok && (validation.code === "pattern_invalid" || hasVisibleValue(value));
  const readOnlyIsTextarea = isTextareaField(field);
  const textMaxLength = field.type === "text" && field.inputRestrictionMode === "maxLength"
    ? Math.max(1, Number(field.maxLength) || 1)
    : undefined;

  const renderReadOnlyValue = () => {
    if (CHOICE_TYPES.has(field.type)) {
      return selectedChoiceLabels.length > 0 ? selectedChoiceLabels.join(", ") : "\u00A0";
    }
    if (Array.isArray(value)) return value.join(", ");
    if (value === undefined || value === null || value === "") return "\u00A0";
    if (field.type === "url" && value) {
      return (
        <a href={String(value).match(/^(javascript|vbscript|data):/i) ? "#" : value} target="_blank" rel="noopener noreferrer" className="nf-link">
          {value}
        </a>
      );
    }
    return String(value);
  };

  // スタイル設定を適用
  const styleSettings = field.styleSettings || {};
  const labelSize = resolveLabelSize(styleSettings);
  const textColor = resolveTextColor(styleSettings);
  const labelStyleVars = {
    ...(labelSize === "smallest" ? { "--label-font-size-offset": "var(--label-size-offset-xs)" } : {}),
    ...(labelSize === "smaller" ? { "--label-font-size-offset": "var(--label-size-offset-sm)" } : {}),
    ...(labelSize === "larger" ? { "--label-font-size-offset": "var(--label-size-offset-lg)" } : {}),
    ...(labelSize === "largest" ? { "--label-font-size-offset": "var(--label-size-offset-xl)" } : {}),
    ...(textColor ? { "--label-color": textColor } : {}),
  };

  // メッセージタイプの場合はラベルのみ表示
  if (field.type === "message") {
    return (
      <div className="preview-field">
        <div className="preview-label" style={labelStyleVars}>
          {field.label || <span className="nf-text-faded">メッセージ</span>}
        </div>
      </div>
    );
  }

  if (field.type === "printTemplate") {
    return (
      <div className="preview-field">
        <label className="preview-label" style={labelStyleVars}>
          {field.label || <span className="nf-text-faded">項目</span>}
        </label>
        <button
          type="button"
          className="nf-btn-outline nf-text-13"
          onClick={() => onTemplateAction?.(field)}
        >
          {getPrintTemplateOutputLabel(field?.printTemplateAction)}
        </button>
      </div>
    );
  }


  if (field.type === "fileUpload") {
    return (
      <div className="preview-field">
        <label className="preview-label" style={labelStyleVars}>
          {field.label || <span className="nf-text-faded">項目</span>}
          {field.required && <span className="nf-text-danger nf-ml-4">*</span>}
        </label>
        <FileUploadField
          field={field}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          driveSettings={driveSettings}
          gasClient={gasClientRef?.current}
          folderState={driveFolderState}
          onFolderStateChange={onDriveFolderStateChange}
        />
      </div>
    );
  }

  if (readOnly) {
    const childrenForCheckboxes =
      field.type === "checkboxes" && renderChildrenForOption
        ? selectedChoiceLabels.map((label) => (
            <div key={`ro_child_${field.id}_${label}`} className={s.child.className}>
              {renderChildrenForOption(label)}
            </div>
          ))
        : null;

    const childrenCommon =
      field.type !== "checkboxes" && renderChildrenAll
        ? <div className={s.child.className}>{renderChildrenAll()}</div>
        : null;

    const readOnlyClassName =
      readOnlyIsTextarea ? "nf-input nf-input--readonly nf-textarea-readonly" : "nf-input nf-input--readonly";

    return (
      <div className="preview-field">
        <label className="preview-label" style={labelStyleVars}>
          {field.label || <span className="nf-text-faded">項目</span>}
          {field.required && <span className="nf-text-danger nf-ml-4">*</span>}
        </label>
        <div className={readOnlyClassName}>{renderReadOnlyValue()}</div>
        {childrenForCheckboxes}
        {childrenCommon}
      </div>
    );
  }

  return (
    <div className="preview-field">
      <label className="preview-label" style={labelStyleVars}>
        {field.label || <span className="nf-text-faded">項目</span>}
        {field.required && <span className="nf-text-danger nf-ml-4">*</span>}
      </label>

      {(field.type === "text" || field.type === "userName" || field.type === "email" || field.type === "phone") && !isTextareaField(field) && (
        <input
          type={field.type === "email" ? "email" : (field.type === "phone" ? "tel" : "text")}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className={showInlineValidation ? `${s.input.className} nf-input--error` : s.input.className}
          placeholder={field.type === "userName"
            ? "入力ユーザー名"
            : field.type === "email"
              ? resolveConfiguredPlaceholder(field, "user@example.com")
              : field.type === "phone"
                ? resolveConfiguredPlaceholder(field, getStandardPhonePlaceholder(field))
                : resolveConfiguredPlaceholder(field, "")}
          maxLength={textMaxLength}
          inputMode={field.type === "phone" ? "tel" : undefined}
        />
      )}

      {isTextareaField(field) && (
        <textarea
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className={`${showInlineValidation ? `${s.input.className} nf-input--error` : s.input.className} nf-h-96`}
          placeholder={resolveConfiguredPlaceholder(field, "")}
          maxLength={textMaxLength}
        />
      )}

      {field.type === "number" && (
        <input
          type="text"
          value={value ?? ""}
          onChange={(event) => {
            const val = event.target.value;
            if (isNumberInputDraftAllowed(val, !!field.integerOnly)) {
              onChange(val);
            }
          }}
          className={showInlineValidation ? `${s.input.className} nf-input--error` : s.input.className}
          placeholder={resolveConfiguredPlaceholder(field, "")}
          inputMode={getNumberInputMode(field)}
        />
      )}

      {field.type === "regex" && (
        <>
          <input
            type="text"
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value)}
            className={validation.ok ? s.input.className : `${s.input.className} nf-input--error`}
            placeholder={resolveConfiguredPlaceholder(field, "")}
          />
          {showInlineValidation && (
            <div className="nf-text-danger-ink nf-text-12 nf-mt-4">{validation.message}</div>
          )}
        </>
      )}

      {field.type === "date" && (
        <input
          type="date"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className={s.input.className}
        />
      )}

      {field.type === "time" && (
        <input
          type="time"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className={s.input.className}
        />
      )}

      {field.type === "url" && (
        <input
          type="url"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className={showInlineValidation ? `${s.input.className} nf-input--error` : s.input.className}
          placeholder={resolveConfiguredPlaceholder(field, "")}
        />
      )}

      {showInlineValidation && (isTextareaField(field) || field.type === "text" || field.type === "email" || field.type === "phone" || field.type === "number" || field.type === "url") && (
        <div className="nf-text-danger-ink nf-text-12 nf-mt-4">{validation.message}</div>
      )}

      {field.type === "radio" && (
        <div>
          {(field.options || []).map((opt) => {
            const optionLabel = typeof opt?.label === "string" ? opt.label : "";
            return (
              <label key={opt.id} className="nf-block nf-mb-4">
                <input type="radio" name={field.id} checked={selectedSingleChoice === optionLabel} onChange={() => onChange(optionLabel)} />
                <span className="nf-ml-6">{optionLabel || "選択肢"}</span>
              </label>
            );
          })}
        </div>
      )}

      {field.type === "select" && (
        <select value={selectedSingleChoice} onChange={(event) => onChange(event.target.value)} className={s.input.className}>
          <option value="">-- 未選択 --</option>
          {(field.options || []).map((opt) => (
            <option key={opt.id} value={typeof opt?.label === "string" ? opt.label : ""}>
              {(typeof opt?.label === "string" ? opt.label : "") || "選択肢"}
            </option>
          ))}
        </select>
      )}

      {field.type === "weekday" && (
        <select value={selectedSingleChoice} onChange={(event) => onChange(event.target.value)} className={s.input.className}>
          <option value="">-- 未選択 --</option>
          {(field.options || []).map((opt) => (
            <option key={opt.id} value={typeof opt?.label === "string" ? opt.label : ""}>
              {(typeof opt?.label === "string" ? opt.label : "") || "選択肢"}
            </option>
          ))}
        </select>
      )}

      {field.type === "checkboxes" && (
        <div>
          {(field.options || []).map((opt) => {
            const optionLabel = typeof opt?.label === "string" ? opt.label : "";
            const checked = selectedChoiceLabels.includes(optionLabel);
            return (
              <div key={opt.id} className="nf-mb-4">
                <label>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = new Set(selectedChoiceLabels);
                      event.target.checked ? next.add(optionLabel) : next.delete(optionLabel);
                      onChange(Array.from(next));
                    }}
                  />
                  <span className="nf-ml-6">{optionLabel || "選択肢"}</span>
                </label>
                {checked && renderChildrenForOption && (
                  <div className={s.child.className}>{renderChildrenForOption(optionLabel)}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {renderChildrenAll && field.type !== "checkboxes" && <div className={s.child.className}>{renderChildrenAll()}</div>}
    </div>
  );
};

const RendererRecursive = ({
  fields,
  responses,
  onChange,
  depth = 0,
  readOnly = false,
  entryId,
  onChildFormJump,
  driveSettings,
  gasClientRef,
  driveFolderState,
  onDriveFolderStateChange,
  onTemplateAction,
}) => {
  const renderChildrenAll = (field, fid) => () => {
    if (!field?.childrenByValue) return null;
    const selectedLabels = toSelectedChoiceLabels(field, (responses || {})[fid]);
    if (["radio", "select"].includes(field.type)) {
      const selected = selectedLabels[0];
      if (!selected) return null;
      return (
        <RendererRecursive
          fields={field.childrenByValue[selected] || []}
          responses={responses}
          onChange={onChange}
          depth={depth + 1}
          readOnly={readOnly}
          entryId={entryId}
          onChildFormJump={onChildFormJump}
          driveSettings={driveSettings}
          gasClientRef={gasClientRef}
          driveFolderState={driveFolderState}
          onDriveFolderStateChange={onDriveFolderStateChange}
          onTemplateAction={onTemplateAction}
        />
      );
    }
    if (field.type === "checkboxes") {
      return selectedLabels.map((label) => (
        <RendererRecursive
          key={`child_${fid}_${label}`}
          fields={field.childrenByValue[label] || []}
          responses={responses}
          onChange={onChange}
          depth={depth + 1}
          readOnly={readOnly}
          entryId={entryId}
          onChildFormJump={onChildFormJump}
          driveSettings={driveSettings}
          gasClientRef={gasClientRef}
          driveFolderState={driveFolderState}
          onDriveFolderStateChange={onDriveFolderStateChange}
          onTemplateAction={onTemplateAction}
        />
      ));
    }
    return null;
  };

  const renderChildrenForOption = (field, fid, optionLabel) => {
    if (!field?.childrenByValue) return null;
    return (
      <RendererRecursive
        fields={field.childrenByValue[optionLabel] || []}
        responses={responses}
        onChange={onChange}
        depth={depth + 1}
        readOnly={readOnly}
        entryId={entryId}
        onChildFormJump={onChildFormJump}
        driveSettings={driveSettings}
        gasClientRef={gasClientRef}
        driveFolderState={driveFolderState}
        onDriveFolderStateChange={onDriveFolderStateChange}
        onTemplateAction={onTemplateAction}
      />
    );
  };

  return (
    <div>
      {(fields || []).map((field, index) => {
        const fid = field?.id || `tmp_${depth}_${index}_${field?.label || ""}`;
        const value = (responses || {})[fid] ?? (responses || {})[field?.id];
        const cardAttrs = s.card(depth, false);
        return (
          <div key={`node_${fid}`} className={cardAttrs.className} data-depth={cardAttrs["data-depth"]} data-question-id={fid}>
            <FieldRenderer
              field={{ ...field, id: fid }}
              value={value}
              onChange={(nextValue) => onChange((prev) => ({ ...(prev || {}), [fid]: nextValue }))}
              renderChildrenAll={renderChildrenAll(field, fid)}
              renderChildrenForOption={(label) => renderChildrenForOption(field, fid, label)}
              readOnly={readOnly}
              driveSettings={driveSettings}
              gasClientRef={gasClientRef}
              driveFolderState={driveFolderState}
              onDriveFolderStateChange={onDriveFolderStateChange}
              onTemplateAction={onTemplateAction}
            />
          </div>
        );
      })}
    </div>
  );
};

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

  const sortedData = useMemo(() => {
    const raw = collectResponses(schema, responses);
    return sortResponses(raw, schema, responses);
  }, [schema, responses]);
  const output = sortedData.map;
  const sortedKeys = sortedData.keys;
  const formTitle = settings.formTitle || "受付フォーム";
  const modifiedAtDisplay = formatRecordMetaDateTime(settings.modifiedAtUnixMs ?? settings.modifiedAt);
  const fieldLabels = useMemo(() => buildFieldLabelsMap(schema), [schema]);
  const fieldValues = useMemo(() => buildFieldValuesMap(schema, responses), [schema, responses]);

  const gasClientRef = useRef(gasClientModule);
  const driveSettings = useMemo(() => ({
    rootFolderUrl: settings.driveRootFolderUrl || "",
    folderNameTemplate: settings.driveFolderNameTemplate || "",
    formId: settings.formId || "",
    recordId: recordIdRef.current,
    responses: responses || {},
    fieldLabels,
    fieldValues,
  }), [settings.driveRootFolderUrl, settings.driveFolderNameTemplate, settings.formId, responses, fieldLabels, fieldValues]);

  const [isSaving, setIsSaving] = useState(false);
  const showRecordOutputAlert = (result, fallbackOutputType) => {
    const outputType = result?.outputType || fallbackOutputType || "";
    showOutputAlert({
      message: "様式出力を準備しました。",
      url: result?.openUrl || "",
      linkLabel: outputType === "gmail" ? "Gmail下書きを開く" : "ファイルを開く",
    });
  };
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
    const effectiveFileNameTemplate = resolveEffectivePrintTemplateFileNameTemplate(action, settings);
    if (requiresPrintTemplateFileName(action) && !effectiveFileNameTemplate) {
      showAlert(
        action.outputType === "gmail"
          ? "Gmail 本文で {_PDF} または {_DOCUMENT} を使うには、フォーム設定の標準様式出力ファイル名規則を設定してください"
          : "出力ファイル名が設定されていません",
      );
      return;
    }
    if (action.outputType !== "gmail" && action.useCustomTemplate && !String(action.templateUrl || "").trim()) {
      showAlert("カスタムテンプレートURLを設定してください");
      return;
    }
    const effectiveFolderUrl = resolveEffectiveDriveFolderUrl(driveFolderState);
    const baseDriveTemplateSettings = {
      ...driveSettings,
      ...(effectiveFolderUrl ? { folderUrl: effectiveFolderUrl } : {}),
      recordId: recordIdRef.current,
      responses: responses || {},
      fieldLabels,
      fieldValues,
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
        showRecordOutputAlert(result, action.outputType);
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

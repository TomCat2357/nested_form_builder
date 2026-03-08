import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { collectResponses, sortResponses } from "../../core/collect.js";
import { computeSchemaHash } from "../../core/schema.js";
import { collectValidationErrors, formatValidationErrors, isNumberInputDraftAllowed, validateByPattern } from "../../core/validate.js";
import { submitResponses, hasScriptRun } from "../../services/gasClient.js";
import { normalizeSpreadsheetId } from "../../utils/spreadsheet.js";
import { styles as s } from "../editor/styles.js";
import { useAlert } from "../../app/hooks/useAlert.js";
import { collectDefaultNowResponses } from "../../utils/responses.js";
import { resolveLabelSize } from "../../core/styleSettings.js";
import { genRecordId } from "../../core/ids.js";
import { getStandardPhonePlaceholder } from "../../core/phone.js";

const CHOICE_TYPES = new Set(["checkboxes", "radio", "select"]);
const isChoiceMarkerValue = (value) => value === true || value === 1 || value === "1" || value === "●";

const toChoiceOptionLabels = (field) => {
  const options = Array.isArray(field?.options) ? field.options : [];
  const labels = [];
  const seen = new Set();
  options.forEach((opt) => {
    const label = typeof opt?.label === "string" ? opt.label : "";
    if (!label || seen.has(label)) return;
    labels.push(label);
    seen.add(label);
  });
  return labels;
};

const toRawSelectedLabels = (type, value) => {
  const labels = [];
  const seen = new Set();
  const add = (candidate) => {
    if (typeof candidate !== "string" || !candidate || seen.has(candidate)) return;
    labels.push(candidate);
    seen.add(candidate);
  };

  if (type === "checkboxes") {
    if (Array.isArray(value)) {
      value.forEach((item) => add(item));
      return labels;
    }
    if (typeof value === "string") {
      add(value);
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([label, marker]) => {
        if (isChoiceMarkerValue(marker)) add(label);
      });
    }
    return labels;
  }

  if (type === "radio" || type === "select") {
    if (typeof value === "string") {
      add(value);
    } else if (Array.isArray(value)) {
      value.forEach((item) => add(item));
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([label, marker]) => {
        if (isChoiceMarkerValue(marker)) add(label);
      });
    }
    return labels;
  }

  return labels;
};

const toSelectedChoiceLabels = (field, value) => {
  const type = field?.type;
  if (!CHOICE_TYPES.has(type)) return [];

  const rawSelected = toRawSelectedLabels(type, value);
  if (rawSelected.length === 0) return [];

  const selectedSet = new Set(rawSelected);
  const ordered = [];
  const seen = new Set();

  toChoiceOptionLabels(field).forEach((label) => {
    if (!selectedSet.has(label) || seen.has(label)) return;
    ordered.push(label);
    seen.add(label);
  });

  rawSelected.forEach((label) => {
    if (seen.has(label)) return;
    ordered.push(label);
    seen.add(label);
  });

  return type === "checkboxes" ? ordered : ordered.slice(0, 1);
};

const hasVisibleValue = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
};

const isTextareaField = (field) => field?.type === "textarea" || (field?.type === "text" && field?.multiline);

const resolveConfiguredPlaceholder = (field, fallback = "") => {
  if (field?.showPlaceholder !== true) return "";
  return field?.placeholder || fallback;
};

const getNumberInputMode = (field) => (field?.integerOnly ? "numeric" : "decimal");

const FieldRenderer = ({ field, value, onChange, renderChildrenAll, renderChildrenForOption, readOnly = false }) => {
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
        <a href={value} target="_blank" rel="noopener noreferrer" className="nf-link">
          {value}
        </a>
      );
    }
    return String(value);
  };

  // スタイル設定を適用
  const styleSettings = field.styleSettings || {};
  const labelSize = resolveLabelSize(styleSettings);
  const labelStyleVars = {
    ...(labelSize === "smallest" ? { "--label-font-size-offset": "var(--label-size-offset-xs)" } : {}),
    ...(labelSize === "smaller" ? { "--label-font-size-offset": "var(--label-size-offset-sm)" } : {}),
    ...(labelSize === "larger" ? { "--label-font-size-offset": "var(--label-size-offset-lg)" } : {}),
    ...(labelSize === "largest" ? { "--label-font-size-offset": "var(--label-size-offset-xl)" } : {}),
    ...(styleSettings.textColor ? { "--label-color": styleSettings.textColor } : {}),
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

const RendererRecursive = ({ fields, responses, onChange, depth = 0, readOnly = false }) => {
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
  },
  ref,
) {
  const { showAlert } = useAlert();
  const initialRecordId = settings.recordId;
  const recordIdRef = useRef(initialRecordId || genRecordId());
  const currentUserName = typeof settings.userName === "string" ? settings.userName : "";
  const currentUserEmail = typeof settings.userEmail === "string" ? settings.userEmail : "";
  const currentUserAffiliation = typeof settings.userAffiliation === "string" ? settings.userAffiliation : "";
  const currentUserPhone = typeof settings.userPhone === "string" ? settings.userPhone : "";
  const defaultNowMap = useMemo(
    () => collectDefaultNowResponses(schema, new Date(), {
      userName: currentUserName,
      userEmail: currentUserEmail,
      userAffiliation: currentUserAffiliation,
      userPhone: currentUserPhone,
    }),
    [schema, currentUserName, currentUserEmail, currentUserAffiliation, currentUserPhone],
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

  const [isSaving, setIsSaving] = useState(false);

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
    }),
    [handleSaveToSheet, output, sortedKeys],
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
        <label className="preview-label">回答ID</label>
        <input type="text" value={recordIdRef.current} readOnly className="nf-input nf-input--readonly" />
      </div>
      <RendererRecursive fields={schema} responses={responses} onChange={setResponses} readOnly={readOnly} />
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

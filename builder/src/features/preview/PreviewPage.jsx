import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { collectResponses, sortResponses } from "../../core/collect.js";
import { computeSchemaHash } from "../../core/schema.js";
import { hasValidationErrors, validateByPattern } from "../../core/validate.js";
import { submitResponses, hasScriptRun } from "../../services/gasClient.js";
import { normalizeSpreadsheetId } from "../../utils/spreadsheet.js";
import { styles as s } from "../editor/styles.js";
import AlertDialog from "../../app/components/AlertDialog.jsx";
import { useAlert } from "../../app/hooks/useAlert.js";
import { formatUnixMsDate, formatUnixMsTime } from "../../utils/dateTime.js";
import { resolveLabelSize } from "../../core/styleSettings.js";

const formatDateLocal = (date) => formatUnixMsDate(date.getTime());
const formatTimeLocal = (date) => formatUnixMsTime(date.getTime());

const generateRecordId = () => {
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    return `r_${Array.from(bytes)
      .map((b) => (`0${b.toString(16)}`).slice(-2))
      .join("")}`;
  }
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const collectDefaultNowResponses = (fields) => {
  const defaults = {};
  const walk = (arr) => {
    (arr || []).forEach((field) => {
      if (["date", "time"].includes(field.type) && field.defaultNow) {
        const now = new Date();
        defaults[field.id] = field.type === "date" ? formatDateLocal(now) : formatTimeLocal(now);
      }
      if (field.childrenByValue) {
        Object.keys(field.childrenByValue).forEach((key) => walk(field.childrenByValue[key]));
      }
    });
  };
  walk(fields);
  return defaults;
};

const FieldRenderer = ({ field, value, onChange, renderChildrenAll, renderChildrenForOption, readOnly = false }) => {
  const validation = validateByPattern(field, value);

  const renderReadOnlyValue = () => {
    if (field.type === "checkboxes" && Array.isArray(value)) return value.join(", ");
    if (Array.isArray(value)) return value.join(", ");
    if (value === undefined || value === null || value === "") return "—";
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
    ...(labelSize === "smaller" ? { "--label-font-size-offset": "var(--label-size-offset-sm)" } : {}),
    ...(labelSize === "larger" ? { "--label-font-size-offset": "var(--label-size-offset-lg)" } : {}),
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
        ? (Array.isArray(value) ? value : []).map((label) => (
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
      field.type === "textarea" ? "nf-input nf-input--readonly nf-textarea-readonly" : "nf-input nf-input--readonly";

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

      {field.type === "text" && (
        <input
          type="text"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className={s.input.className}
          placeholder={field.placeholder || "入力"}
        />
      )}

      {field.type === "textarea" && (
        <textarea
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className={`${s.input.className} nf-h-96`}
          placeholder={field.placeholder || "入力"}
        />
      )}

      {field.type === "number" && (
        <input
          type="number"
          value={value ?? ""}
          onChange={(event) => {
            const val = event.target.value;
            onChange(val === "" ? "" : Number(val));
          }}
          className={s.input.className}
          placeholder={field.placeholder || ""}
        />
      )}

      {field.type === "regex" && (
        <>
          <input
            type="text"
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value)}
            className={validation.ok ? s.input.className : `${s.input.className} nf-input--error`}
            placeholder={field.placeholder || "入力"}
          />
          {!validation.ok && (
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
          className={s.input.className}
          placeholder={field.placeholder || "https://example.com"}
        />
      )}

      {field.type === "radio" && (
        <div>
          {(field.options || []).map((opt) => (
            <label key={opt.id} className="nf-block nf-mb-4">
              <input type="radio" name={field.id} checked={value === opt.label} onChange={() => onChange(opt.label)} />
              <span className="nf-ml-6">{opt.label || "選択肢"}</span>
            </label>
          ))}
        </div>
      )}

      {field.type === "select" && (
        <select value={value ?? ""} onChange={(event) => onChange(event.target.value)} className={s.input.className}>
          <option value="">-- 未選択 --</option>
          {(field.options || []).map((opt) => (
            <option key={opt.id} value={opt.label}>
              {opt.label || "選択肢"}
            </option>
          ))}
        </select>
      )}

      {field.type === "checkboxes" && (
        <div>
          {(field.options || []).map((opt) => {
            const arr = Array.isArray(value) ? value : [];
            const checked = arr.includes(opt.label);
            return (
              <div key={opt.id} className="nf-mb-4">
                <label>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = new Set(arr);
                      event.target.checked ? next.add(opt.label) : next.delete(opt.label);
                      onChange(Array.from(next));
                    }}
                  />
                  <span className="nf-ml-6">{opt.label || "選択肢"}</span>
                </label>
                {checked && renderChildrenForOption && (
                  <div className={s.child.className}>{renderChildrenForOption(opt.label)}</div>
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
    if (["radio", "select"].includes(field.type)) {
      const selected = (responses || {})[fid];
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
      const arr = Array.isArray((responses || {})[fid]) ? (responses || {})[fid] : [];
      return arr.map((label) => (
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
          <div key={`node_${fid}`} className={cardAttrs.className} data-depth={cardAttrs["data-depth"]}>
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
    saveButtonLabel = "回答保存",
    showSaveButton = true,
    readOnly = false,
  },
  ref,
) {
  const { alertState, showAlert, closeAlert } = useAlert();
  const initialRecordId = settings.recordId || settings.currentRecordId;
  const recordIdRef = useRef(initialRecordId || generateRecordId());
  const defaultNowMap = useMemo(() => collectDefaultNowResponses(schema), [schema]);

  useEffect(() => {
    if (initialRecordId && recordIdRef.current !== initialRecordId) {
      recordIdRef.current = initialRecordId;
    }
  }, [initialRecordId]);

  useEffect(() => {
    // 既往データ編集時は日付・時間の自動初期値設定をスキップ
    if (settings.recordId || settings.currentRecordId) return;

    if (!defaultNowMap || Object.keys(defaultNowMap).length === 0) return;
    setResponses((prev) => {
      const current = prev || {};
      let changed = false;
      const next = { ...current };
      Object.keys(defaultNowMap).forEach((key) => {
        const currentValue = next[key];
        if (currentValue === undefined || currentValue === null || currentValue === "") {
          next[key] = defaultNowMap[key];
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [defaultNowMap, setResponses, settings.recordId, settings.currentRecordId]);

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
      if (hasValidationErrors(schema, responses)) {
        showAlert("正規表現のエラー、必須空、またはパターン不一致の回答があります。修正してください。");
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
          <input type="text" value={settings.recordNo || ""} readOnly className="nf-input nf-input--readonly" />
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
      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </div>
  );
});

export default PreviewPage;

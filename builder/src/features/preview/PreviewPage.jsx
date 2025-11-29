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
  const readOnlyBoxStyle = {
    ...s.input,
    backgroundColor: "#F3F4F6",
    color: "#374151",
    cursor: "text",
    userSelect: "text",
  };

  const renderReadOnlyValue = () => {
    if (field.type === "checkboxes" && Array.isArray(value)) return value.join(", ");
    if (Array.isArray(value)) return value.join(", ");
    if (value === undefined || value === null || value === "") return "—";
    return String(value);
  };

  // スタイル設定を適用
  const styleSettings = field.styleSettings || {};
  const labelStyle = {
    display: "block",
    fontWeight: 600,
    marginBottom: 6,
    fontSize: styleSettings.fontSize || undefined,
    color: styleSettings.textColor || undefined,
  };

  // メッセージタイプの場合はラベルのみ表示
  if (field.type === "message") {
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={labelStyle}>
          {field.label || <span style={{ color: "#9CA3AF" }}>メッセージ</span>}
        </div>
      </div>
    );
  }

  if (readOnly) {
    const childrenForCheckboxes =
      field.type === "checkboxes" && renderChildrenForOption
        ? (Array.isArray(value) ? value : []).map((label) => (
            <div key={`ro_child_${field.id}_${label}`} style={s.child}>
              {renderChildrenForOption(label)}
            </div>
          ))
        : null;

    const childrenCommon =
      field.type !== "checkboxes" && renderChildrenAll
        ? <div style={s.child}>{renderChildrenAll()}</div>
        : null;

    return (
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>
          {field.label || <span style={{ color: "#9CA3AF" }}>項目</span>}
          {field.required && <span style={{ color: "#EF4444", marginLeft: 4 }}>*</span>}
        </label>
        <div style={readOnlyBoxStyle}>{renderReadOnlyValue()}</div>
        {childrenForCheckboxes}
        {childrenCommon}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={labelStyle}>
        {field.label || <span style={{ color: "#9CA3AF" }}>項目</span>}
        {field.required && <span style={{ color: "#EF4444", marginLeft: 4 }}>*</span>}
      </label>

      {field.type === "text" && (
        <input
          type="text"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          style={s.input}
          placeholder={field.placeholder || "入力"}
        />
      )}

      {field.type === "textarea" && (
        <textarea
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          style={{ ...s.input, height: 96 }}
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
          style={s.input}
          placeholder={field.placeholder || ""}
        />
      )}

      {field.type === "regex" && (
        <>
          <input
            type="text"
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value)}
            style={{
              ...s.input,
              borderColor: validation.ok ? s.input.borderColor : "#EF4444",
            }}
            placeholder={field.placeholder || "入力"}
          />
          {!validation.ok && (
            <div style={{ color: "#B91C1C", fontSize: 12, marginTop: 4 }}>{validation.message}</div>
          )}
        </>
      )}

      {field.type === "date" && (
        <input
          type="date"
          value={value ?? (field.defaultNow ? formatDateLocal(new Date()) : "")}
          onChange={(event) => onChange(event.target.value)}
          style={s.input}
        />
      )}

      {field.type === "time" && (
        <input
          type="time"
          value={value ?? (field.defaultNow ? formatTimeLocal(new Date()) : "")}
          onChange={(event) => onChange(event.target.value)}
          style={s.input}
        />
      )}

      {field.type === "radio" && (
        <div>
          {(field.options || []).map((opt) => (
            <label key={opt.id} style={{ display: "block", marginBottom: 4 }}>
              <input type="radio" name={field.id} checked={value === opt.label} onChange={() => onChange(opt.label)} />
              <span style={{ marginLeft: 6 }}>{opt.label || "選択肢"}</span>
            </label>
          ))}
        </div>
      )}

      {field.type === "select" && (
        <select value={value ?? ""} onChange={(event) => onChange(event.target.value)} style={s.input}>
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
              <div key={opt.id} style={{ marginBottom: 4 }}>
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
                  <span style={{ marginLeft: 6 }}>{opt.label || "選択肢"}</span>
                </label>
                {checked && renderChildrenForOption && (
                  <div style={s.child}>{renderChildrenForOption(opt.label)}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {renderChildrenAll && field.type !== "checkboxes" && <div style={s.child}>{renderChildrenAll()}</div>}
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
        return (
          <div key={`node_${fid}`} style={s.card(depth)}>
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
    if (readOnly) {
      throw new Error("read_only_mode");
    }
    if (hasValidationErrors(schema, responses)) {
      showAlert("正規表現のエラー、必須空、またはパターン不一致の回答があります。修正してください。");
      throw new Error("validation_failed");
    }

    let spreadsheetId = null;
    if (!onSave) {
      const scriptRunAvailable = hasScriptRun();
      spreadsheetId = normalizeSpreadsheetId(settings.spreadsheetId || "");
      if (!spreadsheetId) {
        showAlert("Spreadsheet ID / URL が未入力です");
        throw new Error("missing_spreadsheet_id");
      }
      if (!scriptRunAvailable) {
        showAlert("この機能はGoogle Apps Script環境でのみ利用可能です");
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

    setIsSaving(true);
    try {
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
        sheetName: settings.sheetName || "Responses",
        payload,
      });
      const msg = res?.spreadsheetUrl
        ? `送信しました（${res.sheetName} に追記 / 行: ${res.rowNumber}）`
        : "送信しました";
      showAlert(msg);
      return res;
    } catch (error) {
      console.error("[PreviewPage] Error in handleSaveToSheet:", error);
      if (!options?.silent) {
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
    <div style={{ border: "1px solid #E5E7EB", borderRadius: 12, padding: 12, background: "#fff" }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{formTitle}</h2>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>回答ID</label>
        <input type="text" value={recordIdRef.current} readOnly style={{ ...s.input, backgroundColor: "#F8FAFC", cursor: "not-allowed" }} />
      </div>
      <RendererRecursive fields={schema} responses={responses} onChange={setResponses} readOnly={readOnly} />
      {showOutputJson && (
        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", marginBottom: 6 }}>回答JSON</label>
          <textarea
            readOnly
            value={JSON.stringify(output, null, 2)}
            style={{
              ...s.input,
              height: 200,
              fontFamily: "ui-monospace, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
              fontSize: 12,
            }}
          />
        </div>
      )}
      {showSaveButton && !readOnly && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, gap: 8, alignItems: "center" }}>
          <button type="button" style={s.btn} onClick={handleSaveToSheet} disabled={isSaving}>
            {isSaving ? "保存中..." : saveButtonLabel}
          </button>
        </div>
      )}
      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </div>
  );
});

export default PreviewPage;

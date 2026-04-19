import React from "react";
import { DEFAULT_MULTILINE_ROWS } from "../../core/schema.js";
import { isNumberInputDraftAllowed, validateByPattern } from "../../core/validate.js";
import { resolveLabelSize, resolveTextColor } from "../../core/styleSettings.js";
import { getStandardPhonePlaceholder } from "../../core/phone.js";
import { getPrintTemplateOutputLabel } from "../../utils/printTemplateAction.js";
import {
  CHOICE_TYPES,
  hasVisibleValue,
  isTextareaField,
  toSelectedChoiceLabels,
} from "./printDocument.js";
import { styles as s } from "../editor/styles.js";
import FileUploadField from "./FileUploadField.jsx";

const resolveConfiguredPlaceholder = (field, fallback = "") => {
  if (field?.showPlaceholder !== true) return "";
  return field?.placeholder || fallback;
};

const getNumberInputMode = (field) => (field?.integerOnly ? "numeric" : "decimal");

const identityFn = (v) => v || "";

const FieldRenderer = ({
  field,
  value,
  onChange,
  renderChildrenAll,
  renderChildrenForOption,
  readOnly = false,
  driveSettings,
  gasClientRef,
  driveFolderStates,
  onFieldDriveFolderStateChange,
  onTemplateAction,
  canDeleteDriveFolder,
  onDeleteDriveFolder,
  resolveTokens = identityFn,
  computedValues,
  computedErrors,
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

  const renderLabel = ({ tag: Tag = "label", fallback = "項目", showRequired = true } = {}) => (
    <Tag className="preview-label" style={labelStyleVars}>
      {field.label ? field.label : <span className="nf-text-faded">{fallback}</span>}
      {showRequired && field.required && <span className="nf-text-danger nf-ml-4">*</span>}
    </Tag>
  );

  // メッセージタイプの場合はラベルのみ表示
  if (field.type === "message") {
    return (
      <div className="preview-field">
        {renderLabel({ tag: "div", fallback: "メッセージ", showRequired: false })}
      </div>
    );
  }

  if (field.type === "calculated" || field.type === "substitution") {
    if (field.hideFromRecordView) return null;
    const computedValue = computedValues?.[field.id];
    const computedError = computedErrors?.[field.id];
    return (
      <div className="preview-field">
        {renderLabel({ tag: "div", showRequired: false })}
        {computedError
          ? <div className="nf-text-danger-ink nf-text-12">{computedError}</div>
          : <div className="nf-input nf-input--readonly">{computedValue != null && computedValue !== "" ? String(computedValue) : "\u00A0"}</div>
        }
      </div>
    );
  }

  if (field.type === "printTemplate") {
    return (
      <div className="preview-field">
        {renderLabel({ showRequired: false })}
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
    const fieldFolderState = (driveFolderStates || {})[field.id];
    const handleFieldFolderStateChange = typeof onFieldDriveFolderStateChange === "function"
      ? (updater) => onFieldDriveFolderStateChange(field.id, updater)
      : undefined;
    const handleFieldDeleteDriveFolder = typeof onDeleteDriveFolder === "function"
      ? () => onDeleteDriveFolder(field.id)
      : undefined;
    return (
      <div className="preview-field">
        {renderLabel()}
        <FileUploadField
          field={field}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          driveSettings={driveSettings}
          gasClient={gasClientRef?.current}
          folderState={fieldFolderState}
          onFolderStateChange={handleFieldFolderStateChange}
          canDeleteDriveFolder={canDeleteDriveFolder}
          onDeleteDriveFolder={handleFieldDeleteDriveFolder}
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
        {renderLabel()}
        <div className={readOnlyClassName}>{renderReadOnlyValue()}</div>
        {childrenForCheckboxes}
        {childrenCommon}
      </div>
    );
  }

  const rph = (fallback = "") => resolveConfiguredPlaceholder(field, fallback);

  return (
    <div className="preview-field">
      {renderLabel()}

      {(field.type === "text" || field.type === "userName" || field.type === "email" || field.type === "phone") && !isTextareaField(field) && (
        <input
          type={field.type === "email" ? "email" : (field.type === "phone" ? "tel" : "text")}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className={showInlineValidation ? `${s.input.className} nf-input--error` : s.input.className}
          placeholder={field.type === "userName"
            ? "入力ユーザー名"
            : field.type === "email"
              ? rph("user@example.com")
              : field.type === "phone"
                ? rph(getStandardPhonePlaceholder(field))
                : rph("")}
          maxLength={textMaxLength}
          inputMode={field.type === "phone" ? "tel" : undefined}
        />
      )}

      {isTextareaField(field) && (
        <textarea
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className={showInlineValidation ? `${s.input.className} nf-input--error` : s.input.className}
          style={{ height: `${(field.multilineRows || DEFAULT_MULTILINE_ROWS) * 24}px` }}
          placeholder={rph("")}
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
          placeholder={rph("")}
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
            placeholder={rph("")}
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
          step={field.includeSeconds ? "1" : undefined}
        />
      )}

      {field.type === "url" && (
        <input
          type="url"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className={showInlineValidation ? `${s.input.className} nf-input--error` : s.input.className}
          placeholder={rph("")}
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

      {(field.type === "select" || field.type === "weekday") && (
        <select value={selectedSingleChoice} onChange={(event) => onChange(event.target.value)} className={s.input.className}>
          <option value="">-- 未選択 --</option>
          {(field.options || []).map((opt) => {
            const rawLabel = typeof opt?.label === "string" ? opt.label : "";
            return (
              <option key={opt.id} value={rawLabel}>
                {rawLabel || "選択肢"}
              </option>
            );
          })}
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

export const RendererRecursive = ({
  fields,
  responses,
  onChange,
  depth = 0,
  readOnly = false,
  entryId,
  onChildFormJump,
  driveSettings,
  gasClientRef,
  driveFolderStates,
  onFieldDriveFolderStateChange,
  onTemplateAction,
  canDeleteDriveFolder,
  onDeleteDriveFolder,
  resolveTokens,
  computedValues,
  computedErrors,
}) => {
  const recursiveProps = {
    responses, onChange, depth: depth + 1, readOnly, entryId, onChildFormJump,
    driveSettings, gasClientRef, driveFolderStates, onFieldDriveFolderStateChange,
    onTemplateAction, canDeleteDriveFolder, onDeleteDriveFolder, resolveTokens,
    computedValues, computedErrors,
  };

  const renderChildrenAll = (field, fid) => () => {
    if (!field?.childrenByValue) return null;
    const selectedLabels = toSelectedChoiceLabels(field, (responses || {})[fid]);
    if (["radio", "select"].includes(field.type)) {
      const selected = selectedLabels[0];
      if (!selected) return null;
      return (
        <RendererRecursive
          fields={field.childrenByValue[selected] || []}
          {...recursiveProps}
        />
      );
    }
    if (field.type === "checkboxes") {
      return selectedLabels.map((label) => (
        <RendererRecursive
          key={`child_${fid}_${label}`}
          fields={field.childrenByValue[label] || []}
          {...recursiveProps}
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
        {...recursiveProps}
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
              driveFolderStates={driveFolderStates}
              onFieldDriveFolderStateChange={onFieldDriveFolderStateChange}
              onTemplateAction={onTemplateAction}
              canDeleteDriveFolder={canDeleteDriveFolder}
              onDeleteDriveFolder={onDeleteDriveFolder}
              resolveTokens={resolveTokens}
              computedValues={computedValues}
              computedErrors={computedErrors}
            />
          </div>
        );
      })}
    </div>
  );
};

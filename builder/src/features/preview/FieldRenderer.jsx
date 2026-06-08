import React from "react";
import { DEFAULT_MULTILINE_ROWS } from "../../core/schema.js";
import { shouldShowUnconditionalChildren } from "../../core/fieldValue.js";
import { formatCanonical } from "../../utils/dateTime.js";
import { getNumberMode, isNumberInputDraftAllowed, validateByPattern, NUMBER_MODE_CONFIG } from "../../core/validate.js";
import { toFiniteNumberOrNull } from "../../utils/numbers.js";
import { resolveLabelSize, resolveTextColor, resolveStyleSettingsInlineStyle } from "../../core/styleSettings.js";
import { getStandardPhonePlaceholder } from "../../core/phone.js";
import { getPrintTemplateOutputLabel } from "../../utils/printTemplateAction.js";
import { CHOICE_TYPES } from "../../utils/responses.js";
import {
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

const getNumberInputMode = (field) => (getNumberMode(field) === "unrestricted" ? "decimal" : "numeric");

// ▲▼ スピナーで数値を 1 ずつ増減する。モードの下限（floor）と最小値/最大値設定でクランプし、
// 整数モードでは整数へ丸める。空欄や非数値は 0 を起点に増減する。
const stepNumberValue = (field, value, direction) => {
  const cfg = NUMBER_MODE_CONFIG[getNumberMode(field)];
  const minSetting = toFiniteNumberOrNull(field?.minValue);
  const maxSetting = toFiniteNumberOrNull(field?.maxValue);
  const lowerBound = [cfg.floor, minSetting].reduce((acc, v) => {
    if (v === null || v === undefined) return acc;
    return acc === null ? v : Math.max(acc, v);
  }, null);
  const current = Number(String(value ?? "").trim());
  const base = Number.isFinite(current) ? current : 0;
  let next = base + direction;
  if (lowerBound !== null && next < lowerBound) next = lowerBound;
  if (maxSetting !== null && next > maxSetting) next = maxSetting;
  if (cfg.integer) next = Math.round(next);
  return String(next);
};

// `<input type="date">` は `YYYY-MM-DD`（ハイフン）しか受け付けない。
// 保存済みレコードの date 値は canonical `YYYY-MM-DD`（ハイフン）なのでそのまま渡せる。
// パース不能・空値は "" を返し、入力を空表示にする。
const toDateInputValue = (value) => formatCanonical(value, "date") || "";

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
  onWebhookAction,
  onFormLinkAction,
  formLinkChildCounts,
  hideFormLink = false,
  isAdmin = true,
  canDeleteDriveFolder,
  onDeleteDriveFolder,
  resolveTokens = identityFn,
  computedValues,
  computedErrors,
  depth = 0,
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
  // アクションボタン（様式出力 / Webhook）はボタン自体に文字サイズ・文字色・背景色を反映する。
  const actionButtonStyle = resolveStyleSettingsInlineStyle(styleSettings);
  const actionButtonStyleProp = Object.keys(actionButtonStyle).length > 0 ? actionButtonStyle : undefined;

  const renderLabel = ({ tag: Tag = "label", fallback = "項目", showRequired = true } = {}) => (
    <Tag className="preview-label" style={labelStyleVars}>
      {field.label ? field.label : <span className="nf-text-faded">{fallback}</span>}
      {showRequired && field.required && <span className="nf-text-danger nf-ml-4">*</span>}
    </Tag>
  );

  // 補足コメント（プレースホルダー非対応タイプのみ保持）。ラベル直下に表示し改行を保持する。
  // placeholder 対応タイプでは supplementaryComment が prune 済みのため null になる。
  const renderComment = () => {
    const comment = typeof field.supplementaryComment === "string" ? field.supplementaryComment : "";
    if (!comment.trim()) return null;
    return (
      <div className="nf-text-12 nf-text-subtle nf-mt-2 nf-mb-4" style={{ whiteSpace: "pre-wrap" }}>
        {comment}
      </div>
    );
  };

  // メッセージタイプはラベル（メッセージ本文）のみ。子質問は「回答」概念が無いため常に表示。
  // この early-return は if (readOnly) の手前なので、編集・閲覧の両モードを同時にカバーする。
  if (field.type === "message") {
    return (
      <div className="preview-field">
        {renderLabel({ tag: "div", fallback: "メッセージ", showRequired: false })}
        {renderComment()}
        {renderChildrenAll ? <div className={s.child.className} data-depth={depth + 1}>{renderChildrenAll()}</div> : null}
      </div>
    );
  }

  if (field.type === "substitution") {
    if (field.hideFromRecordView) return null;
    const computedValue = computedValues?.[field.id];
    const computedError = computedErrors?.[field.id];
    return (
      <div className="preview-field">
        {renderLabel({ tag: "div", showRequired: false })}
        {renderComment()}
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
        {renderComment()}
        <button
          type="button"
          className="nf-btn-outline nf-text-13"
          style={actionButtonStyleProp}
          onClick={() => onTemplateAction?.(field)}
        >
          {getPrintTemplateOutputLabel(field?.printTemplateAction)}
        </button>
      </div>
    );
  }

  if (field.type === "webhook") {
    // 管理者限定カードは管理者以外には表示すらしない。
    if (field.webhookAction?.adminOnly && !isAdmin) return null;
    return (
      <div className="preview-field">
        {renderLabel({ showRequired: false })}
        {renderComment()}
        <button
          type="button"
          className="nf-btn-outline nf-text-13"
          style={actionButtonStyleProp}
          onClick={() => onWebhookAction?.(field)}
        >
          Webhook
        </button>
      </div>
    );
  }


  if (field.type === "formLink") {
    // 子フォーム文脈（URL に pid あり）では「別フォームを開く」ボタンを出さない＝
    // 子フォームからさらに子フォームを作れないようにする。
    if (hideFormLink) return null;
    const childCount = formLinkChildCounts?.[field.id];
    return (
      <div className="preview-field">
        {renderComment()}
        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            className="nf-btn-outline nf-text-13"
            style={actionButtonStyleProp}
            disabled={!field.childFormId}
            onClick={() => onFormLinkAction?.(field)}
          >
            {field.label || "フォームを開く"}
          </button>
          {Number.isFinite(childCount) && <span className="badge ghost">{childCount}件</span>}
        </span>
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
        {renderComment()}
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
            <div key={`ro_child_${field.id}_${label}`} className={s.child.className} data-depth={depth + 1}>
              {renderChildrenForOption(label)}
            </div>
          ))
        : null;

    const childrenCommon =
      field.type !== "checkboxes" && renderChildrenAll
        ? <div className={s.child.className} data-depth={depth + 1}>{renderChildrenAll()}</div>
        : null;

    const readOnlyClassName =
      readOnlyIsTextarea ? "nf-input nf-input--readonly nf-textarea-readonly" : "nf-input nf-input--readonly";
    // 閲覧モードの複数行は設定行数を「最大」表示行数とする（内容が少なければ縮み、多ければスクロール）。
    // 係数 24 は編集モードの textarea と揃える。
    const readOnlyTextareaStyle = readOnlyIsTextarea
      ? { maxHeight: `${(field.multilineRows || DEFAULT_MULTILINE_ROWS) * 24}px` }
      : undefined;

    return (
      <div className="preview-field">
        {renderLabel()}
        {renderComment()}
        <div className={readOnlyClassName} style={readOnlyTextareaStyle}>{renderReadOnlyValue()}</div>
        {childrenForCheckboxes}
        {childrenCommon}
      </div>
    );
  }

  const rph = (fallback = "") => resolveConfiguredPlaceholder(field, fallback);

  return (
    <div className="preview-field">
      {renderLabel()}
      {renderComment()}

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
        <div className="nf-number-field">
          <input
            type="text"
            value={value ?? ""}
            onChange={(event) => {
              const val = event.target.value;
              if (isNumberInputDraftAllowed(val, getNumberMode(field))) {
                onChange(val);
              }
            }}
            className={`${showInlineValidation ? `${s.input.className} nf-input--error` : s.input.className} nf-number-input`}
            placeholder={rph("")}
            inputMode={getNumberInputMode(field)}
          />
          <span className="nf-number-spin">
            <button type="button" tabIndex={-1} aria-label="数値を増やす" onClick={() => onChange(stepNumberValue(field, value, 1))}>▲</button>
            <button type="button" tabIndex={-1} aria-label="数値を減らす" onClick={() => onChange(stepNumberValue(field, value, -1))}>▼</button>
          </span>
        </div>
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
          value={toDateInputValue(value)}
          onChange={(event) => onChange(formatCanonical(event.target.value, "date") ?? "")}
          className={s.input.className}
        />
      )}

      {field.type === "time" && (
        <input
          type="time"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className={s.input.className}
          step={
            field.timePrecision === "minute"
              ? undefined
              : (field.timePrecision === "millisecond" ? "0.001" : "1")
          }
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

      {field.type === "select" && (
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
                  <div className={s.child.className} data-depth={depth + 1}>{renderChildrenForOption(optionLabel)}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {renderChildrenAll && field.type !== "checkboxes" && <div className={s.child.className} data-depth={depth + 1}>{renderChildrenAll()}</div>}
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
  onWebhookAction,
  onFormLinkAction,
  formLinkChildCounts,
  hideFormLink = false,
  isAdmin = true,
  canDeleteDriveFolder,
  onDeleteDriveFolder,
  resolveTokens,
  computedValues,
  computedErrors,
}) => {
  const recursiveProps = {
    responses, onChange, depth: depth + 1, readOnly, entryId, onChildFormJump,
    driveSettings, gasClientRef, driveFolderStates, onFieldDriveFolderStateChange,
    onTemplateAction, onWebhookAction, onFormLinkAction, formLinkChildCounts, hideFormLink,
    isAdmin, canDeleteDriveFolder, onDeleteDriveFolder, resolveTokens,
    computedValues, computedErrors,
  };

  const renderChildrenAll = (field, fid) => () => {
    if (field?.childrenByValue) {
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
    }
    if (Array.isArray(field?.children) && field.children.length > 0) {
      const value = (responses || {})[fid];
      if (shouldShowUnconditionalChildren(field, value)) {
        return (
          <RendererRecursive
            fields={field.children}
            {...recursiveProps}
          />
        );
      }
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
              depth={depth}
              onChange={(nextValue) => onChange((prev) => ({ ...(prev || {}), [fid]: nextValue }))}
              renderChildrenAll={renderChildrenAll(field, fid)}
              renderChildrenForOption={(label) => renderChildrenForOption(field, fid, label)}
              readOnly={readOnly}
              driveSettings={driveSettings}
              gasClientRef={gasClientRef}
              driveFolderStates={driveFolderStates}
              onFieldDriveFolderStateChange={onFieldDriveFolderStateChange}
              onTemplateAction={onTemplateAction}
              onWebhookAction={onWebhookAction}
              onFormLinkAction={onFormLinkAction}
              formLinkChildCounts={formLinkChildCounts}
              hideFormLink={hideFormLink}
              isAdmin={isAdmin}
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

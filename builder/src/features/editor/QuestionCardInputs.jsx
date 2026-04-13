import React from "react";
import { deepClone, DEFAULT_TEXT_MAX_LENGTH } from "../../core/schema.js";
import { DEFAULT_STYLE_SETTINGS, normalizeStyleSettings, STYLE_TEXT_COLORS } from "../../core/styleSettings.js";
import { styles as s } from "./styles.js";

export {
  CHOICE_TYPES,
  WEEKDAY_TYPE,
  DATE_TIME_TYPES,
  BASIC_INPUT_TYPES,
  MESSAGE_TYPE,
  PRINT_TEMPLATE_TYPE,
  CALCULATED_TYPE,
  SUBSTITUTION_TYPE,
  DISPLAY_LABEL,
  EMAIL_PLACEHOLDER,
  EXCLUDE_FROM_SEARCH_AND_PRINT_LABEL,
  isChoiceType,
  isDateOrTimeType,
  isMessageType,
  isPrintTemplateType,
  isBasicInputType,
  isCalculatedType,
  isSubstitutionType,
  isComputedType,
  applyDisplayedFlag,
  normalizeTextFieldSettings,
  saveAndClearChoiceState,
  handleTypeChange,
} from "./fieldTypes.js";

export function PlaceholderInput({
  field,
  onChange,
  onFocus,
  toggleLabel = "プレースホルダー",
  inputPlaceholder = "例: 入力例を表示",
  defaultPlaceholder = "",
}) {
  const useTextarea = !!field.multiline;
  return (
    <div className="nf-mt-8">
      <label className={`nf-row nf-gap-6${field.showPlaceholder ? " nf-mb-4" : ""}`}>
        <input
          type="checkbox"
          checked={!!field.showPlaceholder}
          onChange={(event) => {
            const checked = event.target.checked;
            const nextField = { ...field, showPlaceholder: checked };
            if (checked && defaultPlaceholder && !nextField.placeholder) {
              nextField.placeholder = defaultPlaceholder;
            }
            onChange(nextField);
          }}
        />
        {toggleLabel}
      </label>
      {field.showPlaceholder && (
        <div className="nf-row nf-gap-8">
          {useTextarea ? (
            <textarea
              className={s.input.className}
              placeholder={inputPlaceholder}
              value={field.placeholder || ""}
              rows={3}
              onChange={(event) => onChange({ ...field, placeholder: event.target.value })}
              onFocus={onFocus}
            />
          ) : (
            <input
              className={s.input.className}
              placeholder={inputPlaceholder}
              value={field.placeholder || ""}
              onChange={(event) => onChange({ ...field, placeholder: event.target.value })}
              onFocus={onFocus}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function StyleSettingsInput({ field, onChange, onFocus, getTempState, setTempState }) {
  const styleSettings = normalizeStyleSettings(field.styleSettings || {});
  const isStyleSettingsEnabled = typeof field.showStyleSettings === "boolean"
    ? field.showStyleSettings
    : !!field.styleSettings;
  const savedStyleSettings = getTempState?.(field.id)?.savedStyleSettings;
  return (
    <div className="nf-mt-8">
      <label className={`nf-row nf-gap-6${isStyleSettingsEnabled ? " nf-mb-4" : ""}`}>
        <input
          type="checkbox"
          checked={isStyleSettingsEnabled}
          onChange={(event) => {
            const checked = event.target.checked;
            if (checked) {
              const restored = (field.styleSettings && typeof field.styleSettings === "object")
                ? field.styleSettings
                : (savedStyleSettings && typeof savedStyleSettings === "object" ? savedStyleSettings : {});
              const nextStyleSettings = { ...DEFAULT_STYLE_SETTINGS, ...normalizeStyleSettings(restored) };
              const nextField = { ...field, showStyleSettings: true, styleSettings: nextStyleSettings };
              setTempState?.(field.id, { savedStyleSettings: undefined });
              onChange(nextField);
              return;
            }
            const nextField = { ...field, showStyleSettings: false };
            if (field.styleSettings && typeof field.styleSettings === "object") {
              setTempState?.(field.id, { savedStyleSettings: deepClone(field.styleSettings) });
            }
            delete nextField.styleSettings;
            onChange(nextField);
          }}
        />
        スタイル設定
      </label>
      {isStyleSettingsEnabled && (
        <div className="nf-row nf-gap-8 nf-mt-4">
          <div className="nf-flex-1">
            <label className="nf-text-12 nf-mb-2 nf-text-subtle">文字サイズ</label>
            <select
              className={s.input.className}
              value={styleSettings.labelSize || "default"}
              onChange={(event) => onChange({
                ...field,
                styleSettings: { ...styleSettings, labelSize: event.target.value }
              })}
              onFocus={onFocus}
            >
              <option value="smallest">最も小さく</option>
              <option value="smaller">小さく</option>
              <option value="default">標準</option>
              <option value="larger">大きく</option>
              <option value="largest">最も大きく</option>
            </select>
          </div>
          <div className="nf-flex-1">
            <label className="nf-text-12 nf-mb-2 nf-text-subtle">文字色</label>
            <select
              className={s.input.className}
              value={styleSettings.textColor || STYLE_TEXT_COLORS.SETTINGS_DEFAULT}
              onChange={(event) => onChange({
                ...field,
                styleSettings: { ...styleSettings, textColor: event.target.value }
              })}
              onFocus={onFocus}
            >
              <option value={STYLE_TEXT_COLORS.SETTINGS_DEFAULT}>設定のデフォルト</option>
              <option value={STYLE_TEXT_COLORS.WHITE}>白</option>
              <option value={STYLE_TEXT_COLORS.BLACK}>黒</option>
              <option value={STYLE_TEXT_COLORS.RED}>赤</option>
              <option value={STYLE_TEXT_COLORS.BLUE}>青</option>
              <option value={STYLE_TEXT_COLORS.GREEN}>緑</option>
              <option value={STYLE_TEXT_COLORS.GRAY}>グレー</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

export function TextDefaultValueInput({ field, onChange, onFocus }) {
  const defaultValueMode = field.defaultValueMode || "none";
  return (
    <div className="nf-mt-8">
      <div className="nf-row nf-gap-8 nf-wrap nf-items-center">
        <label className="nf-fw-600 nf-shrink-0">初期値</label>
        <select
          className={`${s.input.className} nf-w-auto nf-min-w-150 nf-flex-0-1-auto`}
          value={defaultValueMode}
          onChange={(event) => onChange({ ...field, defaultValueMode: event.target.value })}
          onFocus={onFocus}
        >
          <option value="none">なし</option>
          <option value="userName">入力者名</option>
          <option value="userAffiliation">入力者所属</option>
          <option value="userTitle">入力者役職</option>
          <option value="custom">自由入力</option>
        </select>
      </div>
      {defaultValueMode === "custom" && (
        field.multiline ? (
          <textarea
            className={`${s.input.className} nf-mt-8`}
            placeholder="初期値を入力"
            rows={3}
            value={field.defaultValueText || ""}
            onChange={(event) => onChange({ ...field, defaultValueText: event.target.value })}
            onFocus={onFocus}
          />
        ) : (
          <input
            className={`${s.input.className} nf-mt-8`}
            placeholder="初期値を入力"
            value={field.defaultValueText || ""}
            onChange={(event) => onChange({ ...field, defaultValueText: event.target.value })}
            onFocus={onFocus}
          />
        )
      )}
    </div>
  );
}

export function TextInputRestrictionInput({ field, onChange, onFocus, regexError, getTempState, setTempState }) {
  const inputRestrictionMode = field.inputRestrictionMode || "none";
  const maxLengthDraft = getTempState?.(field.id)?.maxLengthDraft;
  const maxLengthValue = maxLengthDraft ?? (field.maxLength ?? DEFAULT_TEXT_MAX_LENGTH);

  React.useEffect(() => {
    if (inputRestrictionMode !== "maxLength" && maxLengthDraft !== undefined) {
      setTempState?.(field.id, { maxLengthDraft: undefined });
    }
  }, [field.id, inputRestrictionMode, maxLengthDraft, setTempState]);

  React.useEffect(() => {
    if (maxLengthDraft === undefined) return;
    if (inputRestrictionMode !== "maxLength") return;
    if (maxLengthDraft === "") return;
    if (String(field.maxLength ?? "") === maxLengthDraft) {
      setTempState?.(field.id, { maxLengthDraft: undefined });
    }
  }, [field.id, field.maxLength, inputRestrictionMode, maxLengthDraft, setTempState]);

  return (
    <div className="nf-mt-8">
      <div className="nf-row nf-gap-8 nf-wrap nf-items-center">
        <label className="nf-fw-600 nf-shrink-0">入力制限</label>
        <select
          className={`${s.input.className} nf-w-auto nf-min-w-150 nf-flex-0-1-auto`}
          value={inputRestrictionMode}
          onChange={(event) => {
            const nextMode = event.target.value;
            if (nextMode === "maxLength") {
              setTempState?.(field.id, { maxLengthDraft: undefined });
              onChange({
                ...field,
                inputRestrictionMode: "maxLength",
                maxLength: field.maxLength || DEFAULT_TEXT_MAX_LENGTH,
              });
              return;
            }
            if (nextMode === "pattern") {
              setTempState?.(field.id, { maxLengthDraft: undefined });
              onChange({ ...field, inputRestrictionMode: "pattern", pattern: field.pattern || "" });
              return;
            }
            setTempState?.(field.id, { maxLengthDraft: undefined });
            onChange({ ...field, inputRestrictionMode: "none" });
          }}
          onFocus={onFocus}
        >
          <option value="none">なし</option>
          <option value="maxLength">最大文字数</option>
          <option value="pattern">パターン指定（正規表現）</option>
        </select>
      </div>
      {inputRestrictionMode === "maxLength" && (
        <input
          type="number"
          min="1"
          className={`${s.input.className} nf-mt-8`}
          value={maxLengthValue}
          onChange={(event) => {
            const rawValue = event.target.value;
            setTempState?.(field.id, { maxLengthDraft: rawValue });
            if (rawValue === "") return;
            onChange({
              ...field,
              inputRestrictionMode: "maxLength",
              maxLength: Number(rawValue),
            });
          }}
          onBlur={() => {
            if (getTempState?.(field.id)?.maxLengthDraft === "") {
              setTempState?.(field.id, { maxLengthDraft: undefined });
            }
          }}
          onFocus={onFocus}
        />
      )}
      {inputRestrictionMode === "pattern" && (
        <>
          <input
            className={`${s.input.className} nf-mt-8`}
            placeholder="例: ^[0-9]+$"
            value={field.pattern || ""}
            onChange={(event) => onChange({ ...field, pattern: event.target.value })}
            onFocus={onFocus}
          />
          {regexError && (
            <div className="nf-text-danger-ink nf-text-12 nf-mt-4">正規表現が不正です: {regexError}</div>
          )}
        </>
      )}
    </div>
  );
}

const parseNumberSettingValue = (value) => {
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function NumberSettingsInput({ field, onChange, onFocus }) {
  const step = field.integerOnly ? "1" : "any";

  const updateBound = (key, rawValue) => {
    const nextField = { ...field };
    const nextValue = parseNumberSettingValue(rawValue);
    if (nextValue === undefined) delete nextField[key];
    else nextField[key] = nextValue;
    onChange(nextField);
  };

  return (
    <div className="nf-mt-8">
      <label className="nf-row nf-gap-6">
        <input
          type="checkbox"
          checked={!!field.integerOnly}
          onChange={(event) => onChange({ ...field, integerOnly: event.target.checked })}
        />
        整数のみ
      </label>
      <div className="nf-row nf-gap-8 nf-mt-8" style={{ flexWrap: "nowrap" }}>
        <div className="nf-flex-1 nf-min-w-0">
          <label className="nf-text-12 nf-mb-2 nf-text-subtle">最小値</label>
          <input
            type="number"
            step={step}
            className={s.input.className}
            value={field.minValue ?? ""}
            onChange={(event) => updateBound("minValue", event.target.value)}
            onFocus={onFocus}
          />
        </div>
        <div className="nf-flex-1 nf-min-w-0">
          <label className="nf-text-12 nf-mb-2 nf-text-subtle">最大値</label>
          <input
            type="number"
            step={step}
            className={s.input.className}
            value={field.maxValue ?? ""}
            onChange={(event) => updateBound("maxValue", event.target.value)}
            onFocus={onFocus}
          />
        </div>
      </div>
    </div>
  );
}

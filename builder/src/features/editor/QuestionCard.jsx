import React from "react";
import { buildSafeRegex } from "../../core/validate.js";
import { deepClone, normalizeSchemaIDs, MAX_DEPTH, cleanUnusedFieldProperties, DEFAULT_TEXT_MAX_LENGTH, DEFAULT_MULTILINE_ROWS } from "../../core/schema.js";
import { genId } from "../../core/ids.js";
import { resolveIsDisplayed } from "../../core/displayModes.js";
import { DEFAULT_STYLE_SETTINGS, normalizeStyleSettings, STYLE_TEXT_COLORS } from "../../core/styleSettings.js";
import { buildPhonePattern, getStandardPhonePlaceholder, normalizePhoneSettings } from "../../core/phone.js";
import {
  getPrintTemplateOutputLabel,
  normalizePrintTemplateAction,
  PRINT_TEMPLATE_OUTPUT_OPTIONS,
  PRINT_TEMPLATE_OUTPUT_TYPES,
} from "../../utils/printTemplateAction.js";
import { styles as s } from "./styles.js";
import OptionRow from "./OptionRow.jsx";
const CHOICE_TYPES = ["radio", "select", "checkboxes"];
const WEEKDAY_TYPE = "weekday";
const DATE_TIME_TYPES = ["date", "time"];
const BASIC_INPUT_TYPES = ["number", "url"];
const MESSAGE_TYPE = "message";
const PRINT_TEMPLATE_TYPE = "printTemplate";
const DISPLAY_LABEL = "表示";
const EMAIL_PLACEHOLDER = "user@example.com";
const EXCLUDE_FROM_SEARCH_AND_PRINT_LABEL = "一覧・印刷から除外";
const isChoiceType = (type) => CHOICE_TYPES.includes(type);
const isDateOrTimeType = (type) => DATE_TIME_TYPES.includes(type);
const isMessageType = (type) => type === MESSAGE_TYPE;
const isPrintTemplateType = (type) => type === PRINT_TEMPLATE_TYPE;
const isBasicInputType = (type) => BASIC_INPUT_TYPES.includes(type);
const applyDisplayedFlag = (target, displayed) => {
  target.isDisplayed = displayed === true;
};

const normalizeTextFieldSettings = (field) => {
  field.multiline = !!field.multiline;
  if (field.multiline) {
    const parsed = Number(field.multilineRows);
    field.multilineRows = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_MULTILINE_ROWS;
  } else {
    delete field.multilineRows;
  }
  field.defaultValueMode = ["none", "userName", "userAffiliation", "userTitle", "custom"].includes(field.defaultValueMode)
    ? field.defaultValueMode
    : "none";
  field.defaultValueText = typeof field.defaultValueText === "string" ? field.defaultValueText : "";

  if (field.inputRestrictionMode === "maxLength") {
    const parsedMaxLength = Number(field.maxLength);
    field.inputRestrictionMode = "maxLength";
    field.maxLength = Number.isFinite(parsedMaxLength) && parsedMaxLength > 0
      ? Math.floor(parsedMaxLength)
      : DEFAULT_TEXT_MAX_LENGTH;
  } else if (field.inputRestrictionMode === "pattern") {
    field.inputRestrictionMode = "pattern";
    field.pattern = typeof field.pattern === "string" ? field.pattern : "";
  } else {
    field.inputRestrictionMode = "none";
  }

  if (field.inputRestrictionMode !== "pattern") delete field.pattern;
  if (field.inputRestrictionMode !== "maxLength") delete field.maxLength;
  return field;
};

function saveAndClearChoiceState(next, field, oldIsChoice, setTempState) {
  if (oldIsChoice) {
    setTempState?.(field.id, {
      choiceState: {
        options: deepClone(field.options || []),
        childrenByValue: field.childrenByValue ? deepClone(field.childrenByValue) : undefined,
      },
    });
  }
  delete next.options;
  delete next.childrenByValue;
}

function handleTypeChange(field, newType, { getTempState, setTempState } = {}) {
  const next = deepClone(field);
  const oldType = field.type;
  next.type = newType;
  const wasDisplayed = resolveIsDisplayed(next);

  const oldIsChoice = isChoiceType(oldType);
  const newIsChoice = isChoiceType(newType);

  if (newIsChoice) {
    if (oldIsChoice) {
      next.options = next.options?.length ? next.options : [{ id: genId(), label: "", defaultSelected: false }];
    } else {
      const saved = getTempState?.(field.id)?.choiceState;
      next.options = saved?.options?.length ? deepClone(saved.options) : [{ id: genId(), label: "", defaultSelected: false }];
      if (saved?.childrenByValue) next.childrenByValue = deepClone(saved.childrenByValue);
    }
  } else {
    if (newType === "text") normalizeTextFieldSettings(next);
    if (newType === "email") next.autoFillUserEmail = !!next.autoFillUserEmail;
    if (newType === "phone") Object.assign(next, normalizePhoneSettings(next));
    if (isDateOrTimeType(newType)) next.defaultNow = !!next.defaultNow;
    if (newType === WEEKDAY_TYPE) next.defaultToday = !!next.defaultToday;
    if (newType === "fileUpload") {
      next.allowUploadByUrl = next.allowUploadByUrl ?? false;
      next.allowFolderUrlEdit = next.allowFolderUrlEdit ?? false;
    }
    if (newType === PRINT_TEMPLATE_TYPE) {
      next.printTemplateAction = {
        ...normalizePrintTemplateAction(next.printTemplateAction),
        enabled: true,
      };
    }
    saveAndClearChoiceState(next, field, oldIsChoice, setTempState);
  }

  cleanUnusedFieldProperties(next);
  applyDisplayedFlag(next, wasDisplayed);
  return next;
}

function PlaceholderInput({
  field,
  onChange,
  onFocus,
  toggleLabel = "プレースホルダー",
  inputPlaceholder = "例: 入力例を表示",
  defaultPlaceholder = "",
}) {
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
          <input
            className={s.input.className}
            placeholder={inputPlaceholder}
            value={field.placeholder || ""}
            onChange={(event) => onChange({ ...field, placeholder: event.target.value })}
            onFocus={onFocus}
          />
        </div>
      )}
    </div>
  );
}

function StyleSettingsInput({ field, onChange, onFocus, getTempState, setTempState }) {
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

function TextDefaultValueInput({ field, onChange, onFocus }) {
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
        <input
          className={`${s.input.className} nf-mt-8`}
          placeholder="初期値を入力"
          value={field.defaultValueText || ""}
          onChange={(event) => onChange({ ...field, defaultValueText: event.target.value })}
          onFocus={onFocus}
        />
      )}
    </div>
  );
}

function TextInputRestrictionInput({ field, onChange, onFocus, regexError, getTempState, setTempState }) {
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

function NumberSettingsInput({ field, onChange, onFocus }) {
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

export default function QuestionCard({
  field,
  onChange,
  onAddBelow,
  onDelete,
  onFocus,
  isSelected,
  QuestionListComponent,
  depth = 1,
  onQuestionControlChange,
  getTempState,
  setTempState,
  clearTempState,
}) {
  const isChoice = isChoiceType(field.type);
  const isWeekday = field.type === WEEKDAY_TYPE;
  const isText = field.type === "text";
  const isNumber = field.type === "number";
  const isDateOrTime = isDateOrTimeType(field.type);
  const isBasicInput = isBasicInputType(field.type);
  const isMessage = isMessageType(field.type);
  const isPrintTemplate = isPrintTemplateType(field.type);
  const isEmail = field.type === "email";
  const isPhone = field.type === "phone";
  const canAddChild = depth < MAX_DEPTH;
  const regexCheck = (isText && field.inputRestrictionMode === "pattern")
    ? buildSafeRegex(field.pattern || "")
    : { error: null };
  const phonePlaceholder = isPhone ? getStandardPhonePlaceholder(field) : "";
  const phonePattern = isPhone ? buildPhonePattern(field) : "";
  const prevPhonePlaceholderRef = React.useRef(phonePlaceholder);
  const [selectedOptionIndex, setSelectedOptionIndex] = React.useState(null);
  const latestFieldRef = React.useRef(field);
  const latestOnChangeRef = React.useRef(onChange);
  latestFieldRef.current = field;
  latestOnChangeRef.current = onChange;
  const isDisplayed = resolveIsDisplayed(field);
  const printTemplateAction = normalizePrintTemplateAction(field.printTemplateAction);

  const handleDisplayToggle = (checked) => {
    const nextField = { ...field };
    applyDisplayedFlag(nextField, checked);
    onChange(nextField);
  };

  React.useEffect(() => {
    if ((isText || isBasicInput || isEmail || isPhone) && field.placeholder && !field.showPlaceholder) {
      onChange({ ...field, showPlaceholder: true });
    }
  }, []);

  React.useEffect(() => {
    if (isEmail && field.showPlaceholder && !field.placeholder) {
      onChange({ ...field, placeholder: EMAIL_PLACEHOLDER });
    }
  }, [isEmail, field.showPlaceholder, field.placeholder]);

  React.useEffect(() => {
    if (!isPhone) {
      prevPhonePlaceholderRef.current = "";
      return;
    }

    const previousStandard = prevPhonePlaceholderRef.current;
    const currentPlaceholder = typeof field.placeholder === "string" ? field.placeholder : "";
    if (field.showPlaceholder && currentPlaceholder === previousStandard && currentPlaceholder !== phonePlaceholder) {
      prevPhonePlaceholderRef.current = phonePlaceholder;
      onChange({ ...field, placeholder: phonePlaceholder });
      return;
    }
    prevPhonePlaceholderRef.current = phonePlaceholder;
  }, [isPhone, field.showPlaceholder, field.placeholder, phonePlaceholder]);

  const moveOptionUp = (index) => {
    const currentField = latestFieldRef.current;
    if (!Array.isArray(currentField?.options)) return;
    if (index <= 0 || index >= currentField.options.length) return;
    const next = deepClone(currentField);
    [next.options[index - 1], next.options[index]] = [next.options[index], next.options[index - 1]];
    latestOnChangeRef.current(next);
    setSelectedOptionIndex(index - 1);
  };

  const moveOptionDown = (index) => {
    const currentField = latestFieldRef.current;
    if (!Array.isArray(currentField?.options)) return;
    if (index < 0 || index >= currentField.options.length - 1) return;
    const next = deepClone(currentField);
    [next.options[index], next.options[index + 1]] = [next.options[index + 1], next.options[index]];
    latestOnChangeRef.current(next);
    setSelectedOptionIndex(index + 1);
  };

  const buildOptionControlInfo = React.useCallback((index) => {
    const currentField = latestFieldRef.current;
    const options = Array.isArray(currentField?.options) ? currentField.options : [];
    if (index === null || index < 0 || index >= options.length) return null;
    return {
      type: "option",
      optionIndex: index,
      optionLabel: options[index]?.label || `選択肢 ${index + 1}`,
      canMoveUp: index > 0,
      canMoveDown: index < options.length - 1,
      moveUp: () => moveOptionUp(index),
      moveDown: () => moveOptionDown(index),
    };
  }, []);

  React.useEffect(() => {
    if (isChoice && selectedOptionIndex !== null) {
      const controlInfo = buildOptionControlInfo(selectedOptionIndex);
      if (controlInfo) onFocus(controlInfo);
    }
  }, [selectedOptionIndex, isChoice, field.options?.length, buildOptionControlInfo]);

  const updateChoiceDefaultSelection = (optionIndex, checked) => {
    const next = deepClone(field);
    next.options = (next.options || []).map((opt, index) => {
      if (field.type === "checkboxes") {
        return { ...opt, defaultSelected: index === optionIndex ? checked : !!opt.defaultSelected };
      }
      return { ...opt, defaultSelected: checked && index === optionIndex };
    });
    onChange(next);
  };

  const renderStyleSettingsInput = () => (
    <StyleSettingsInput
      field={field}
      onChange={onChange}
      onFocus={onFocus}
      getTempState={getTempState}
      setTempState={setTempState}
    />
  );

  const cardAttrs = s.card(0, isSelected);

  return (
    <div className={cardAttrs.className} data-depth={cardAttrs["data-depth"]} data-selected={cardAttrs["data-selected"]} data-question-id={field.id}>
      <div className="nf-row nf-gap-8 nf-mb-8 nf-wrap">
        <span className="nf-text-13 nf-fw-500 nf-text-ink nf-shrink-0">項目名</span>
        <input
          className={`${s.input.className} nf-w-auto nf-flex-1-1-200 nf-min-w-0`}
          placeholder="項目名を入力"
          value={field.label || ""}
          required
          onChange={(event) => onChange({ ...field, label: event.target.value })}
          onFocus={() => {
            setSelectedOptionIndex(null);
            onFocus();
          }}
        />
        <select
          value={field.type}
          className={`${s.input.className} nf-w-auto nf-min-w-150 nf-flex-0-1-auto`}
          onChange={(event) => {
            const next = handleTypeChange(field, event.target.value, { getTempState, setTempState });
            onChange(next);
          }}
          onFocus={onFocus}
        >
          <option value="text">テキスト</option>
          <option value="phone">電話番号</option>
          <option value="email">メールアドレス</option>
          <option value="url">URL</option>
          <option value="number">数値</option>
          <option value="date">日付</option>
          <option value="time">時間</option>
          <option value="weekday">曜日</option>
          <option value="checkboxes">チェックボックス</option>
          <option value="radio">ラジオボタン</option>
          <option value="select">ドロップダウン</option>
          <option value="fileUpload">ファイルアップロード</option>
          <option value="printTemplate">様式出力</option>
          <option value="message">メッセージ</option>
        </select>
        {!isMessage && !isPrintTemplate && (
          <label className="nf-row nf-gap-4 nf-nowrap">
            <input
              type="checkbox"
              checked={!!field.required}
              onChange={(event) => onChange({ ...field, required: event.target.checked })}
            />
            必須
          </label>
        )}
        <label className="nf-row nf-gap-6">
          <input
            type="checkbox"
            checked={isDisplayed}
            onChange={(event) => handleDisplayToggle(event.target.checked)}
          />
          {DISPLAY_LABEL}
        </label>
      </div>

      {isPrintTemplate && (
        <div className="nf-mt-8">
          <div className="nf-col nf-gap-8">
            <div className="nf-text-12 nf-text-subtle">未入力時の表示名は {getPrintTemplateOutputLabel(printTemplateAction)} です。</div>
            <select
              className={s.input.className}
              value={printTemplateAction.outputType}
              onChange={(event) => onChange({
                ...field,
                printTemplateAction: {
                  ...printTemplateAction,
                  outputType: event.target.value,
                  enabled: true,
                },
              })}
            >
              {PRINT_TEMPLATE_OUTPUT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {printTemplateAction.outputType !== PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL && (
              <label className="nf-row nf-gap-6">
                <input
                  type="checkbox"
                  checked={!!printTemplateAction.useCustomTemplate}
                  onChange={(event) => onChange({
                    ...field,
                    printTemplateAction: {
                      ...printTemplateAction,
                      useCustomTemplate: event.target.checked,
                      enabled: true,
                    },
                  })}
                />
                カスタムテンプレートを使う
              </label>
            )}
            {printTemplateAction.outputType !== PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL && printTemplateAction.useCustomTemplate && (
              <input
                className={s.input.className}
                placeholder="テンプレートURL（Google Document URL）"
                value={printTemplateAction.templateUrl || ""}
                onChange={(event) => onChange({
                  ...field,
                  printTemplateAction: { ...printTemplateAction, templateUrl: event.target.value, enabled: true },
                })}
              />
            )}
            {printTemplateAction.outputType !== PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL && (
              <>
                <input
                  className={s.input.className}
                  placeholder="出力ファイル名（例: {ID}_{YYYY}-{MM}-{DD}）"
                  value={printTemplateAction.fileNameTemplate || ""}
                  onChange={(event) => onChange({
                    ...field,
                    printTemplateAction: { ...printTemplateAction, fileNameTemplate: event.target.value, enabled: true },
                  })}
                />
                <div className="nf-text-11 nf-text-muted">未指定時はフォーム設定の標準様式出力ファイル名規則を使用します。</div>
              </>
            )}
            {printTemplateAction.outputType === PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL && (
              <div className="nf-text-11 nf-text-muted">Gmail 本文で {"{_PDF}"}（メールに添付）または {"{_DOCUMENT}"} を使う場合の出力名は、フォーム設定の標準様式出力ファイル名規則か既定値を使用します。</div>
            )}
            {printTemplateAction.outputType === PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL && (
              <>
                <label className="nf-col nf-gap-4">
                  <span className="nf-text-11 nf-text-muted">To</span>
                  <input
                    className={s.input.className}
                    placeholder="例: {メールアドレス}"
                    value={printTemplateAction.gmailTemplateTo || ""}
                    onChange={(event) => onChange({
                      ...field,
                      printTemplateAction: { ...printTemplateAction, gmailTemplateTo: event.target.value, enabled: true },
                    })}
                  />
                </label>
                <label className="nf-col nf-gap-4">
                  <span className="nf-text-11 nf-text-muted">Cc</span>
                  <input
                    className={s.input.className}
                    placeholder="例: {メールアドレス}"
                    value={printTemplateAction.gmailTemplateCc || ""}
                    onChange={(event) => onChange({
                      ...field,
                      printTemplateAction: { ...printTemplateAction, gmailTemplateCc: event.target.value, enabled: true },
                    })}
                  />
                </label>
                <label className="nf-col nf-gap-4">
                  <span className="nf-text-11 nf-text-muted">Bcc</span>
                  <input
                    className={s.input.className}
                    placeholder="例: {メールアドレス}"
                    value={printTemplateAction.gmailTemplateBcc || ""}
                    onChange={(event) => onChange({
                      ...field,
                      printTemplateAction: { ...printTemplateAction, gmailTemplateBcc: event.target.value, enabled: true },
                    })}
                  />
                </label>
                <label className="nf-col nf-gap-4">
                  <span className="nf-text-11 nf-text-muted">件名</span>
                  <input
                    className={s.input.className}
                    placeholder="例: 【申請】{ID}_{YYYY}-{MM}-{DD}"
                    value={printTemplateAction.gmailTemplateSubject || ""}
                    onChange={(event) => onChange({
                      ...field,
                      printTemplateAction: { ...printTemplateAction, gmailTemplateSubject: event.target.value, enabled: true },
                    })}
                  />
                </label>
                <label className="nf-col nf-gap-4">
                  <span className="nf-text-11 nf-text-muted">本文</span>
                  <textarea
                    className={`${s.input.className} nf-h-96`}
                    placeholder="本文テンプレートを入力"
                    value={printTemplateAction.gmailTemplateBody || ""}
                    onChange={(event) => onChange({
                      ...field,
                      printTemplateAction: { ...printTemplateAction, gmailTemplateBody: event.target.value, enabled: true },
                    })}
                  />
                </label>
              </>
            )}
            <div className="nf-text-11 nf-text-muted">{"出力ファイル名では {ID} / {YYYY} / {MM} / {DD} / {H} / {m} / {s} / {gg} / {フィールド名} を使えます。予約語と同名の項目は {\\フィールド名} で参照します。Gmail 本文では {_PDF}（PDF添付） / {_DOCUMENT} / {_folder_url} / {_record_url} / {_form_url} も使えます。"}</div>
          </div>
        </div>
      )}

      {!isText && renderStyleSettingsInput()}

      {isMessage && (
        <div className="nf-mt-8">
          <label className="nf-row nf-gap-6">
            <input
              type="checkbox"
              checked={!!field.excludeFromSearchAndPrint}
              onChange={(event) => onChange({ ...field, excludeFromSearchAndPrint: event.target.checked })}
            />
            {EXCLUDE_FROM_SEARCH_AND_PRINT_LABEL}
          </label>
          <div className="nf-text-12 nf-text-subtle nf-mt-4">
            情報周知用のメッセージを検索結果一覧と印刷様式に出しません。
          </div>
        </div>
      )}


      {isText && (
        <>
          <div className="nf-mt-8">
            <label className="nf-row nf-gap-6">
              <input
                type="checkbox"
                checked={!!field.multiline}
                onChange={(event) => onChange({ ...field, multiline: event.target.checked })}
              />
              複数行入力を許可
            </label>
          </div>
          {!!field.multiline && (
            <div className="nf-mt-6 nf-row nf-gap-6 nf-items-center">
              <label className="nf-text-12">テキストボックスの高さ（行数）</label>
              <input
                type="number"
                min="1"
                max="50"
                className={`${s.input.className}`}
                style={{ width: 72 }}
                value={field.multilineRows ?? DEFAULT_MULTILINE_ROWS}
                onChange={(event) => {
                  const v = Number(event.target.value);
                  onChange({ ...field, multilineRows: Number.isFinite(v) && v >= 1 ? Math.floor(v) : DEFAULT_MULTILINE_ROWS });
                }}
                onFocus={onFocus}
              />
            </div>
          )}
          {renderStyleSettingsInput()}
          <PlaceholderInput field={field} onChange={onChange} onFocus={onFocus} />
          <TextDefaultValueInput field={field} onChange={onChange} onFocus={onFocus} />
          <TextInputRestrictionInput
            field={field}
            onChange={onChange}
            onFocus={onFocus}
            regexError={regexCheck.error}
            getTempState={getTempState}
            setTempState={setTempState}
          />
        </>
      )}

      {isBasicInput && <PlaceholderInput field={field} onChange={onChange} onFocus={onFocus} />}

      {isNumber && (
        <NumberSettingsInput field={field} onChange={onChange} onFocus={onFocus} />
      )}

      {isEmail && (
        <>
          <PlaceholderInput
            field={field}
            onChange={onChange}
            onFocus={onFocus}
            toggleLabel="プレースホルダーを設定する"
            inputPlaceholder={EMAIL_PLACEHOLDER}
            defaultPlaceholder={EMAIL_PLACEHOLDER}
          />
          <div className="nf-mt-8">
            <label className="nf-row nf-gap-6">
              <input
                type="checkbox"
                checked={!!field.autoFillUserEmail}
                onChange={(event) => onChange({ ...field, autoFillUserEmail: event.target.checked })}
              />
              入力者のメールアドレスを自動入力する
            </label>
          </div>
        </>
      )}

      {isPhone && (
        <>
          <PlaceholderInput
            field={field}
            onChange={onChange}
            onFocus={onFocus}
            toggleLabel="プレースホルダーを設定する"
            inputPlaceholder={phonePlaceholder}
            defaultPlaceholder={phonePlaceholder}
          />
          <div className="nf-mt-8">
            <label className="nf-row nf-gap-6">
              <input
                type="checkbox"
                checked={!!field.autoFillUserPhone}
                onChange={(event) => onChange({ ...field, autoFillUserPhone: event.target.checked })}
              />
              入力者の電話番号を自動入力する
            </label>
          </div>
          <div className="nf-mt-8">
            <label className="nf-fw-600 nf-mb-4">形式</label>
            <div className="nf-row nf-gap-12 nf-wrap nf-mt-4">
              <label className="nf-row nf-gap-4 nf-nowrap">
                <input
                  type="radio"
                  name={`phone-format-${field.id}`}
                  checked={(field.phoneFormat || "hyphen") === "hyphen"}
                  onChange={() => onChange({ ...field, phoneFormat: "hyphen" })}
                />
                <span>ハイフンあり</span>
              </label>
              <label className="nf-row nf-gap-4 nf-nowrap">
                <input
                  type="radio"
                  name={`phone-format-${field.id}`}
                  checked={field.phoneFormat === "plain"}
                  onChange={() => onChange({ ...field, phoneFormat: "plain" })}
                />
                <span>ハイフンなし</span>
              </label>
            </div>
          </div>
          <div className="nf-mt-8">
            <div className="nf-row nf-gap-12 nf-wrap">
              <label className="nf-row nf-gap-4">
                <input
                  type="checkbox"
                  checked={!!field.allowFixedLineOmitAreaCode}
                  onChange={(event) => onChange({ ...field, allowFixedLineOmitAreaCode: event.target.checked })}
                />
                <span>固定電話の市外局番省略を認める</span>
              </label>
              <label className="nf-row nf-gap-4">
                <input
                  type="checkbox"
                  checked={field.allowMobile !== false}
                  onChange={(event) => onChange({ ...field, allowMobile: event.target.checked })}
                />
                <span>携帯電話（090 / 080 / 070）を許容</span>
              </label>
              <label className="nf-row nf-gap-4">
                <input
                  type="checkbox"
                  checked={field.allowIpPhone !== false}
                  onChange={(event) => onChange({ ...field, allowIpPhone: event.target.checked })}
                />
                <span>IP電話（050）を許容</span>
              </label>
              <label className="nf-row nf-gap-4">
                <input
                  type="checkbox"
                  checked={field.allowTollFree !== false}
                  onChange={(event) => onChange({ ...field, allowTollFree: event.target.checked })}
                />
                <span>フリーダイヤル（0120）を許容</span>
              </label>
            </div>
          </div>
          <div className="nf-mt-8 nf-text-12 nf-text-subtle">
            <div>許容パターン（正規表現）</div>
            <code className="nf-text-11 nf-text-muted nf-word-break">{phonePattern}</code>
          </div>
        </>
      )}

      {field.type === "fileUpload" && (
        <div className="nf-mt-8">
          <label className="nf-row nf-gap-6">
            <input
              type="checkbox"
              checked={!!field.allowUploadByUrl}
              onChange={(event) => onChange({ ...field, allowUploadByUrl: event.target.checked })}
            />
            URLによるアップロードを有効にする
          </label>
          <label className="nf-row nf-gap-6 nf-mt-8">
            <input
              type="checkbox"
              checked={!!field.allowFolderUrlEdit}
              onChange={(event) => onChange({ ...field, allowFolderUrlEdit: event.target.checked })}
            />
            保存先フォルダURLを変更可能にする
          </label>
          <label className="nf-row nf-gap-6 nf-mt-8">
            <input
              type="checkbox"
              checked={!!field.hideFileExtension}
              onChange={(event) => onChange({ ...field, hideFileExtension: event.target.checked })}
            />
            ファイル名の拡張子を非表示にする
          </label>
          <div className="nf-mt-12">
            <div className="nf-text-12 nf-fw-600 nf-mb-4">ルートフォルダURL</div>
            <input
              className="nf-input"
              type="text"
              value={field.driveRootFolderUrl ?? ""}
              placeholder="https://drive.google.com/drive/folders/..."
              onChange={(event) => onChange({ ...field, driveRootFolderUrl: event.target.value })}
            />
            <div className="nf-text-11 nf-text-muted nf-mt-4">
              空白の場合はマイドライブのルートがファイルの保存先になります
            </div>
          </div>
          <div className="nf-mt-8">
            <div className="nf-text-12 nf-fw-600 nf-mb-4">フォルダ命名規則</div>
            <input
              className="nf-input"
              type="text"
              value={field.driveFolderNameTemplate ?? ""}
              placeholder="{ID}_{YYYY}-{MM}-{DD}_{担当者名}"
              onChange={(event) => onChange({ ...field, driveFolderNameTemplate: event.target.value })}
            />
            <div className="nf-text-11 nf-text-muted nf-mt-4">
              {"空白の場合は子フォルダを作らず、ルートフォルダ直下に保存します。{ID}, {YYYY}, {MM}, {DD}, {H}, {m}, {s}, {gg}, {フィールド名} を使えます。予約語と同名の項目は {\\フィールド名} で参照できます"}
            </div>
          </div>
        </div>
      )}

      {isDateOrTime && (
        <div className="nf-mt-8">
          <label className="nf-row nf-gap-6">
            <input
              type="checkbox"
              checked={!!field.defaultNow}
              onChange={(event) => onChange({ ...field, defaultNow: event.target.checked })}
            />
            初期値を現在{field.type === "date" ? "の日付" : "の時刻"}にする
          </label>
        </div>
      )}

      {isWeekday && (
        <div className="nf-mt-8">
          <div className="nf-text-12 nf-text-subtle nf-mb-4">
            選択肢は固定です: 月・火・水・木・金・土・日
          </div>
          <label className="nf-row nf-gap-6">
            <input
              type="checkbox"
              checked={!!field.defaultToday}
              onChange={(event) => onChange({ ...field, defaultToday: event.target.checked })}
            />
            初期値を今日の曜日にする
          </label>
        </div>
      )}

      {isChoice && (
        <div className="nf-mt-8">
          <div className="nf-row-between nf-mb-6">
            <strong>選択肢</strong>
            <button
              type="button"
              className={s.btn.className}
              onClick={() => {
                const next = deepClone(field);
                next.options = next.options || [];
                next.options.push({ id: genId(), label: "", defaultSelected: false });
                onChange(next);
              }}
            >
              選択肢を追加
            </button>
          </div>

          {(field.options || []).map((opt, index) => (
            <OptionRow
              key={opt.id}
              option={opt}
              onChange={(nextOpt) => {
                const next = deepClone(field);
                const prevLabel = opt.label || "";
                const nextLabel = nextOpt.label || "";
                next.options[index] = {
                  id: nextOpt.id || genId(),
                  label: nextLabel,
                  defaultSelected: !!nextOpt.defaultSelected,
                };

                if (prevLabel !== nextLabel && next.childrenByValue?.[prevLabel]) {
                  next.childrenByValue = { ...next.childrenByValue };
                  const movedChildren = next.childrenByValue[prevLabel];
                  const existing = next.childrenByValue[nextLabel];
                  next.childrenByValue[nextLabel] = existing
                    ? normalizeSchemaIDs([...movedChildren, ...existing])
                    : movedChildren;
                  delete next.childrenByValue[prevLabel];
                }
                onChange(next);
              }}
              onDelete={() => {
                const next = deepClone(field);
                next.options.splice(index, 1);
                onChange(next);
                if (selectedOptionIndex === index) {
                  setSelectedOptionIndex(null);
                } else if (selectedOptionIndex > index) {
                  setSelectedOptionIndex(selectedOptionIndex - 1);
                }
              }}
              onFocus={() => {
                setSelectedOptionIndex(index);
                const controlInfo = buildOptionControlInfo(index);
                if (controlInfo) onFocus(controlInfo);
              }}
              isSelected={selectedOptionIndex === index}
              onAddChild={() => {
                if (!canAddChild) return;
                const next = deepClone(field);
                next.childrenByValue = next.childrenByValue || {};
                const key = opt.label;
                next.childrenByValue[key] = normalizeSchemaIDs(next.childrenByValue[key] || []);
                next.childrenByValue[key].push({ id: genId(), type: "text", label: "" });
                onChange(next);
              }}
              canAddChild={canAddChild}
              defaultSelectionControl={
                <label className="nf-row nf-gap-4 nf-nowrap">
                  <input
                    type="checkbox"
                    checked={!!opt.defaultSelected}
                    onChange={(event) => updateChoiceDefaultSelection(index, event.target.checked)}
                    onFocus={() => {
                      setSelectedOptionIndex(index);
                      const controlInfo = buildOptionControlInfo(index);
                      if (controlInfo) onFocus(controlInfo);
                    }}
                  />
                  初期選択
                </label>
              }
              childrenArea={
                (() => {
                  const hasChildren = field.childrenByValue && field.childrenByValue[opt.label]?.length;
                  return hasChildren ? (
                    <div className={s.child.className}>
                      <QuestionListComponent
                        fields={field.childrenByValue[opt.label]}
                        onChange={(childFields) => {
                          const next = deepClone(field);
                          next.childrenByValue[opt.label] = normalizeSchemaIDs(childFields);
                          onChange(next);
                        }}
                        depth={depth + 1}
                        onQuestionControlChange={onQuestionControlChange}
                        getTempState={getTempState}
                        setTempState={setTempState}
                        clearTempState={clearTempState}
                      />
                    </div>
                  ) : null;
                })()
              }
            />
          ))}
        </div>
      )}

      <div className="nf-row nf-gap-8 nf-mt-12">
        <button type="button" className={s.btnDanger.className} onClick={onDelete}>削除</button>
        <div className="nf-flex-1" />
        <button type="button" className={s.btn.className} onClick={onAddBelow}>次の質問を追加</button>
      </div>
    </div>
  );
}

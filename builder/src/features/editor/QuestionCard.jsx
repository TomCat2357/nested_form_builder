import React from "react";
import { buildSafeRegex } from "../../core/validate.js";
import { deepClone, normalizeSchemaIDs, MAX_DEPTH } from "../../core/schema.js";
import { genId } from "../../core/ids.js";
import { resolveIsDisplayed } from "../../core/displayModes.js";
import { buildPhonePattern, getStandardPhonePlaceholder } from "../../core/phone.js";
import { normalizePrintTemplateAction } from "../../utils/printTemplateAction.js";
import { styles as s } from "./styles.js";
import OptionRow from "./OptionRow.jsx";
import {
  WEEKDAY_TYPE,
  MESSAGE_TYPE,
  DISPLAY_LABEL,
  EMAIL_PLACEHOLDER,
  isChoiceType,
  isDateOrTimeType,
  isMessageType,
  isPrintTemplateType,
  isBasicInputType,
  applyDisplayedFlag,
  handleTypeChange,
  PlaceholderInput,
  StyleSettingsInput,
  NumberSettingsInput,
} from "./QuestionCardInputs.jsx";
import { useQuestionCardOptions } from "./useQuestionCardOptions.js";
import {
  PrintTemplateSection,
  MessageSection,
  TextFieldSection,
  EmailFieldSection,
  PhoneFieldSection,
  FileUploadFieldSection,
  DateTimeFieldSection,
  WeekdayFieldSection,
} from "./QuestionCardSections.jsx";

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
  const isDisplayed = resolveIsDisplayed(field);
  const printTemplateAction = normalizePrintTemplateAction(field.printTemplateAction);

  const {
    selectedOptionIndex,
    setSelectedOptionIndex,
    buildOptionControlInfo,
    updateChoiceDefaultSelection,
  } = useQuestionCardOptions({ field, onChange, onFocus, isChoice });

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

      {isPrintTemplate && <PrintTemplateSection field={field} onChange={onChange} printTemplateAction={printTemplateAction} />}

      {!isText && (
        <StyleSettingsInput field={field} onChange={onChange} onFocus={onFocus} getTempState={getTempState} setTempState={setTempState} />
      )}

      {isMessage && <MessageSection field={field} onChange={onChange} />}

      {isText && <TextFieldSection field={field} onChange={onChange} onFocus={onFocus} regexError={regexCheck.error} getTempState={getTempState} setTempState={setTempState} />}

      {isBasicInput && <PlaceholderInput field={field} onChange={onChange} onFocus={onFocus} />}

      {isNumber && <NumberSettingsInput field={field} onChange={onChange} onFocus={onFocus} />}

      {isEmail && <EmailFieldSection field={field} onChange={onChange} onFocus={onFocus} />}

      {isPhone && <PhoneFieldSection field={field} onChange={onChange} onFocus={onFocus} phonePlaceholder={phonePlaceholder} phonePattern={phonePattern} />}

      {field.type === "fileUpload" && <FileUploadFieldSection field={field} onChange={onChange} />}

      {isDateOrTime && <DateTimeFieldSection field={field} onChange={onChange} />}

      {isWeekday && <WeekdayFieldSection field={field} onChange={onChange} />}

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

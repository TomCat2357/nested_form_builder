import React from "react";
import { buildSafeRegex } from "../../core/validate.js";
import { MAX_DEPTH } from "../../core/schema.js";
import { resolveIsDisplayed } from "../../core/displayModes.js";
import { buildPhonePattern } from "../../core/phone.js";
import { normalizePrintTemplateAction } from "../../utils/printTemplateAction.js";
import { styles as s } from "./styles.js";
import {
  WEEKDAY_TYPE,
  MESSAGE_TYPE,
  DISPLAY_LABEL,
  isChoiceType,
  isDateOrTimeType,
  isMessageType,
  isPrintTemplateType,
  isBasicInputType,
  isComputedType,
  applyDisplayedFlag,
  handleTypeChange,
  PlaceholderInput,
  StyleSettingsInput,
  NumberSettingsInput,
} from "./QuestionCardInputs.jsx";
import { useQuestionCardOptions } from "./useQuestionCardOptions.js";
import { useFieldPlaceholderSync } from "./useFieldPlaceholderSync.js";
import ChoiceOptionsSection from "./ChoiceOptionsSection.jsx";
import { PrintTemplateSection } from "./PrintTemplateSection.jsx";
import {
  MessageSection,
  TextFieldSection,
  EmailFieldSection,
  PhoneFieldSection,
  FileUploadFieldSection,
  DateTimeFieldSection,
  WeekdayFieldSection,
  SubstitutionFieldSection,
} from "./QuestionCardSections.jsx";

const FIELD_TYPE_OPTIONS = [
  { value: "text", label: "テキスト" },
  { value: "phone", label: "電話番号" },
  { value: "email", label: "メールアドレス" },
  { value: "url", label: "URL" },
  { value: "number", label: "数値" },
  { value: "date", label: "日付" },
  { value: "time", label: "時間" },
  { value: "weekday", label: "曜日" },
  { value: "checkboxes", label: "チェックボックス" },
  { value: "radio", label: "ラジオボタン" },
  { value: "select", label: "ドロップダウン" },
  { value: "fileUpload", label: "ファイルアップロード" },
  { value: "printTemplate", label: "様式出力" },
  { value: "message", label: "メッセージ" },
  { value: "substitution", label: "置換" },
];

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
  const isComputed = isComputedType(field.type);
  const isSubstitution = field.type === "substitution";
  const canAddChild = depth < MAX_DEPTH;
  const regexCheck = (isText && field.inputRestrictionMode === "pattern")
    ? buildSafeRegex(field.pattern || "")
    : { error: null };
  const phonePattern = isPhone ? buildPhonePattern(field) : "";
  const isDisplayed = resolveIsDisplayed(field);
  const printTemplateAction = normalizePrintTemplateAction(field.printTemplateAction);

  const { phonePlaceholder } = useFieldPlaceholderSync({
    field, onChange, isText, isBasicInput, isEmail, isPhone,
  });

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
          {FIELD_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {!isMessage && !isPrintTemplate && !isComputed && (
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

      {isSubstitution && <SubstitutionFieldSection field={field} onChange={onChange} />}

      {isChoice && (
        <ChoiceOptionsSection
          field={field}
          onChange={onChange}
          onFocus={onFocus}
          canAddChild={canAddChild}
          depth={depth}
          selectedOptionIndex={selectedOptionIndex}
          setSelectedOptionIndex={setSelectedOptionIndex}
          buildOptionControlInfo={buildOptionControlInfo}
          updateChoiceDefaultSelection={updateChoiceDefaultSelection}
          QuestionListComponent={QuestionListComponent}
          onQuestionControlChange={onQuestionControlChange}
          getTempState={getTempState}
          setTempState={setTempState}
          clearTempState={clearTempState}
        />
      )}

      <div className="nf-row nf-gap-8 nf-mt-12">
        <button type="button" className={s.btnDanger.className} onClick={onDelete}>削除</button>
        <div className="nf-flex-1" />
        <button type="button" className={s.btn.className} onClick={onAddBelow}>次の質問を追加</button>
      </div>
    </div>
  );
}

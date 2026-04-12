import { deepClone, cleanUnusedFieldProperties, DEFAULT_TEXT_MAX_LENGTH, DEFAULT_MULTILINE_ROWS } from "../../core/schema.js";
import { genId } from "../../core/ids.js";
import { resolveIsDisplayed } from "../../core/displayModes.js";
import { normalizePhoneSettings } from "../../core/phone.js";
import {
  normalizePrintTemplateAction,
} from "../../utils/printTemplateAction.js";

export const CHOICE_TYPES = ["radio", "select", "checkboxes"];
export const WEEKDAY_TYPE = "weekday";
export const DATE_TIME_TYPES = ["date", "time"];
export const BASIC_INPUT_TYPES = ["number", "url"];
export const MESSAGE_TYPE = "message";
export const PRINT_TEMPLATE_TYPE = "printTemplate";
export const CALCULATED_TYPE = "calculated";
export const SUBSTITUTION_TYPE = "substitution";
export const DISPLAY_LABEL = "表示";
export const EMAIL_PLACEHOLDER = "user@example.com";
export const EXCLUDE_FROM_SEARCH_AND_PRINT_LABEL = "一覧・印刷から除外";

export const isChoiceType = (type) => CHOICE_TYPES.includes(type);
export const isDateOrTimeType = (type) => DATE_TIME_TYPES.includes(type);
export const isMessageType = (type) => type === MESSAGE_TYPE;
export const isPrintTemplateType = (type) => type === PRINT_TEMPLATE_TYPE;
export const isBasicInputType = (type) => BASIC_INPUT_TYPES.includes(type);
export const isCalculatedType = (type) => type === CALCULATED_TYPE;
export const isSubstitutionType = (type) => type === SUBSTITUTION_TYPE;
export const isComputedType = (type) => type === CALCULATED_TYPE || type === SUBSTITUTION_TYPE;

export const applyDisplayedFlag = (target, displayed) => {
  target.isDisplayed = displayed === true;
};

export const normalizeTextFieldSettings = (field) => {
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

export function saveAndClearChoiceState(next, field, oldIsChoice, setTempState) {
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

export function handleTypeChange(field, newType, { getTempState, setTempState } = {}) {
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
    if (isDateOrTimeType(newType)) {
      next.defaultNow = !!next.defaultNow;
      if (newType === "time") next.includeSeconds = !!next.includeSeconds;
    }
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
    if (newType === CALCULATED_TYPE) {
      next.formula = typeof next.formula === "string" ? next.formula : "";
      next.excludeFromSearch = !!next.excludeFromSearch;
      next.hideFromRecordView = !!next.hideFromRecordView;
    }
    if (newType === SUBSTITUTION_TYPE) {
      next.templateText = typeof next.templateText === "string" ? next.templateText : "";
      next.excludeFromSearch = !!next.excludeFromSearch;
      next.hideFromRecordView = !!next.hideFromRecordView;
    }
    saveAndClearChoiceState(next, field, oldIsChoice, setTempState);
  }

  cleanUnusedFieldProperties(next);
  applyDisplayedFlag(next, wasDisplayed);
  return next;
}

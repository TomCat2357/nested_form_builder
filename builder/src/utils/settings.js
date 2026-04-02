export const SAVE_AFTER_ACTIONS = Object.freeze({
  RETURN_TO_LIST: "returnToList",
  STAY_ON_RECORD: "stayOnRecord",
});

/**
 * settings オブジェクトから theme プロパティを除外する
 * @param {object} settings
 * @returns {object}
 */
export const omitThemeSetting = (settings) => {
  if (!settings || typeof settings !== "object") return {};
  const { theme, representativeFieldId, ...rest } = settings;
  return rest;
};

export const resolveSaveAfterAction = (settings) => (
  settings?.saveAfterAction === SAVE_AFTER_ACTIONS.STAY_ON_RECORD
    ? SAVE_AFTER_ACTIONS.STAY_ON_RECORD
    : SAVE_AFTER_ACTIONS.RETURN_TO_LIST
);

export const resolveCreatePrintOnSave = (settings) => settings?.createPrintOnSave === true;

export const buildPrimarySaveOptions = (settings) => (
  resolveSaveAfterAction(settings) === SAVE_AFTER_ACTIONS.STAY_ON_RECORD
    ? { stayAsView: true }
    : { redirect: true }
);

export const resolveSettingsFieldValue = (field, value) => {
  const isSelect = field?.type === "select" || Array.isArray(field?.options);
  if (isSelect) return value ?? field?.defaultValue ?? "";
  return value ?? "";
};

export const resolveSettingsCheckboxChecked = (field, value) => (
  value !== undefined ? !!value : !!field?.defaultValue
);

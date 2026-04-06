export const THEME_SYNC_SCOPE = Object.freeze({
  NONE: "none",
  GLOBAL_ONLY: "global-only",
  GLOBAL_AND_ALL_FORMS: "global-and-all-forms",
  CURRENT_FORM_ONLY: "current-form-only",
  ALL_FORMS_FROM_GLOBAL: "all-forms-from-global",
});

export const THEME_SYNC_TRIGGER = Object.freeze({
  THEME_UPDATED: "theme-updated",
  SYNC_ENABLED: "sync-enabled",
});

export const resolveThemeSyncScope = ({
  isFormMode = false,
  syncAllFormsTheme = false,
  trigger = THEME_SYNC_TRIGGER.THEME_UPDATED,
} = {}) => {
  switch (trigger) {
    case THEME_SYNC_TRIGGER.THEME_UPDATED:
      if (isFormMode) return THEME_SYNC_SCOPE.CURRENT_FORM_ONLY;
      return syncAllFormsTheme
        ? THEME_SYNC_SCOPE.GLOBAL_AND_ALL_FORMS
        : THEME_SYNC_SCOPE.GLOBAL_ONLY;
    case THEME_SYNC_TRIGGER.SYNC_ENABLED:
      return isFormMode
        ? THEME_SYNC_SCOPE.NONE
        : THEME_SYNC_SCOPE.ALL_FORMS_FROM_GLOBAL;
    default:
      throw new Error(`Unknown theme sync trigger: ${trigger}`);
  }
};

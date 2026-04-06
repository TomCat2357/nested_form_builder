import { SETTINGS_GROUPS } from "../features/settings/settingsSchema.js";

export const getConfigPageSaveAfterActionField = () => (
  SETTINGS_GROUPS.find((group) => group.key === "record")?.fields.find((field) => field.key === "saveAfterAction") || null
);

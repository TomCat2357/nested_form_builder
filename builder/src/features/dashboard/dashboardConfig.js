import { readSettingsValue, writeSettingsValue } from "../../core/storage.js";

export const DASHBOARD_CONFIG_KEY = "dashboard.layout.v1";

export const loadDashboardConfig = async () => {
  const value = await readSettingsValue(DASHBOARD_CONFIG_KEY);
  if (!value || typeof value !== "object") return null;
  return {
    selectedFormIds: Array.isArray(value.selectedFormIds) ? value.selectedFormIds : [],
    widgets: Array.isArray(value.widgets) ? value.widgets : [],
  };
};

export const saveDashboardConfig = async (config) => {
  await writeSettingsValue(DASHBOARD_CONFIG_KEY, {
    selectedFormIds: Array.isArray(config?.selectedFormIds) ? config.selectedFormIds : [],
    widgets: Array.isArray(config?.widgets) ? config.widgets : [],
  });
};

let counter = 0;
export const makeWidgetId = () => {
  counter += 1;
  return `w_${Date.now().toString(36)}_${counter.toString(36)}`;
};

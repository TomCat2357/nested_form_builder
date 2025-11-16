export const SETTINGS_STORAGE_KEY = "nested_form_builder_settings_v1";

const readLocalJson = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[storage] failed to read ${key}`, err);
    return null;
  }
};

const writeLocalJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[storage] failed to write ${key}`, err);
  }
};

export const DEFAULT_SETTINGS = {
  formTitle: "受付フォーム",
  spreadsheetId: "",
  sheetName: "Responses",
  gasUrl: "",
  pageSize: 20,
};

export const loadSettingsFromStorage = () => {
  const loaded = readLocalJson(SETTINGS_STORAGE_KEY);
  if (!loaded) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...loaded };
};

export const saveSettingsToStorage = (settings) => {
  writeLocalJson(SETTINGS_STORAGE_KEY, { ...DEFAULT_SETTINGS, ...settings });
};

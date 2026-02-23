import { openDB, STORE_NAMES } from '../app/state/dbHelpers.js';
import { DEFAULT_PAGE_SIZE, DEFAULT_SHEET_NAME } from './constants.js';

export const SETTINGS_STORAGE_KEY = "nested_form_builder_settings_v1";

const readJson = async (key) => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAMES.settings, "readonly");
    const store = tx.objectStore(STORE_NAMES.settings);
    const request = store.get(key);
    const value = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value?.value || null;
  } catch (err) {
    console.warn(`[storage] failed to read ${key}`, err);
    return null;
  }
};

export const readSettingsValue = async (key) => readJson(key);

const writeJson = async (key, value) => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAMES.settings, "readwrite");
    const store = tx.objectStore(STORE_NAMES.settings);
    const request = store.put({ key, value });
    await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch (err) {
    console.warn(`[storage] failed to write ${key}`, err);
  }
};

export const writeSettingsValue = async (key, value) => writeJson(key, value);

export const DEFAULT_SETTINGS = {
  spreadsheetId: "",
  sheetName: DEFAULT_SHEET_NAME,
  theme: "standard",
  pageSize: DEFAULT_PAGE_SIZE,
  searchCellMaxChars: "",
  syncAllFormsTheme: false,
};

export const loadSettingsFromStorage = async () => {
  const loaded = await readJson(SETTINGS_STORAGE_KEY);
  if (!loaded) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...loaded };
};

export const saveSettingsToStorage = async (settings) => {
  await writeJson(SETTINGS_STORAGE_KEY, { ...DEFAULT_SETTINGS, ...settings });
};

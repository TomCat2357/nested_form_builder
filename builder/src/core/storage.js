export const SETTINGS_STORAGE_KEY = "nested_form_builder_settings_v1";
const DB_NAME = "NestedFormBuilder";
const SETTINGS_STORE_NAME = "settingsStore";
const DB_VERSION = 4;

const openDB = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
        db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: "key" });
      }
    };
  });

const readJson = async (key) => {
  try {
    const db = await openDB();
    const tx = db.transaction(SETTINGS_STORE_NAME, "readonly");
    const store = tx.objectStore(SETTINGS_STORE_NAME);
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

const writeJson = async (key, value) => {
  try {
    const db = await openDB();
    const tx = db.transaction(SETTINGS_STORE_NAME, "readwrite");
    const store = tx.objectStore(SETTINGS_STORE_NAME);
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

export const DEFAULT_SETTINGS = {
  spreadsheetId: "",
  sheetName: "Responses",
  pageSize: 20,
  searchCellMaxChars: "",
};

export const loadSettingsFromStorage = async () => {
  const loaded = await readJson(SETTINGS_STORAGE_KEY);
  if (!loaded) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...loaded };
};

export const saveSettingsToStorage = async (settings) => {
  await writeJson(SETTINGS_STORAGE_KEY, { ...DEFAULT_SETTINGS, ...settings });
};

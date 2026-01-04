const THEME_STORAGE_KEY = "nested_form_builder_theme";
export const DEFAULT_THEME = "balanced";
export const THEME_OPTIONS = [
  { value: "balanced", label: "Balanced" },
  { value: "warm", label: "Warm" },
];

const safeStorageGet = (key) => {
  try {
    return window?.localStorage?.getItem(key);
  } catch (error) {
    return null;
  }
};

const safeStorageSet = (key, value) => {
  try {
    window?.localStorage?.setItem(key, value);
  } catch (error) {
    // ignore storage failures (private mode, disabled)
  }
};

export const applyTheme = (name) => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = name;
};

export const initTheme = (fallback = DEFAULT_THEME) => {
  const saved = safeStorageGet(THEME_STORAGE_KEY);
  const theme = saved || fallback;
  applyTheme(theme);
  return theme;
};

export const setTheme = (name) => {
  applyTheme(name);
  safeStorageSet(THEME_STORAGE_KEY, name);
};

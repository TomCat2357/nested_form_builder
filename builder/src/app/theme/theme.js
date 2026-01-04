const THEME_STORAGE_KEY = "nested_form_builder_theme";
export const DEFAULT_THEME = "default";
export const THEME_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "warm", label: "Warm" },
];
export const CUSTOM_THEME_ID = "drive";

const CUSTOM_THEME_STYLE_ID = "nfb-custom-theme";
const CUSTOM_THEME_CSS_KEY = "nested_form_builder_theme_custom_css";
const CUSTOM_THEME_NAME_KEY = "nested_form_builder_theme_custom_name";
const CUSTOM_THEME_URL_KEY = "nested_form_builder_theme_custom_url";
const CUSTOM_THEME_SELECTOR = `:root[data-theme="${CUSTOM_THEME_ID}"]`;

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

const safeStorageRemove = (key) => {
  try {
    window?.localStorage?.removeItem(key);
  } catch (error) {
    // ignore storage failures (private mode, disabled)
  }
};

const ensureCustomThemeStyle = (css) => {
  if (typeof document === "undefined") return;
  const styleId = CUSTOM_THEME_STYLE_ID;
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = css || "";
};

const normalizeCustomThemeCss = (css) => {
  if (!css) return "";
  let normalized = String(css).trim();
  if (!normalized) return "";

  const dataThemeRegex = /data-theme=(["'])(.*?)\1/;
  if (dataThemeRegex.test(normalized)) {
    return normalized.replace(/data-theme=(["'])(.*?)\1/g, `data-theme="${CUSTOM_THEME_ID}"`);
  }

  const rootRegex = /:root(?!\[data-theme\])/;
  if (rootRegex.test(normalized)) {
    return normalized.replace(/:root(?!\[data-theme\])/g, CUSTOM_THEME_SELECTOR);
  }

  return `${CUSTOM_THEME_SELECTOR} {\n${normalized}\n}\n`;
};

export const getCustomThemeInfo = () => {
  return {
    css: safeStorageGet(CUSTOM_THEME_CSS_KEY) || "",
    name: safeStorageGet(CUSTOM_THEME_NAME_KEY) || "",
    url: safeStorageGet(CUSTOM_THEME_URL_KEY) || "",
  };
};

export const setCustomTheme = ({ css, name, url } = {}) => {
  const normalized = normalizeCustomThemeCss(css);
  if (!normalized) return "";
  safeStorageSet(CUSTOM_THEME_CSS_KEY, normalized);
  safeStorageSet(CUSTOM_THEME_NAME_KEY, name || "");
  safeStorageSet(CUSTOM_THEME_URL_KEY, url || "");
  ensureCustomThemeStyle(normalized);
  return normalized;
};

export const clearCustomTheme = () => {
  safeStorageRemove(CUSTOM_THEME_CSS_KEY);
  safeStorageRemove(CUSTOM_THEME_NAME_KEY);
  safeStorageRemove(CUSTOM_THEME_URL_KEY);
  if (typeof document === "undefined") return;
  const style = document.getElementById(CUSTOM_THEME_STYLE_ID);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
  }
};

export const restoreCustomTheme = () => {
  const { css } = getCustomThemeInfo();
  if (css) {
    ensureCustomThemeStyle(css);
  }
  return css;
};

export const applyTheme = (name) => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = name;
};

export const initTheme = (fallback = DEFAULT_THEME) => {
  const saved = safeStorageGet(THEME_STORAGE_KEY);
  const theme = saved || fallback;
  applyTheme(theme);
  restoreCustomTheme();
  return theme;
};

export const setTheme = (name) => {
  applyTheme(name);
  safeStorageSet(THEME_STORAGE_KEY, name);
};

const THEME_STORAGE_KEY = "nested_form_builder_theme";
export const DEFAULT_THEME = "standard";
export const THEME_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "matcha", label: "Matcha" },
  { value: "sakura", label: "Sakura" },
  { value: "warm", label: "Warm" },
];

const CUSTOM_THEME_STYLE_ID = "nfb-custom-themes";
const CUSTOM_THEMES_KEY = "nested_form_builder_theme_custom_list_v1";
const CUSTOM_THEME_PREFIX = "drive-";

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

const ensureCustomThemeStyle = (themes) => {
  if (typeof document === "undefined") return;
  const styleId = CUSTOM_THEME_STYLE_ID;
  const css = (themes || []).map((theme) => theme.css).filter(Boolean).join("\n");
  let style = document.getElementById(styleId);
  if (!css) {
    if (style && style.parentNode) {
      style.parentNode.removeChild(style);
    }
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = css;
};

const normalizeCustomThemeCss = (css, themeId) => {
  if (!css) return "";
  let normalized = String(css).trim();
  if (!normalized) return "";
  const themeSelector = `:root[data-theme="${themeId}"]`;

  const dataThemeRegex = /data-theme=(["'])(.*?)\1/;
  if (dataThemeRegex.test(normalized)) {
    return normalized.replace(/data-theme=(["'])(.*?)\1/g, `data-theme="${themeId}"`);
  }

  const rootRegex = /:root(?!\[data-theme\])/;
  if (rootRegex.test(normalized)) {
    return normalized.replace(/:root(?!\[data-theme\])/g, themeSelector);
  }

  return `${themeSelector} {\n${normalized}\n}\n`;
};

const readCustomThemes = () => {
  try {
    const raw = safeStorageGet(CUSTOM_THEMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((theme) => theme && typeof theme.id === "string" && typeof theme.css === "string")
      .map((theme) => ({
        id: theme.id,
        name: theme.name || "",
        url: theme.url || "",
        css: theme.css || "",
      }))
      .filter((theme) => theme.id && theme.css);
  } catch {
    return [];
  }
};

const writeCustomThemes = (themes) => {
  safeStorageSet(CUSTOM_THEMES_KEY, JSON.stringify(themes || []));
};

const normalizeThemeName = (name) => {
  const normalized = String(name || "").trim().toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "custom";
};

const createThemeId = (name, existingIds) => {
  const base = `${CUSTOM_THEME_PREFIX}${normalizeThemeName(name)}`;
  let id = base;
  let index = 2;
  const reservedIds = new Set(THEME_OPTIONS.map((option) => option.value));
  while (existingIds.has(id) || reservedIds.has(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
};

export const getCustomThemes = () => readCustomThemes();

export const setCustomTheme = ({ css, name, url } = {}) => {
  const themes = readCustomThemes();
  const existingIds = new Set(themes.map((theme) => theme.id));
  const themeId = createThemeId(name || "custom", existingIds);
  const normalized = normalizeCustomThemeCss(css, themeId);
  if (!normalized) return null;
  const theme = {
    id: themeId,
    name: name || "",
    url: url || "",
    css: normalized,
  };
  const next = [...themes, theme];
  writeCustomThemes(next);
  ensureCustomThemeStyle(next);
  return theme;
};

export const removeCustomTheme = (themeId) => {
  const themes = readCustomThemes();
  const next = themes.filter((theme) => theme.id !== themeId);
  writeCustomThemes(next);
  ensureCustomThemeStyle(next);
  return next;
};

export const restoreCustomThemes = () => {
  const themes = readCustomThemes();
  ensureCustomThemeStyle(themes);
  return themes;
};

export const applyTheme = (name) => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = name;
};

export const initTheme = (fallback = DEFAULT_THEME) => {
  const saved = safeStorageGet(THEME_STORAGE_KEY);
  const resolvedTheme = saved === "default" ? DEFAULT_THEME : saved;
  const theme = resolvedTheme || fallback;
  applyTheme(theme);
  restoreCustomThemes();
  if (saved === "default") {
    safeStorageSet(THEME_STORAGE_KEY, theme);
  }
  return theme;
};

export const setTheme = (name) => {
  applyTheme(name);
  safeStorageSet(THEME_STORAGE_KEY, name);
};

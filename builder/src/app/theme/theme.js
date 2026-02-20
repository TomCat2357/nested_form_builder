import { readSettingsValue, writeSettingsValue } from "../../core/storage.js";

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

const safeLegacyStorageGet = (key) => {
  try {
    return window?.localStorage?.getItem(key);
  } catch (error) {
    return null;
  }
};

const safeLegacyStorageRemove = (key) => {
  try {
    window?.localStorage?.removeItem(key);
  } catch (error) {
    // ignore legacy storage failures
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

const normalizeCustomThemes = (input) => {
  if (!input) return [];
  let parsed = input;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
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
};

const readCustomThemes = async () => {
  const stored = await readSettingsValue(CUSTOM_THEMES_KEY);
  const normalized = normalizeCustomThemes(stored);
  if (stored !== null && stored !== undefined) return normalized;

  const legacy = normalizeCustomThemes(safeLegacyStorageGet(CUSTOM_THEMES_KEY));
  if (legacy.length > 0) {
    await writeSettingsValue(CUSTOM_THEMES_KEY, legacy);
    safeLegacyStorageRemove(CUSTOM_THEMES_KEY);
  }
  return legacy;
};

const writeCustomThemes = async (themes) => {
  await writeSettingsValue(CUSTOM_THEMES_KEY, themes || []);
};

const readThemeFromStorage = async () => {
  const stored = await readSettingsValue(THEME_STORAGE_KEY);
  let theme = typeof stored === "string" ? stored : "";
  if (!theme) {
    const legacy = safeLegacyStorageGet(THEME_STORAGE_KEY);
    if (legacy) {
      const resolvedLegacy = legacy === "default" ? DEFAULT_THEME : legacy;
      await writeSettingsValue(THEME_STORAGE_KEY, resolvedLegacy);
      safeLegacyStorageRemove(THEME_STORAGE_KEY);
      theme = resolvedLegacy;
    }
  }
  return theme || null;
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

export const getCustomThemes = async () => readCustomThemes();

export const setCustomTheme = async ({ css, name, url } = {}) => {
  const themes = await readCustomThemes();
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
  await writeCustomThemes(next);
  ensureCustomThemeStyle(next);
  return theme;
};

export const removeCustomTheme = async (themeId) => {
  const themes = await readCustomThemes();
  const next = themes.filter((theme) => theme.id !== themeId);
  await writeCustomThemes(next);
  ensureCustomThemeStyle(next);
  return next;
};

export const restoreCustomThemes = async () => {
  const themes = await readCustomThemes();
  ensureCustomThemeStyle(themes);
  return themes;
};

export const applyTheme = (name) => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = name;
};

export const initTheme = (fallback = DEFAULT_THEME) => {
  const initialTheme = fallback || DEFAULT_THEME;
  applyTheme(initialTheme);
  void (async () => {
    try {
      const saved = await readThemeFromStorage();
      const resolvedTheme = saved === "default" ? DEFAULT_THEME : saved;
      const theme = resolvedTheme || initialTheme;
      applyTheme(theme);
      if (saved === "default") {
        await writeSettingsValue(THEME_STORAGE_KEY, theme);
      }
    } catch (error) {
      console.warn("[theme] failed to load theme from IndexedDB", error);
    } finally {
      try {
        await restoreCustomThemes();
      } catch (error) {
        console.warn("[theme] failed to restore custom themes", error);
      }
    }
  })();
  return initialTheme;
};

export const setTheme = (name) => {
  applyTheme(name);
  if (!name) return;
  void writeSettingsValue(THEME_STORAGE_KEY, name);
};

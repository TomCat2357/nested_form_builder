import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, loadSettingsFromStorage, saveSettingsToStorage } from "../../core/storage.js";
import { DEFAULT_THEME, setTheme } from "../../app/theme/theme.js";

export const useBuilderSettings = () => {
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [loadingLocal, setLoadingLocal] = useState(true);
  const defaultsRef = useRef({ ...DEFAULT_SETTINGS });

  useEffect(() => {
    let active = true;
    (async () => {
      const loaded = await loadSettingsFromStorage();
      if (!active) return;
      setSettings((prev) => {
        const merged = { ...DEFAULT_SETTINGS, ...loaded, ...prev };
        if (loaded?.theme && prev?.theme === DEFAULT_SETTINGS.theme) {
          merged.theme = loaded.theme;
        }
        defaultsRef.current = merged;
        return merged;
      });
      setLoadingLocal(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loadingLocal) return;
    (async () => {
      await saveSettingsToStorage(settings);
    })();
  }, [settings, loadingLocal]);

  useEffect(() => {
    if (loadingLocal) return;
    defaultsRef.current = { ...DEFAULT_SETTINGS, ...settings };
  }, [settings, loadingLocal, defaultsRef]);

  useEffect(() => {
    if (loadingLocal) return;
    setTheme(settings?.theme || DEFAULT_THEME);
  }, [settings?.theme, loadingLocal]);

  const updateSetting = useCallback(
    (key, value) => {
      setSettings((prev) => (prev?.[key] === value ? prev : { ...prev, [key]: value }));
    },
    [setSettings],
  );

  const replaceSettings = useCallback(
    (next = {}) => {
      let merged = { ...DEFAULT_SETTINGS, ...defaultsRef.current, ...next };
      setSettings((prev) => {
        const prevObj = prev || {};
        const keys = new Set([...Object.keys(prevObj), ...Object.keys(merged)]);
        for (const key of keys) {
          if (prevObj[key] !== merged[key]) {
            return merged;
          }
        }
        merged = prevObj;
        return prev;
      });
      return merged;
    },
    [defaultsRef, setSettings],
  );

  return { settings, updateSetting, replaceSettings };
};

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, loadSettingsFromStorage, saveSettingsToStorage } from "../../core/storage.js";
import { hasScriptRun, loadUserSettings, saveUserSettings } from "../../services/gasClient.js";

export const useBuilderSettings = () => {
  const scriptRunAvailable = hasScriptRun();
  const [settings, setSettings] = useState(() => loadSettingsFromStorage());
  const [loading, setLoading] = useState(scriptRunAvailable);
  const defaultsRef = useRef({ ...DEFAULT_SETTINGS });

  useEffect(() => {
    if (!scriptRunAvailable) return;
    let active = true;
    (async () => {
      try {
        const remote = await loadUserSettings();
        if (!active) return;
        if (remote && typeof remote === "object") {
          defaultsRef.current = { ...DEFAULT_SETTINGS, ...remote };
          setSettings((prev) => ({ ...defaultsRef.current, ...prev }));
        }
      } catch (error) {
        console.warn("[settings] failed to load user settings", error);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [scriptRunAvailable, defaultsRef]);

  useEffect(() => {
    if (loading) return;
    saveSettingsToStorage(settings);
    if (scriptRunAvailable) {
      saveUserSettings(settings).catch((error) => {
        console.warn("[settings] failed to save user settings", error);
      });
    }
  }, [settings, loading, scriptRunAvailable]);

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

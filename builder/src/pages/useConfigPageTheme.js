import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_THEME,
  THEME_OPTIONS,
  getCustomThemes,
  removeCustomTheme,
  setCustomTheme,
  applyThemeWithFallback,
  resolveThemeName,
} from "../app/theme/theme.js";
import { hasScriptRun, importThemeFromDrive } from "../services/gasClient.js";
import {
  THEME_SYNC_SCOPE,
  THEME_SYNC_TRIGGER,
  resolveThemeSyncScope,
} from "../features/settings/themeSyncRules.js";

const extractThemeName = (css, fallbackName = "") => {
  const match = String(css || "").match(/data-theme=(["'])([^"']+)\1/);
  if (match && match[2]) return match[2].trim();
  if (fallbackName) {
    return fallbackName.replace(/\.[^/.]+$/, "");
  }
  return "";
};

const buildThemeApplyMessage = (updated, failed) => {
  if (updated === 0 && failed === 0) return "更新対象のフォームはありませんでした。";
  if (failed === 0) return `${updated}件のフォームテーマを更新しました。`;
  return `${updated}件のフォームテーマを更新し、${failed}件は更新に失敗しました。`;
};

export function useConfigPageTheme({
  isFormMode,
  targetForm,
  forms,
  updateForm,
  updateSetting,
  updateCurrentFormSettings,
  showAlert,
  rawFormTheme,
  rawGlobalTheme,
  globalTheme,
  syncAllFormsTheme,
}) {
  const [customThemes, setCustomThemes] = useState([]);
  const [customThemesReady, setCustomThemesReady] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [applyingTheme, setApplyingTheme] = useState(false);

  const themeOptions = useMemo(
    () => [
      ...THEME_OPTIONS,
      ...customThemes.map((theme) => ({ value: theme.id, label: theme.name || "カスタムテーマ" })),
    ],
    [customThemes],
  );
  const availableThemeIds = useMemo(
    () => new Set(themeOptions.map((option) => option.value)),
    [themeOptions],
  );
  const formTheme = rawFormTheme || DEFAULT_THEME;
  const themeValue = isFormMode ? formTheme : globalTheme;
  const selectThemeValue = availableThemeIds.has(themeValue) ? themeValue : DEFAULT_THEME;
  const themeUpdateScope = resolveThemeSyncScope({
    isFormMode,
    syncAllFormsTheme,
    trigger: THEME_SYNC_TRIGGER.THEME_UPDATED,
  });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const themes = await getCustomThemes();
        if (active) {
          setCustomThemes(themes);
        }
      } finally {
        if (active) {
          setCustomThemesReady(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const applyThemeToAllForms = useCallback(
    async (nextTheme) => {
      const targets = forms.filter((form) => (form?.settings?.theme || DEFAULT_THEME) !== nextTheme);
      let updated = 0;
      let failed = 0;

      for (const form of targets) {
        try {
          await updateForm(form.id, {
            settings: { ...(form.settings || {}), theme: nextTheme },
          });
          updated += 1;
        } catch (error) {
          failed += 1;
          console.error("[ConfigPage] applyThemeToAllForms failed", { formId: form.id, error });
        }
      }
      return { updated, failed };
    },
    [forms, updateForm],
  );

  // テーマ欠損時のフォールバック（IndexedDBクリア等）
  useEffect(() => {
    if (!customThemesReady) return;

    if (isFormMode) {
      if (!targetForm) return;
      const resolved = resolveThemeName(rawFormTheme, customThemes);
      if (resolved !== rawFormTheme) {
        void updateForm(targetForm.id, {
          settings: { ...(targetForm.settings || {}), theme: resolved },
        });
      }
      return;
    }

    const resolved = resolveThemeName(rawGlobalTheme, customThemes);
    if (resolved !== rawGlobalTheme) {
      updateSetting("theme", resolved);
      if (themeUpdateScope === THEME_SYNC_SCOPE.GLOBAL_AND_ALL_FORMS) {
        void applyThemeToAllForms(resolved);
      }
    }
  }, [
    customThemesReady,
    isFormMode,
    targetForm?.id,
    targetForm?.settings,
    rawFormTheme,
    rawGlobalTheme,
    customThemes,
    updateSetting,
    updateForm,
    themeUpdateScope,
    applyThemeToAllForms,
  ]);

  const handleChangeMainTheme = useCallback(async (nextTheme) => {
    updateSetting("theme", nextTheme);
  }, [updateSetting]);

  const handleChangeFormTheme = useCallback(
    async (nextTheme) => {
      if (!targetForm) return;
      await updateCurrentFormSettings({ theme: nextTheme });
      await applyThemeWithFallback(nextTheme, { persist: false });
    },
    [targetForm, updateCurrentFormSettings],
  );

  const handleThemeChange = async (event) => {
    const nextTheme = event.target.value;

    if (themeUpdateScope === THEME_SYNC_SCOPE.CURRENT_FORM_ONLY) {
      await handleChangeFormTheme(nextTheme);
      return;
    }

    await handleChangeMainTheme(nextTheme);
    if (themeUpdateScope !== THEME_SYNC_SCOPE.GLOBAL_AND_ALL_FORMS) return;

    setApplyingTheme(true);
    try {
      await applyThemeToAllForms(nextTheme);
    } finally {
      setApplyingTheme(false);
    }
  };

  const handleToggleSyncAllFormsTheme = async (checked) => {
    updateSetting("syncAllFormsTheme", checked);
    const syncToggleScope = resolveThemeSyncScope({
      isFormMode,
      syncAllFormsTheme: checked,
      trigger: THEME_SYNC_TRIGGER.SYNC_ENABLED,
    });
    if (syncToggleScope !== THEME_SYNC_SCOPE.ALL_FORMS_FROM_GLOBAL) return;

    setApplyingTheme(true);
    try {
      await applyThemeToAllForms(globalTheme);
    } finally {
      setApplyingTheme(false);
    }
  };

  const handleImportTheme = async () => {
    if (importing) return;
    if (!hasScriptRun()) {
      showAlert("インポート機能はGoogle Apps Script環境でのみ利用可能です");
      return;
    }
    const url = (importUrl || "").trim();
    if (!url) {
      showAlert("Google Drive URLを入力してください");
      return;
    }
    setImporting(true);
    try {
      const result = await importThemeFromDrive(url);
      const css = result?.css || "";
      if (!css.trim()) {
        throw new Error("テーマファイルが空です");
      }
      const name = extractThemeName(css, result?.fileName);
      const theme = await setCustomTheme({ css, name });
      if (!theme) {
        throw new Error("テーマファイルが空です");
      }
      const nextThemes = await getCustomThemes();
      setCustomThemes(nextThemes);
      setImportUrl("");

      if (themeUpdateScope === THEME_SYNC_SCOPE.CURRENT_FORM_ONLY) {
        await handleChangeFormTheme(theme.id);
      } else {
        await handleChangeMainTheme(theme.id);
        if (themeUpdateScope === THEME_SYNC_SCOPE.GLOBAL_AND_ALL_FORMS) {
          const { updated, failed } = await applyThemeToAllForms(theme.id);
          showAlert(`テーマをインポートしました。${buildThemeApplyMessage(updated, failed)}`);
          return;
        }
      }
      showAlert("テーマをインポートしました");
    } catch (error) {
      console.error("[ConfigPage] theme import failed", error);
      showAlert(error?.message || "テーマのインポートに失敗しました");
    } finally {
      setImporting(false);
    }
  };

  const handleRemoveCustomTheme = (theme) => {
    if (!theme) return;
    setRemoveTarget(theme);
  };

  const handleConfirmRemove = async () => {
    if (!removeTarget) return;
    const nextThemes = await removeCustomTheme(removeTarget.id);
    setCustomThemes(nextThemes);
    let syncMessage = "";
    if (selectThemeValue === removeTarget.id) {
      if (themeUpdateScope === THEME_SYNC_SCOPE.CURRENT_FORM_ONLY && targetForm) {
        await handleChangeFormTheme(DEFAULT_THEME);
      } else {
        await handleChangeMainTheme(DEFAULT_THEME);
        if (themeUpdateScope === THEME_SYNC_SCOPE.GLOBAL_AND_ALL_FORMS) {
          const { updated, failed } = await applyThemeToAllForms(DEFAULT_THEME);
          syncMessage = ` ${buildThemeApplyMessage(updated, failed)}`;
        }
      }
    }
    setRemoveTarget(null);
    showAlert(`インポートしたテーマを削除しました。${syncMessage}`.trim());
  };

  const removeOptions = [
    { value: "cancel", label: "キャンセル", onSelect: () => setRemoveTarget(null) },
    { value: "remove", label: "削除する", variant: "danger", onSelect: handleConfirmRemove },
  ];

  return {
    customThemes,
    customThemesReady,
    importUrl,
    setImportUrl,
    importing,
    removeTarget,
    applyingTheme,
    themeOptions,
    selectThemeValue,
    themeUpdateScope,
    handleThemeChange,
    handleToggleSyncAllFormsTheme,
    handleImportTheme,
    handleRemoveCustomTheme,
    removeOptions,
  };
}

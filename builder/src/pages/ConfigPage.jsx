import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import AlertDialog from "../app/components/AlertDialog.jsx";
import { useAlert } from "../app/hooks/useAlert.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import {
  DEFAULT_THEME,
  THEME_OPTIONS,
  getCustomThemes,
  removeCustomTheme,
  setCustomTheme,
  applyThemeWithFallback,
  resolveThemeName,
} from "../app/theme/theme.js";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import { hasScriptRun, importThemeFromDrive } from "../services/gasClient.js";

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

export default function ConfigPage() {
  const [searchParams] = useSearchParams();
  const requestedFormId = (searchParams.get("formId") || "").trim();
  const isFormMode = requestedFormId !== "";

  const { settings, updateSetting } = useBuilderSettings();
  const { forms, getFormById, updateForm } = useAppData();
  const { alertState, showAlert, closeAlert } = useAlert();

  const targetForm = useMemo(
    () => (requestedFormId ? getFormById(requestedFormId) : null),
    [requestedFormId, getFormById],
  );
  const rawFormTheme = targetForm?.settings?.theme;
  const formTheme = rawFormTheme || DEFAULT_THEME;
  const rawGlobalTheme = settings?.theme;
  const globalTheme = rawGlobalTheme || DEFAULT_THEME;
  const themeValue = isFormMode ? formTheme : globalTheme;

  const [customThemes, setCustomThemes] = useState([]);
  const [customThemesReady, setCustomThemesReady] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [deployTime, setDeployTime] = useState("");
  const [syncAllFormsTheme, setSyncAllFormsTheme] = useState(false);
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
  const selectThemeValue = availableThemeIds.has(themeValue) ? themeValue : DEFAULT_THEME;
  const fallbackPath = isFormMode ? `/search?formId=${encodeURIComponent(requestedFormId)}` : "/";
  const pageTitle = isFormMode
    ? `${targetForm?.settings?.formTitle || requestedFormId} - 設定`
    : "設定";

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

  // 個別フォーム設定では常に対象フォームのテーマを画面へ適用
  useEffect(() => {
    if (!isFormMode || !targetForm) return;
    void applyThemeWithFallback(formTheme, { persist: false });
  }, [isFormMode, targetForm?.id, formTheme]);

  // メイン設定では常にグローバルテーマを画面へ適用
  useEffect(() => {
    if (isFormMode) return;
    void applyThemeWithFallback(globalTheme, { persist: false });
  }, [isFormMode, globalTheme]);

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
  ]);

  // デプロイ時刻を読み取り
  useEffect(() => {
    const metaTag = document.querySelector("meta[name=\"deploy-time\"]");
    if (metaTag) {
      setDeployTime(metaTag.getAttribute("content") || "");
    }
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

  const handleChangeMainTheme = useCallback(async (nextTheme) => {
    updateSetting("theme", nextTheme);
  }, [updateSetting]);

  const handleChangeFormTheme = useCallback(
    async (nextTheme) => {
      if (!targetForm) return;
      await updateForm(targetForm.id, {
        settings: { ...(targetForm.settings || {}), theme: nextTheme },
      });
      await applyThemeWithFallback(nextTheme, { persist: false });
    },
    [targetForm, updateForm],
  );

  const handleThemeChange = async (event) => {
    const nextTheme = event.target.value;

    if (isFormMode) {
      await handleChangeFormTheme(nextTheme);
      return;
    }

    await handleChangeMainTheme(nextTheme);
    if (!syncAllFormsTheme) return;

    setApplyingTheme(true);
    try {
      await applyThemeToAllForms(nextTheme);
    } finally {
      setApplyingTheme(false);
    }
  };

  const handleToggleSyncAllFormsTheme = async (checked) => {
    setSyncAllFormsTheme(checked);
    if (!checked) return;

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

      if (isFormMode) {
        await handleChangeFormTheme(theme.id);
      } else {
        await handleChangeMainTheme(theme.id);
        if (syncAllFormsTheme) {
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
      if (isFormMode && targetForm) {
        await handleChangeFormTheme(DEFAULT_THEME);
      } else {
        await handleChangeMainTheme(DEFAULT_THEME);
        if (syncAllFormsTheme) {
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

  if (isFormMode && !targetForm) {
    return (
      <AppLayout title="設定" fallbackPath={fallbackPath} badge="テーマ">
        <div className="nf-card">
          <p>指定されたフォームが見つかりません。</p>
          <p className="nf-text-muted nf-text-14 nf-mt-8">メイン画面からフォームを選択してやり直してください。</p>
        </div>
        <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
      </AppLayout>
    );
  }

  return (
    <AppLayout title={pageTitle} fallbackPath={fallbackPath} badge="テーマ">
      <div className="nf-card">
        <div className="nf-fw-600 nf-mb-8">テーマ設定</div>
        <div className="nf-mb-12">
          <label className="nf-block nf-fw-600 nf-mb-6">テーマ</label>
          <select
            className="nf-input"
            value={selectThemeValue}
            onChange={handleThemeChange}
            disabled={applyingTheme}
          >
            {themeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="nf-mt-6 nf-text-12 nf-text-muted">
            {isFormMode ? "このフォームにのみ適用されます。" : "フォーム以外の画面に適用されます。"}
          </p>
        </div>

        {!isFormMode && (
          <div className="nf-mb-12">
            <label className="nf-row nf-gap-8 nf-items-center">
              <input
                type="checkbox"
                checked={syncAllFormsTheme}
                onChange={(event) => handleToggleSyncAllFormsTheme(event.target.checked)}
                disabled={applyingTheme}
              />
              <span className="nf-fw-600">フォームテーマも一括変更</span>
            </label>
            <p className="nf-mt-6 nf-text-12 nf-text-muted">
              ON時にテーマを変更すると、その時点の値で全フォームのテーマ設定を一括更新します。画面を開いた直後はOFFです。
            </p>
          </div>
        )}

        <div className="nf-mt-16">
          <div className="nf-settings-group-title nf-mb-8">テーマをインポート</div>
          <p className="nf-mb-12 nf-text-12 nf-text-muted">
            インポートするGoogle Drive内CSSファイルURLを指定してください
          </p>
          <div className="nf-row nf-gap-12">
            <input
              className="nf-input nf-flex-1 nf-min-w-0"
              type="text"
              value={importUrl}
              placeholder="https://drive.google.com/file/d/..."
              onChange={(event) => setImportUrl(event.target.value)}
            />
            <button
              type="button"
              className="nf-btn nf-nowrap"
              onClick={handleImportTheme}
              disabled={importing || applyingTheme}
            >
              {importing ? "インポート中..." : "インポート"}
            </button>
          </div>
          {customThemes.length > 0 && (
            <div className="nf-mt-12">
              <div className="nf-text-12 nf-text-muted">インポート済みテーマ</div>
              <div className="nf-col nf-gap-12 nf-mt-8">
                {customThemes.map((theme) => (
                  <div key={theme.id} className="nf-row nf-gap-12">
                    <div className="nf-flex-1 nf-min-w-0">
                      <div className="nf-fw-600">{theme.name || "カスタムテーマ"}</div>
                    </div>
                    <button
                      type="button"
                      className="nf-btn-outline nf-nowrap"
                      onClick={() => handleRemoveCustomTheme(theme)}
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="nf-mt-16 nf-pt-16" style={{ borderTop: "1px solid var(--nf-color-border)" }}>
          <div className="nf-settings-group-title nf-mb-6">システム情報</div>
          <div className="nf-text-12 nf-text-muted">
            <div>最終デプロイ: {deployTime || "情報なし"}</div>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="インポートテーマを削除しますか？"
        message={
          removeTarget
            ? `削除すると「${removeTarget.name || "カスタムテーマ"}」は一覧から消え、選択中の場合はDefaultに戻ります。`
            : ""
        }
        options={removeOptions}
      />
      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </AppLayout>
  );
}

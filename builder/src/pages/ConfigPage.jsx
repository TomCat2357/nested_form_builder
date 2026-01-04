import React, { useEffect, useMemo, useState } from "react";
import AppLayout from "../app/components/AppLayout.jsx";
import AlertDialog from "../app/components/AlertDialog.jsx";
import { useAlert } from "../app/hooks/useAlert.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import {
  DEFAULT_THEME,
  THEME_OPTIONS,
  getCustomThemes,
  removeCustomTheme,
  setCustomTheme,
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

export default function ConfigPage() {
  const { settings, updateSetting } = useBuilderSettings();
  const { alertState, showAlert, closeAlert } = useAlert();
  const [customThemes, setCustomThemes] = useState(() => getCustomThemes());
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [deployTime, setDeployTime] = useState("");
  const themeValue = settings?.theme || DEFAULT_THEME;
  const themeOptions = useMemo(
    () => [
      ...THEME_OPTIONS,
      ...customThemes.map((theme) => ({ value: theme.id, label: theme.name || "カスタムテーマ" })),
    ],
    [customThemes]
  );

  useEffect(() => {
    const hasSelectedTheme = themeOptions.some((option) => option.value === themeValue);
    if (!hasSelectedTheme && themeValue !== DEFAULT_THEME) {
      updateSetting("theme", DEFAULT_THEME);
    }
  }, [themeOptions, themeValue, updateSetting]);

  // デプロイ時刻を読み取り
  useEffect(() => {
    const metaTag = document.querySelector("meta[name=\"deploy-time\"]");
    if (metaTag) {
      setDeployTime(metaTag.getAttribute("content") || "");
    }
  }, []);

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
      const theme = setCustomTheme({ css, name, url: result?.fileUrl || url });
      if (!theme) {
        throw new Error("テーマファイルが空です");
      }
      const nextThemes = getCustomThemes();
      setCustomThemes(nextThemes);
      setImportUrl(theme.url || "");
      updateSetting("theme", theme.id);
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

  const handleConfirmRemove = () => {
    if (!removeTarget) return;
    const nextThemes = removeCustomTheme(removeTarget.id);
    setCustomThemes(nextThemes);
    if ((settings?.theme || DEFAULT_THEME) === removeTarget.id) {
      updateSetting("theme", DEFAULT_THEME);
    }
    setRemoveTarget(null);
    showAlert("インポートしたテーマを削除しました");
  };

  const removeOptions = [
    { value: "cancel", label: "キャンセル", onSelect: () => setRemoveTarget(null) },
    { value: "remove", label: "削除する", variant: "danger", onSelect: handleConfirmRemove },
  ];

  return (
    <AppLayout title="設定" fallbackPath="/" badge="テーマ">
      <div className="nf-card">
        <div className="nf-fw-600 nf-mb-8">テーマ設定</div>
        <div className="nf-mb-12">
          <label className="nf-block nf-fw-600 nf-mb-6">テーマ</label>
          <select
            className="nf-input"
            value={themeValue}
            onChange={(event) => updateSetting("theme", event.target.value)}
          >
            {themeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="nf-mt-6 nf-text-12 nf-text-muted">アプリ全体の配色が切り替わります。</p>
        </div>

        <div className="nf-mt-16">
          <div className="nf-fw-600 nf-mb-6">テーマをインポート</div>
          <p className="nf-mb-12 nf-text-12 nf-text-muted">
            Google Drive内のテーマCSSファイルURLを指定してください。
          </p>
          <label className="nf-block nf-fw-600 nf-mb-6">Google Drive URL</label>
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
              disabled={importing}
            >
              {importing ? "インポート中..." : "インポート"}
            </button>
          </div>
          <p className="nf-mt-6 nf-text-11 nf-text-muted">
            推奨形式: <span className="nf-text-underline">:root[data-theme="..."]</span> を含むCSS
          </p>
          {customThemes.length > 0 && (
            <div className="nf-mt-12">
              <div className="nf-text-12 nf-text-muted">インポート済みテーマ</div>
              <div className="nf-col nf-gap-12 nf-mt-8">
                {customThemes.map((theme) => (
                  <div key={theme.id} className="nf-row nf-gap-12">
                    <div className="nf-flex-1 nf-min-w-0">
                      <div className="nf-fw-600">{theme.name || "カスタムテーマ"}</div>
                      {theme.url && (
                        <div className="nf-mt-4 nf-text-11 nf-text-muted">
                          <a className="nf-text-underline" href={theme.url} target="_blank" rel="noreferrer">
                            {theme.url}
                          </a>
                        </div>
                      )}
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

        {deployTime && (
          <div className="nf-mt-16 nf-pt-16" style={{ borderTop: "1px solid var(--nf-color-border)" }}>
            <div className="nf-fw-600 nf-mb-6">システム情報</div>
            <div className="nf-text-12 nf-text-muted">
              <div>最終デプロイ: {deployTime}</div>
            </div>
          </div>
        )}
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

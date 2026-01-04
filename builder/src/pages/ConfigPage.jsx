import React, { useState } from "react";
import AppLayout from "../app/components/AppLayout.jsx";
import AlertDialog from "../app/components/AlertDialog.jsx";
import { useAlert } from "../app/hooks/useAlert.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import {
  CUSTOM_THEME_ID,
  DEFAULT_THEME,
  THEME_OPTIONS,
  clearCustomTheme,
  getCustomThemeInfo,
  setCustomTheme,
} from "../app/theme/theme.js";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import { hasScriptRun, importThemeFromDrive } from "../services/gasClient.js";

const readCustomThemeSummary = () => {
  const info = getCustomThemeInfo();
  return {
    name: info.name || "",
    url: info.url || "",
    hasCss: !!info.css,
  };
};

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
  const initialCustomTheme = readCustomThemeSummary();
  const [customThemeInfo, setCustomThemeInfo] = useState(initialCustomTheme);
  const [importUrl, setImportUrl] = useState(initialCustomTheme.url || "");
  const [importing, setImporting] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const themeValue = settings?.theme || DEFAULT_THEME;
  const hasCustomOption = customThemeInfo.hasCss || themeValue === CUSTOM_THEME_ID;
  const customThemeLabel = customThemeInfo.name || "カスタムテーマ";
  const themeOptions = hasCustomOption
    ? [...THEME_OPTIONS, { value: CUSTOM_THEME_ID, label: customThemeLabel }]
    : THEME_OPTIONS;

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
      setCustomTheme({ css, name, url: result?.fileUrl || url });
      const nextInfo = readCustomThemeSummary();
      setCustomThemeInfo(nextInfo);
      setImportUrl(nextInfo.url || url);
      updateSetting("theme", CUSTOM_THEME_ID);
      showAlert("テーマをインポートしました");
    } catch (error) {
      console.error("[ConfigPage] theme import failed", error);
      showAlert(error?.message || "テーマのインポートに失敗しました");
    } finally {
      setImporting(false);
    }
  };

  const handleRemoveCustomTheme = () => {
    if (!customThemeInfo.hasCss) return;
    setConfirmRemoveOpen(true);
  };

  const handleConfirmRemove = () => {
    clearCustomTheme();
    setCustomThemeInfo(readCustomThemeSummary());
    setImportUrl("");
    if ((settings?.theme || DEFAULT_THEME) === CUSTOM_THEME_ID) {
      updateSetting("theme", DEFAULT_THEME);
    }
    setConfirmRemoveOpen(false);
    showAlert("インポートしたテーマを削除しました");
  };

  const removeOptions = [
    { value: "cancel", label: "キャンセル", onSelect: () => setConfirmRemoveOpen(false) },
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
          {customThemeInfo.hasCss && (
            <div className="nf-mt-12">
              <div className="nf-row nf-gap-12">
                <div className="nf-flex-1 nf-min-w-0">
                  <div className="nf-text-12 nf-text-muted">インポート済みテーマ</div>
                  <div className="nf-fw-600">{customThemeInfo.name || "カスタムテーマ"}</div>
                  {customThemeInfo.url && (
                    <div className="nf-mt-4 nf-text-11 nf-text-muted">
                      <a className="nf-text-underline" href={customThemeInfo.url} target="_blank" rel="noreferrer">
                        {customThemeInfo.url}
                      </a>
                    </div>
                  )}
                </div>
                <button type="button" className="nf-btn-outline nf-nowrap" onClick={handleRemoveCustomTheme}>
                  削除
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmRemoveOpen}
        title="インポートテーマを削除しますか？"
        message="削除するとこのテーマは一覧から消え、選択中の場合はDefaultに戻ります。"
        options={removeOptions}
      />
      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </AppLayout>
  );
}

import React from "react";
import AppLayout from "../app/components/AppLayout.jsx";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { DEFAULT_THEME, THEME_OPTIONS } from "../app/theme/theme.js";

export default function ConfigPage() {
  const { settings, updateSetting } = useBuilderSettings();
  const themeValue = settings?.theme || DEFAULT_THEME;

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
            {THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="nf-mt-6 nf-text-12 nf-text-muted">アプリ全体の配色が切り替わります。</p>
        </div>
      </div>
    </AppLayout>
  );
}

import React from "react";
import ConfirmDialog from "../../app/components/ConfirmDialog.jsx";
import { useAlert } from "../../app/hooks/useAlert.js";
import { useApplyTheme } from "../../app/hooks/useApplyTheme.js";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { DEFAULT_THEME } from "../../app/theme/theme.js";
import { useBuilderSettings } from "./settingsStore.js";
import { useConfigPageTheme } from "../../pages/useConfigPageTheme.js";

export default function SettingsGeneralTab() {
  const { settings, updateSetting } = useBuilderSettings({ applyGlobalTheme: false });
  const { forms, updateForm } = useAppData();
  const { showAlert } = useAlert();

  const rawGlobalTheme = settings?.theme;
  const globalTheme = rawGlobalTheme || DEFAULT_THEME;
  const syncAllFormsTheme = settings?.syncAllFormsTheme ?? false;
  const formListSortKey = settings?.formListSortKey || "modifiedAt";
  const formListSortOrder = settings?.formListSortOrder || "desc";

  const {
    customThemes,
    importUrl,
    setImportUrl,
    importing,
    removeTarget,
    applyingTheme,
    themeOptions,
    selectThemeValue,
    handleThemeChange,
    handleToggleSyncAllFormsTheme,
    handleImportTheme,
    handleRemoveCustomTheme,
    removeOptions,
  } = useConfigPageTheme({
    isFormMode: false,
    targetForm: null,
    forms,
    updateForm,
    updateSetting,
    updateCurrentFormSettings: async () => {},
    showAlert,
    rawFormTheme: undefined,
    rawGlobalTheme,
    globalTheme,
    syncAllFormsTheme,
  });

  useApplyTheme(globalTheme, { enabled: true });

  return (
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
          フォーム以外の画面に適用されます。
        </p>
      </div>

      <div className="nf-mb-16">
        <div className="nf-settings-group-title nf-mb-8">フォーム一覧の並び順</div>
        <div className="nf-row nf-gap-16 nf-wrap">
          <div className="nf-row nf-gap-12 nf-wrap">
            <label className="nf-row nf-gap-4 nf-nowrap">
              <input
                type="radio"
                name="form-list-sort-key"
                checked={formListSortKey === "modifiedAt"}
                onChange={() => updateSetting("formListSortKey", "modifiedAt")}
              />
              最終更新
            </label>
            <label className="nf-row nf-gap-4 nf-nowrap">
              <input
                type="radio"
                name="form-list-sort-key"
                checked={formListSortKey === "formTitle"}
                onChange={() => updateSetting("formListSortKey", "formTitle")}
              />
              名称
            </label>
          </div>
          <div className="nf-row nf-gap-12 nf-wrap">
            <label className="nf-row nf-gap-4 nf-nowrap">
              <input
                type="radio"
                name="form-list-sort-order"
                checked={formListSortOrder === "desc"}
                onChange={() => updateSetting("formListSortOrder", "desc")}
              />
              降順
            </label>
            <label className="nf-row nf-gap-4 nf-nowrap">
              <input
                type="radio"
                name="form-list-sort-order"
                checked={formListSortOrder === "asc"}
                onChange={() => updateSetting("formListSortOrder", "asc")}
              />
              昇順
            </label>
          </div>
        </div>
        <p className="nf-mt-6 nf-text-12 nf-text-muted">
          フォーム一覧画面に表示するフォームの並び順を変更できます。
        </p>
      </div>

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
          ONにした瞬間に現在のテーマを全フォームへ反映します。ONのままこの画面でテーマ変更すると、その変更後のテーマを全フォームへ反映します。OFFにしても、すでに反映済みのフォームテーマは戻りません。
        </p>
      </div>

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
            disabled={importing || applyingTheme}
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
                    disabled={importing || applyingTheme}
                  >
                    削除
                  </button>
                </div>
              ))}
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
    </div>
  );
}

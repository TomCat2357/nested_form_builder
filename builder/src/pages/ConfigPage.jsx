import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import { useAlert } from "../app/hooks/useAlert.js";
import { useApplyTheme } from "../app/hooks/useApplyTheme.js";
import { useDeployTime } from "../app/hooks/useDeployTime.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { DEFAULT_THEME } from "../app/theme/theme.js";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import { resolveOmitEmptyRowsOnPrint, resolveShowPrintHeader } from "../features/preview/printDocument.js";
import { resolveCreatePrintOnSave, resolveSettingsFieldValue } from "../utils/settings.js";
import { SettingsField } from "../features/settings/SettingsField.jsx";
import { getConfigPageSaveAfterActionField } from "./configPageSettings.js";
import { useConfigPageTheme } from "./useConfigPageTheme.js";

export default function ConfigPage() {
  const [searchParams] = useSearchParams();
  const requestedFormId = (searchParams.get("form") || "").trim();
  const isFormMode = requestedFormId !== "";

  const { settings, updateSetting } = useBuilderSettings({ applyGlobalTheme: false });
  const { forms, getFormById, updateForm } = useAppData();
  const { showAlert } = useAlert();
  const targetForm = useMemo(
    () => (requestedFormId ? getFormById(requestedFormId) : null),
    [requestedFormId, getFormById],
  );
  const rawFormTheme = targetForm?.settings?.theme;
  const formTheme = rawFormTheme || DEFAULT_THEME;
  const omitEmptyRowsOnPrint = resolveOmitEmptyRowsOnPrint(targetForm?.settings);
  const showPrintHeader = resolveShowPrintHeader(targetForm?.settings);
  const createPrintOnSave = resolveCreatePrintOnSave(targetForm?.settings);
  const rawGlobalTheme = settings?.theme;
  const globalTheme = rawGlobalTheme || DEFAULT_THEME;
  const themeValue = isFormMode ? formTheme : globalTheme;
  const syncAllFormsTheme = settings?.syncAllFormsTheme ?? false;
  const saveAfterActionField = useMemo(() => getConfigPageSaveAfterActionField(), []);

  const deployTime = useDeployTime();
  const [savingPrintSettings, setSavingPrintSettings] = useState(false);
  const [savingRecordSettings, setSavingRecordSettings] = useState(false);
  const [pendingSaveAfterAction, setPendingSaveAfterAction] = useState(null);

  const updateCurrentFormSettings = useCallback(
    async (nextPartialSettings) => {
      if (!targetForm) return;
      await updateForm(targetForm.id, {
        settings: {
          ...(targetForm.settings || {}),
          ...nextPartialSettings,
        },
      });
    },
    [targetForm, updateForm],
  );

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
  });

  const fallbackPath = isFormMode ? `/search?form=${encodeURIComponent(requestedFormId)}` : "/";
  const pageTitle = isFormMode
    ? `${targetForm?.settings?.formTitle || requestedFormId} - 設定`
    : "設定";
  const saveAfterActionValue = resolveSettingsFieldValue(
    saveAfterActionField,
    pendingSaveAfterAction !== null ? pendingSaveAfterAction : targetForm?.settings?.saveAfterAction,
  );

  // 個別フォーム設定では常に対象フォームのテーマを画面へ適用
  useApplyTheme(formTheme, { enabled: isFormMode && !!targetForm });

  // メイン設定では常にグローバルテーマを画面へ適用
  useApplyTheme(globalTheme, { enabled: !isFormMode });

  useEffect(() => {
    if (pendingSaveAfterAction === null) return;
    if (targetForm?.settings?.saveAfterAction === pendingSaveAfterAction) {
      setPendingSaveAfterAction(null);
    }
  }, [pendingSaveAfterAction, targetForm?.settings?.saveAfterAction]);

  const handleTogglePrintSetting = useCallback(
    async (key, checked) => {
      if (!targetForm || savingPrintSettings) return;
      setSavingPrintSettings(true);
      try {
        await updateCurrentFormSettings({ [key]: checked });
      } catch (error) {
        console.error("[ConfigPage] failed to update print settings", error);
        showAlert(error?.message || "印刷設定の保存に失敗しました");
      } finally {
        setSavingPrintSettings(false);
      }
    },
    [savingPrintSettings, showAlert, targetForm, updateCurrentFormSettings],
  );

  const handleSaveAfterActionChange = useCallback(
    async (nextValue) => {
      if (!targetForm || !saveAfterActionField || savingRecordSettings) return;
      setPendingSaveAfterAction(nextValue);
      setSavingRecordSettings(true);
      try {
        await updateCurrentFormSettings({ saveAfterAction: nextValue });
      } catch (error) {
        console.error("[ConfigPage] failed to update saveAfterAction", error);
        setPendingSaveAfterAction(null);
        showAlert(error?.message || "保存後動作の保存に失敗しました");
      } finally {
        setSavingRecordSettings(false);
      }
    },
    [saveAfterActionField, savingRecordSettings, showAlert, targetForm, updateCurrentFormSettings],
  );

  if (isFormMode && !targetForm) {
    return (
      <AppLayout title="設定" fallbackPath={fallbackPath} backHidden={false} badge="テーマ" themeOverride={themeValue}>
        <div className="nf-card">
          <p>指定されたフォームが見つかりません。</p>
          <p className="nf-text-muted nf-text-14 nf-mt-8">メイン画面からフォームを選択してやり直してください。</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={pageTitle} fallbackPath={fallbackPath} backHidden={false} badge="テーマ" themeOverride={themeValue}>
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
              ONにした瞬間に現在のテーマを全フォームへ反映します。ONのままこの画面でテーマ変更すると、その変更後のテーマを全フォームへ反映します。OFFにしても、すでに反映済みのフォームテーマは戻りません。
            </p>
          </div>
        )}

        {isFormMode && (
          <div className="nf-mb-12">
            {saveAfterActionField && (
              <div className="nf-mb-16">
                <div className="nf-settings-group-title nf-mb-8">レコード画面設定</div>
                <label className="nf-block nf-fw-600 nf-mb-6">{saveAfterActionField.label}</label>
                <SettingsField
                  field={saveAfterActionField}
                  value={saveAfterActionValue}
                  onChange={(_key, val) => { void handleSaveAfterActionChange(val); }}
                  disabled={savingRecordSettings}
                />
                {saveAfterActionField.description && (
                  <p className="nf-mt-6 nf-text-12 nf-text-muted">{saveAfterActionField.description}</p>
                )}
              </div>
            )}
            <div className="nf-settings-group-title nf-mb-8">印刷設定</div>
            <label className="nf-row nf-gap-8 nf-items-center">
              <input
                type="checkbox"
                checked={showPrintHeader}
                onChange={(event) => {
                  void handleTogglePrintSetting("showPrintHeader", event.target.checked);
                }}
                disabled={savingPrintSettings}
              />
              <span className="nf-fw-600">印刷様式のヘッダーを表示する</span>
            </label>
            <p className="nf-mt-6 nf-text-12 nf-text-muted nf-mb-12">
              OFFにすると、印刷様式先頭のフォーム名・出力日時・レコードNo・IDを非表示にします。
            </p>
            <label className="nf-row nf-gap-8 nf-items-center">
              <input
                type="checkbox"
                checked={omitEmptyRowsOnPrint}
                onChange={(event) => {
                  void handleTogglePrintSetting("omitEmptyRowsOnPrint", event.target.checked);
                }}
                disabled={savingPrintSettings}
              />
              <span className="nf-fw-600">印刷様式出力時に空欄項目を省く</span>
            </label>
            <p className="nf-mt-6 nf-text-12 nf-text-muted">
              OFFにすると、未回答の項目も印刷様式へ出力します。
            </p>
            <label className="nf-row nf-gap-8 nf-items-center nf-mt-12">
              <input
                type="checkbox"
                checked={createPrintOnSave}
                onChange={(event) => {
                  void handleTogglePrintSetting("createPrintOnSave", event.target.checked);
                }}
                disabled={savingPrintSettings}
              />
              <span className="nf-fw-600">保存時に印刷様式を出力する（同名ファイルは上書き）</span>
            </label>
            <p className="nf-mt-6 nf-text-12 nf-text-muted">
              通常の保存ボタンを押した時だけ印刷様式を自動出力します。自動保存では出力しません。
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

        <div className="nf-section-divider">
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
    </AppLayout>
  );
}

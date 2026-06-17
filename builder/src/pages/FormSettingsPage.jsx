import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import { useAlert } from "../app/hooks/useAlert.js";
import { useApplyTheme } from "../app/hooks/useApplyTheme.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { DEFAULT_THEME } from "../app/theme/theme.js";
import { resolveSettingsFieldValue } from "../utils/settings.js";
import { SettingsField } from "../features/settings/SettingsField.jsx";
import { getConfigPageSaveAfterActionField, getConfigPageSearchQueryTableSourceField } from "./configPageSettings.js";
import { useConfigPageTheme } from "./useConfigPageTheme.js";
import { isFormUploadInFlight } from "../features/search/globalSyncState.js";

export default function FormSettingsPage() {
  const { formId } = useParams();
  const requestedFormId = (formId || "").trim();

  const { settings, updateSetting } = useBuilderSettings({ applyGlobalTheme: false });
  const { forms, getFormById, updateForm, loadingForms, refreshingForms } = useAppData();
  const { showAlert } = useAlert();
  const targetForm = useMemo(
    () => (requestedFormId ? getFormById(requestedFormId) : null),
    [requestedFormId, getFormById],
  );
  const rawFormTheme = targetForm?.settings?.theme;
  const formTheme = rawFormTheme || DEFAULT_THEME;
  const rawGlobalTheme = settings?.theme;
  const globalTheme = rawGlobalTheme || DEFAULT_THEME;
  const syncAllFormsTheme = settings?.syncAllFormsTheme ?? false;
  const saveAfterActionField = useMemo(() => getConfigPageSaveAfterActionField(), []);
  const searchQueryTableSourceField = useMemo(() => getConfigPageSearchQueryTableSourceField(), []);

  const [savingRecordSettings, setSavingRecordSettings] = useState(false);
  const [pendingSaveAfterAction, setPendingSaveAfterAction] = useState(null);
  const [savingSearchSettings, setSavingSearchSettings] = useState(false);
  const [pendingSearchQueryTableSource, setPendingSearchQueryTableSource] = useState(null);

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
    applyingTheme,
    themeOptions,
    selectThemeValue,
    handleThemeChange,
  } = useConfigPageTheme({
    isFormMode: true,
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

  const fallbackPath = `/search?form=${encodeURIComponent(requestedFormId)}`;
  const pageTitle = `${targetForm?.settings?.formTitle || requestedFormId} - 設定`;
  const saveAfterActionValue = resolveSettingsFieldValue(
    saveAfterActionField,
    pendingSaveAfterAction !== null ? pendingSaveAfterAction : targetForm?.settings?.saveAfterAction,
  );
  const searchQueryTableSourceValue = resolveSettingsFieldValue(
    searchQueryTableSourceField,
    pendingSearchQueryTableSource !== null ? pendingSearchQueryTableSource : targetForm?.settings?.searchQueryTableSource,
  );

  useApplyTheme(formTheme, { enabled: !!targetForm });

  useEffect(() => {
    if (pendingSaveAfterAction === null) return;
    if (targetForm?.settings?.saveAfterAction === pendingSaveAfterAction) {
      setPendingSaveAfterAction(null);
    }
  }, [pendingSaveAfterAction, targetForm?.settings?.saveAfterAction]);

  useEffect(() => {
    if (pendingSearchQueryTableSource === null) return;
    if ((targetForm?.settings?.searchQueryTableSource ?? "data") === pendingSearchQueryTableSource) {
      setPendingSearchQueryTableSource(null);
    }
  }, [pendingSearchQueryTableSource, targetForm?.settings?.searchQueryTableSource]);

  const handleSaveAfterActionChange = useCallback(
    async (nextValue) => {
      if (!targetForm || !saveAfterActionField || savingRecordSettings) return;
      setPendingSaveAfterAction(nextValue);
      setSavingRecordSettings(true);
      try {
        await updateCurrentFormSettings({ saveAfterAction: nextValue });
      } catch (error) {
        console.error("[FormSettingsPage] failed to update saveAfterAction", error);
        setPendingSaveAfterAction(null);
        showAlert(error?.message || "保存後動作の保存に失敗しました");
      } finally {
        setSavingRecordSettings(false);
      }
    },
    [saveAfterActionField, savingRecordSettings, showAlert, targetForm, updateCurrentFormSettings],
  );

  const handleSearchQueryTableSourceChange = useCallback(
    async (nextValue) => {
      if (!targetForm || !searchQueryTableSourceField || savingSearchSettings) return;
      setPendingSearchQueryTableSource(nextValue);
      setSavingSearchSettings(true);
      try {
        await updateCurrentFormSettings({ searchQueryTableSource: nextValue });
      } catch (error) {
        console.error("[FormSettingsPage] failed to update searchQueryTableSource", error);
        setPendingSearchQueryTableSource(null);
        showAlert(error?.message || "検索クエリ参照先の保存に失敗しました");
      } finally {
        setSavingSearchSettings(false);
      }
    },
    [searchQueryTableSourceField, savingSearchSettings, showAlert, targetForm, updateCurrentFormSettings],
  );

  if (!targetForm) {
    // フォームの読み込み中、または自分のオフライン保存（write-behind）が反映途中だと、
    // フォームが一時的に一覧から外れて getFormById が null を返すことがある。これを即「見つかりません」
    // と断じると、テーマ変更直後などに誤った不在表示が出る。同期完了で forms が更新され再描画されると
    // targetForm が戻るため、その間は「同期中…」の穏当な表示に留める。
    const isTransientlyAbsent = loadingForms || refreshingForms || isFormUploadInFlight();
    return (
      <AppLayout title="設定" fallbackPath={fallbackPath} backHidden={false} badge="テーマ" themeOverride={formTheme}>
        <div className="nf-card">
          {isTransientlyAbsent ? (
            <p>フォームを同期中です…</p>
          ) : (
            <>
              <p>指定されたフォームが見つかりません。</p>
              <p className="nf-text-muted nf-text-14 nf-mt-8">メイン画面からフォームを選択してやり直してください。</p>
            </>
          )}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={pageTitle} fallbackPath={fallbackPath} backHidden={false} badge="テーマ" themeOverride={formTheme}>
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
            このフォームにのみ適用されます。
          </p>
        </div>

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

        {searchQueryTableSourceField && (
          <div className="nf-mb-16">
            <div className="nf-settings-group-title nf-mb-8">検索画面設定</div>
            <label className="nf-block nf-fw-600 nf-mb-6">{searchQueryTableSourceField.label}</label>
            <SettingsField
              field={searchQueryTableSourceField}
              value={searchQueryTableSourceValue}
              onChange={(_key, val) => { void handleSearchQueryTableSourceChange(val); }}
              disabled={savingSearchSettings}
            />
            {searchQueryTableSourceField.description && (
              <p className="nf-mt-6 nf-text-12 nf-text-muted">{searchQueryTableSourceField.description}</p>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

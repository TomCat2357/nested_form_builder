import React, { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useAuth } from "../app/state/authContext.jsx";
import { DEFAULT_THEME, applyThemeWithFallback } from "../app/theme/theme.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { formatUnixMsDateTime, toUnixMs } from "../utils/dateTime.js";

export default function MainPage() {
  const { forms, loadingForms } = useAppData();
  const { isAdmin, propertyStoreMode, adminSettingsEnabled } = useAuth();
  const { settings } = useBuilderSettings();
  const navigate = useNavigate();

  const activeForms = useMemo(() => forms.filter((form) => !form.archived), [forms]);

  
  const handleSelect = (formId) => {
    navigate(`/search?form=${formId}`, {
      state: { fromMainPage: true }
    });
  };

  const handleGoForms = () => {
    navigate("/forms");
  };

  const handleGoConfig = () => {
    navigate("/config");
  };

  const handleGoAdminSettings = () => {
    navigate("/admin-settings");
  };

  const showAdminSettingsButton = isAdmin && adminSettingsEnabled;
  const showFormsButton = propertyStoreMode === "user" || isAdmin;

  return (
    <AppLayout
      title="フォーム一覧"
      backHidden
      sidebarActions={
        <>
          <button type="button" onClick={handleGoConfig} className="nf-btn-outline nf-btn-sidebar">
            設定
          </button>
          {showAdminSettingsButton && (
            <button type="button" onClick={handleGoAdminSettings} className="nf-btn-outline nf-btn-sidebar">
              管理者設定
            </button>
          )}
          {showFormsButton && (
            <button type="button" onClick={handleGoForms} className="nf-btn-outline nf-btn-sidebar">
              フォーム管理
            </button>
          )}
        </>
      }
    >
      {loadingForms ? (
        <p className="nf-text-subtle">読み込み中...</p>
      ) : activeForms.length === 0 ? (
        <p className="nf-text-subtle">登録済みのフォームがありません。フォーム管理から作成してください。</p>
      ) : (
        <div className="main-list">
          {activeForms.map((form) => (
            <div key={form.id} className="main-card" onClick={() => handleSelect(form.id)}>
              <h2 className="main-title">{form.settings?.formTitle || "(無題)"}</h2>
              {form.description && <p className="nf-m-0 nf-text-muted">{form.description}</p>}
              <div className="main-meta">
                最終更新: {formatUnixMsDateTime(form.modifiedAtUnixMs ?? toUnixMs(form.modifiedAt))}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}

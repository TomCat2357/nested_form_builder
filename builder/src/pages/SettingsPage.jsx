import React, { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import { useAuth } from "../app/state/authContext.jsx";
import { useDeployTime } from "../app/hooks/useDeployTime.js";
import SettingsGeneralTab from "../features/settings/SettingsGeneralTab.jsx";
import SettingsAdminTab from "../features/settings/SettingsAdminTab.jsx";

export default function SettingsPage() {
  const { isAdmin, adminSettingsEnabled } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const deployTime = useDeployTime();

  const showAdminTab = isAdmin && adminSettingsEnabled;
  const requestedTab = (searchParams.get("tab") || "").trim();
  const activeTab = useMemo(() => {
    if (requestedTab === "admin" && showAdminTab) return "admin";
    return "general";
  }, [requestedTab, showAdminTab]);

  const setActiveTab = (next) => {
    const params = new URLSearchParams(searchParams);
    if (next === "general") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <AppLayout title="設定" fallbackPath="/" backHidden={false}>
      {showAdminTab && (
        <div className="settings-tabs nf-row nf-gap-8 nf-mb-16">
          <button
            type="button"
            onClick={() => setActiveTab("general")}
            className={activeTab === "general" ? "nf-btn" : "nf-btn-outline"}
          >
            一般
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("admin")}
            className={activeTab === "admin" ? "nf-btn" : "nf-btn-outline"}
          >
            管理者
          </button>
        </div>
      )}

      {activeTab === "general" && <SettingsGeneralTab />}
      {activeTab === "admin" && showAdminTab && <SettingsAdminTab />}

      <div className="nf-card nf-mt-16">
        <div className="nf-settings-group-title nf-mb-6">システム情報</div>
        <div className="nf-text-12 nf-text-muted">
          <div>最終デプロイ: {deployTime || "情報なし"}</div>
        </div>
      </div>
    </AppLayout>
  );
}

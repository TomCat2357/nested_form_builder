import React from "react";
import AppLayout from "../app/components/AppLayout.jsx";
import { useDeployTime } from "../app/hooks/useDeployTime.js";
import SettingsGeneralTab from "../features/settings/SettingsGeneralTab.jsx";

export default function SettingsPage() {
  const { frontendDeployTime, backendDeployTime } = useDeployTime();

  return (
    <AppLayout title="設定" fallbackPath="/" backHidden={false}>
      <SettingsGeneralTab />

      <div className="nf-card nf-mt-16">
        <div className="nf-settings-group-title nf-mb-6">システム情報</div>
        <div className="nf-text-12 nf-text-muted">
          <div>フロントエンド（index.html）デプロイ: {frontendDeployTime || "情報なし"}</div>
          <div>バックエンド（Bundle.gs）デプロイ: {backendDeployTime || "情報なし"}</div>
        </div>
      </div>
    </AppLayout>
  );
}

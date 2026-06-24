import React from "react";
import { Navigate } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import { useAuth } from "../../app/state/authContext.jsx";
import SettingsAdminTab from "../../features/settings/SettingsAdminTab.jsx";

export default function AdminSettingsPage() {
  const { adminSettingsEnabled } = useAuth();
  if (!adminSettingsEnabled) {
    return <Navigate to="/admin" replace />;
  }
  return (
    <AppLayout title="管理者用設定" fallbackPath="/admin" backHidden={false}>
      <SettingsAdminTab />
    </AppLayout>
  );
}

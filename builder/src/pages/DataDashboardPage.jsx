import React from "react";
import AppLayout from "../app/components/AppLayout.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import DashboardLayout from "../features/dashboard/DashboardLayout.jsx";

export default function DataDashboardPage() {
  const { forms, loadingForms } = useAppData();

  return (
    <AppLayout
      title="集計ダッシュボード"
      badge="ダッシュボード"
      fallbackPath="/forms"
    >
      {loadingForms ? (
        <p className="nf-text-subtle">読み込み中...</p>
      ) : (
        <DashboardLayout forms={forms} />
      )}
    </AppLayout>
  );
}

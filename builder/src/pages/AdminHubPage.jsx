import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useAuth } from "../app/state/authContext.jsx";
import { useCancellable } from "../app/hooks/useCancellable.js";
import { listDashboards, listQuestions } from "../features/analytics/analyticsStore.js";

export default function AdminHubPage() {
  const navigate = useNavigate();
  const { forms } = useAppData();
  const { adminSettingsEnabled } = useAuth();
  const [dashboardsCount, setDashboardsCount] = useState(null);
  const [questionsCount, setQuestionsCount] = useState(null);

  useCancellable(async (isCancelled) => {
    try {
      const [dashboards, questions] = await Promise.all([listDashboards(), listQuestions()]);
      if (isCancelled()) return;
      setDashboardsCount(dashboards.length);
      setQuestionsCount(questions.length);
    } catch (err) {
      console.error("[AdminHubPage] failed to load counts", err);
    }
  }, []);

  const formsCount = (forms || []).filter((form) => !form.archived && !form.childOnly).length;
  const totalForms = (forms || []).length;

  return (
    <AppLayout title="管理" fallbackPath="/" backHidden={false}>
      <div className="admin-hub-grid">
        <div className="main-card admin-hub-card" onClick={() => navigate("/admin/forms")}>
          <h2 className="main-title">フォーム管理</h2>
          <p className="nf-m-0 nf-text-muted">
            登録: {totalForms} 件 / 公開中: {formsCount} 件
          </p>
          <div className="main-meta nf-mt-8">→ 開く</div>
        </div>

        <div className="main-card admin-hub-card" onClick={() => navigate("/admin/dashboards")}>
          <h2 className="main-title">ダッシュボード管理</h2>
          <p className="nf-m-0 nf-text-muted">
            登録: {dashboardsCount === null ? "..." : `${dashboardsCount} 件`}
          </p>
          <div className="main-meta nf-mt-8">→ 開く</div>
        </div>

        <div className="main-card admin-hub-card" onClick={() => navigate("/admin/questions")}>
          <h2 className="main-title">Question 管理</h2>
          <p className="nf-m-0 nf-text-muted">
            登録: {questionsCount === null ? "..." : `${questionsCount} 件`}
          </p>
          <div className="main-meta nf-mt-8">→ 開く</div>
        </div>

        <div className="main-card admin-hub-card" onClick={() => navigate("/admin/playground")}>
          <h2 className="main-title">Playground</h2>
          <p className="nf-m-0 nf-text-muted">クエリ / 置換 / 外部アクション を実データで試す</p>
          <div className="main-meta nf-mt-8">→ 開く</div>
        </div>

        {adminSettingsEnabled && (
          <div className="main-card admin-hub-card" onClick={() => navigate("/admin/settings")}>
            <h2 className="main-title">管理者用設定</h2>
            <p className="nf-m-0 nf-text-muted">運用キー・管理者メール・標準フォルダ等の管理者向け設定</p>
            <div className="main-meta nf-mt-8">→ 開く</div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import { useAuth } from "../app/state/authContext.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { listDashboardsSWR, listQuestionsSWR } from "../features/analytics/analyticsStore.js";
import HomeForms from "../features/home/HomeForms.jsx";
import HomeDashboards from "../features/home/HomeDashboards.jsx";

export default function HomePage() {
  const { isAdmin, propertyStoreMode } = useAuth();
  const { refreshForms } = useAppData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [refreshingAll, setRefreshingAll] = useState(false);

  // フォーム・ダッシュボード・クエスチョンの3カタログをまとめて再取得する（各管理画面の更新と同じ軽さ）。
  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      await Promise.all([
        refreshForms({ reason: "manual:home", background: false }),
        listDashboardsSWR({ forceRefresh: true }),
        listQuestionsSWR({ forceRefresh: true }),
      ]);
    } finally {
      setRefreshingAll(false);
    }
  };

  const requestedView = (searchParams.get("view") || "").trim();
  const activeView = useMemo(() => {
    return requestedView === "dashboards" ? "dashboards" : "forms";
  }, [requestedView]);

  // タブ再クリックで子一覧をルートへ戻すためのシグナル（インクリメントで通知）
  const [resetNonce, setResetNonce] = useState(0);

  const setActiveView = (next) => {
    const params = new URLSearchParams(searchParams);
    if (next === "forms") {
      params.delete("view");
    } else {
      params.set("view", next);
    }
    // タブ切替時はフォルダ位置を引き継がない（forms/dashboards でフォルダ体系が異なるため）。
    params.delete("folder");
    setSearchParams(params, { replace: true });
  };

  const handleTabClick = (next) => {
    if (next === activeView) {
      // 既にアクティブなタブの再クリック → その一覧をルート（すべて）に戻し検索も空にする。
      // 別タブへの切替は条件レンダリングで子が再マウントされ自然にリセットされる。
      setResetNonce((n) => n + 1);
    } else {
      setActiveView(next);
    }
  };

  const showAdminButton = (propertyStoreMode === "user") || isAdmin;

  return (
    <AppLayout
      title="ホーム"
      backHidden
      sidebarActions={
        <>
          <button
            type="button"
            onClick={() => handleTabClick("forms")}
            className={activeView === "forms" ? "nf-btn nf-btn-sidebar" : "nf-btn-outline nf-btn-sidebar"}
          >
            フォーム一覧
          </button>
          <button
            type="button"
            onClick={() => handleTabClick("dashboards")}
            className={activeView === "dashboards" ? "nf-btn nf-btn-sidebar" : "nf-btn-outline nf-btn-sidebar"}
          >
            ダッシュボード一覧
          </button>
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={refreshingAll}
            className="nf-btn-outline nf-btn-sidebar"
          >
            {refreshingAll ? "🔄 更新中..." : "🔄 更新"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="nf-btn-outline nf-btn-sidebar"
          >
            設定
          </button>
          {showAdminButton && (
            <button
              type="button"
              onClick={() => navigate("/admin")}
              className="nf-btn-outline nf-btn-sidebar"
            >
              管理者メニュー
            </button>
          )}
        </>
      }
    >
      <h2 className="main-title nf-mb-16">
        {activeView === "forms" ? "フォーム一覧" : "ダッシュボード一覧"}
      </h2>

      {activeView === "forms" && <HomeForms resetNonce={resetNonce} />}
      {activeView === "dashboards" && <HomeDashboards resetNonce={resetNonce} />}
    </AppLayout>
  );
}

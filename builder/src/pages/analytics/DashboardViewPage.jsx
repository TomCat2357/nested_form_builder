import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import { useAuth } from "../../app/state/authContext.jsx";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { analyticsGasClient } from "../../features/analytics/analyticsGasClient.js";
import { executeQuestion } from "../../features/analytics/analyticsStore.js";
import ChartRenderer from "../../features/analytics/components/ChartRenderer.jsx";

function DashboardCard({ questionId, title, forms }) {
  const [question, setQuestion] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    analyticsGasClient.getQuestion(questionId)
      .then(async (res) => {
        if (cancelled) return;
        const q = res.question;
        setQuestion(q);
        const r = await executeQuestion(q, { forms });
        if (!cancelled) setResult(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [questionId]);

  return (
    <div className="nf-card" style={{ breakInside: "avoid" }}>
      <h3 style={{ marginBottom: "12px", fontSize: "14px", fontWeight: "600" }}>
        {title || question?.name || "Question"}
      </h3>
      {loading && <p className="nf-text-subtle">読み込み中...</p>}
      {error && <p className="nf-text-warning">{error}</p>}
      {result && (
        result.ok
          ? <ChartRenderer viz={question?.visualization} rows={result.rows} columns={result.columns} />
          : <p className="nf-text-warning">{result.error}</p>
      )}
    </div>
  );
}

export default function DashboardViewPage() {
  const navigate = useNavigate();
  const { dashboardId } = useParams();
  const { isAdmin } = useAuth();
  const { forms } = useAppData();

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    analyticsGasClient.getDashboard(dashboardId)
      .then((res) => {
        if (!cancelled) setDashboard(res.dashboard);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [dashboardId]);

  return (
    <AppLayout
      title={dashboard?.name || "ダッシュボード"}
      fallbackPath="/analytics"
      sidebarActions={
        isAdmin && (
          <button
            type="button"
            onClick={() => navigate(`/analytics/dashboards/${dashboardId}/edit`)}
            className="nf-btn-outline nf-btn-sidebar"
          >
            編集
          </button>
        )
      }
    >
      {loading && <p className="nf-text-subtle">読み込み中...</p>}
      {error && <p className="nf-text-warning">{error}</p>}
      {dashboard && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: "16px" }}>
          {(dashboard.cards || []).length === 0 && (
            <p className="nf-text-subtle">カードがありません。</p>
          )}
          {(dashboard.cards || []).map((card) => (
            <DashboardCard key={card.id} questionId={card.questionId} title={card.title} forms={forms} />
          ))}
        </div>
      )}
    </AppLayout>
  );
}

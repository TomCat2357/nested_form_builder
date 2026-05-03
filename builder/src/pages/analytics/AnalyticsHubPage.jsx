import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import { useAuth } from "../../app/state/authContext.jsx";
import { listQuestions, listDashboards, deleteQuestion, deleteDashboard } from "../../features/analytics/analyticsStore.js";

export default function AnalyticsHubPage() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const [tab, setTab] = useState("dashboards");
  const [questions, setQuestions] = useState([]);
  const [dashboards, setDashboards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([listQuestions(), listDashboards()])
      .then(([q, d]) => {
        if (!cancelled) {
          setQuestions(q);
          setDashboards(d);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleDeleteQuestion = async (id) => {
    if (!window.confirm("この Question を削除しますか？")) return;
    try {
      await deleteQuestion(id);
      setQuestions((prev) => prev.filter((q) => q.id !== id));
    } catch (err) {
      alert("削除に失敗しました: " + (err.message || String(err)));
    }
  };

  const handleDeleteDashboard = async (id) => {
    if (!window.confirm("このダッシュボードを削除しますか？")) return;
    try {
      await deleteDashboard(id);
      setDashboards((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      alert("削除に失敗しました: " + (err.message || String(err)));
    }
  };

  return (
    <AppLayout
      title="ダッシュボード"
      fallbackPath="/"
      sidebarActions={
        isAdmin && (
          <>
            <button
              type="button"
              onClick={() => navigate("/analytics/questions/new")}
              className="nf-btn-outline nf-btn-sidebar"
            >
              Question 作成
            </button>
            <button
              type="button"
              onClick={() => navigate("/analytics/dashboards/new")}
              className="nf-btn-outline nf-btn-sidebar"
            >
              Dashboard 作成
            </button>
          </>
        )
      }
    >
      <div style={{ display: "flex", gap: "16px", marginBottom: "16px" }}>
        <button
          type="button"
          onClick={() => setTab("dashboards")}
          className={tab === "dashboards" ? "nf-btn" : "nf-btn-outline"}
        >
          ダッシュボード
        </button>
        <button
          type="button"
          onClick={() => setTab("questions")}
          className={tab === "questions" ? "nf-btn" : "nf-btn-outline"}
        >
          Question
        </button>
      </div>

      {error && <p className="nf-text-warning">{error}</p>}
      {loading && <p className="nf-text-subtle">読み込み中...</p>}

      {!loading && tab === "dashboards" && (
        <div>
          {dashboards.length === 0 ? (
            <p className="nf-text-subtle">
              ダッシュボードがありません。
              {isAdmin && "「Dashboard 作成」から追加してください。"}
            </p>
          ) : (
            <div className="main-list">
              {dashboards.map((d) => (
                <div
                  key={d.id}
                  className="main-card"
                  onClick={() => navigate(`/analytics/dashboards/${d.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h2 className="main-title">{d.name || "(無題)"}</h2>
                    {isAdmin && (
                      <div style={{ display: "flex", gap: "8px" }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="nf-btn-outline"
                          style={{ fontSize: "12px", padding: "3px 8px" }}
                          onClick={() => navigate(`/analytics/dashboards/${d.id}/edit`)}
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          className="nf-btn-outline nf-btn-danger"
                          style={{ fontSize: "12px", padding: "3px 8px" }}
                          onClick={() => handleDeleteDashboard(d.id)}
                        >
                          削除
                        </button>
                      </div>
                    )}
                  </div>
                  {d.description && <p className="nf-text-subtle" style={{ marginTop: "4px" }}>{d.description}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && tab === "questions" && (
        <div>
          {questions.length === 0 ? (
            <p className="nf-text-subtle">
              Question がありません。
              {isAdmin && "「Question 作成」から追加してください。"}
            </p>
          ) : (
            <div className="main-list">
              {questions.map((q) => (
                <div
                  key={q.id}
                  className="main-card"
                  onClick={() => navigate(`/analytics/questions/${q.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h2 className="main-title">{q.name || "(無題)"}</h2>
                    {isAdmin && (
                      <div style={{ display: "flex", gap: "8px" }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="nf-btn-outline"
                          style={{ fontSize: "12px", padding: "3px 8px" }}
                          onClick={() => navigate(`/analytics/questions/${q.id}`)}
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          className="nf-btn-outline nf-btn-danger"
                          style={{ fontSize: "12px", padding: "3px 8px" }}
                          onClick={() => handleDeleteQuestion(q.id)}
                        >
                          削除
                        </button>
                      </div>
                    )}
                  </div>
                  {q.description && <p className="nf-text-subtle" style={{ marginTop: "4px" }}>{q.description}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </AppLayout>
  );
}

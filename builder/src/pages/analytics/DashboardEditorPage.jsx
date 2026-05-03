import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import { useAuth } from "../../app/state/authContext.jsx";
import { listQuestions, saveDashboard } from "../../features/analytics/analyticsStore.js";
import { analyticsGasClient } from "../../features/analytics/analyticsGasClient.js";
import { generateDashboardId, generateCardId } from "../../features/analytics/utils/generateId.js";

export default function DashboardEditorPage() {
  const navigate = useNavigate();
  const { dashboardId } = useParams();
  const { isAdmin } = useAuth();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cards, setCards] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(!!dashboardId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!isAdmin) {
    navigate("/analytics", { replace: true });
    return null;
  }

  useEffect(() => {
    listQuestions().then(setQuestions).catch(() => {});
  }, []);

  useEffect(() => {
    if (!dashboardId) return;
    setLoading(true);
    analyticsGasClient.getDashboard(dashboardId)
      .then((res) => {
        const d = res.dashboard;
        setName(d.name || "");
        setDescription(d.description || "");
        setCards(d.cards || []);
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoading(false));
  }, [dashboardId]);

  const handleAddCard = () => {
    setCards((prev) => [...prev, { id: generateCardId(), questionId: "", title: "" }]);
  };

  const handleRemoveCard = (cardId) => {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
  };

  const handleCardChange = (cardId, field, value) => {
    setCards((prev) => prev.map((c) => c.id === cardId ? { ...c, [field]: value } : c));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("ダッシュボード名を入力してください。");
      return;
    }
    setSaving(true);
    setError(null);

    const dashboard = {
      id: dashboardId || generateDashboardId(),
      name: name.trim(),
      description: description.trim(),
      schemaVersion: 1,
      cards,
      modifiedAt: Date.now(),
    };

    try {
      await saveDashboard(dashboard);
      navigate("/analytics");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout
      title={dashboardId ? "Dashboard 編集" : "Dashboard 作成"}
      fallbackPath="/analytics"
      sidebarActions={
        <>
          <button type="button" onClick={handleSave} disabled={saving} className="nf-btn-outline nf-btn-sidebar">
            {saving ? "保存中..." : "保存"}
          </button>
          <button type="button" onClick={() => navigate("/analytics")} className="nf-btn-outline nf-btn-sidebar">
            キャンセル
          </button>
        </>
      }
    >
      {loading && <p className="nf-text-subtle">読み込み中...</p>}
      {error && <p className="nf-text-warning">{error}</p>}

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label className="nf-label">ダッシュボード名</label>
            <input
              className="nf-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 月次レポート"
              style={{ width: "100%", maxWidth: "400px" }}
            />
          </div>
          <div>
            <label className="nf-label">説明（任意）</label>
            <input
              className="nf-input"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ width: "100%", maxWidth: "400px" }}
            />
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <label className="nf-label" style={{ marginBottom: 0 }}>カード</label>
              <button type="button" onClick={handleAddCard} className="nf-btn-outline" style={{ fontSize: "12px" }}>
                + カード追加
              </button>
            </div>

            {cards.length === 0 && (
              <p className="nf-text-subtle">カードがありません。「+ カード追加」から Question を追加してください。</p>
            )}

            {cards.map((card, i) => (
              <div key={card.id} className="nf-card" style={{ marginBottom: "10px", display: "flex", gap: "12px", alignItems: "flex-start" }}>
                <div style={{ flex: 1, display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                  <span className="nf-text-subtle" style={{ fontSize: "12px" }}>#{i + 1}</span>
                  <div>
                    <span style={{ fontSize: "12px", marginRight: "4px" }}>Question</span>
                    <select
                      className="nf-input"
                      value={card.questionId}
                      onChange={(e) => handleCardChange(card.id, "questionId", e.target.value)}
                      style={{ fontSize: "13px" }}
                    >
                      <option value="">選択...</option>
                      {questions.map((q) => (
                        <option key={q.id} value={q.id}>{q.name || q.id}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span style={{ fontSize: "12px", marginRight: "4px" }}>カスタムタイトル</span>
                    <input
                      className="nf-input"
                      type="text"
                      value={card.title}
                      onChange={(e) => handleCardChange(card.id, "title", e.target.value)}
                      placeholder="省略可"
                      style={{ width: "160px", fontSize: "13px" }}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="nf-btn-outline nf-btn-danger"
                  style={{ fontSize: "12px", padding: "3px 8px", flexShrink: 0 }}
                  onClick={() => handleRemoveCard(card.id)}
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </AppLayout>
  );
}

import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";

const listStyle = {
  display: "grid",
  gap: 16,
};

const cardStyle = {
  background: "#fff",
  borderRadius: 12,
  border: "1px solid #E2E8F0",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  cursor: "pointer",
};

const titleStyle = { fontSize: 16, fontWeight: 600, margin: 0 };
const metaStyle = { fontSize: 12, color: "#6B7280" };

export default function MainPage() {
  const { forms, loadingForms } = useAppData();
  const navigate = useNavigate();

  const activeForms = useMemo(() => forms.filter((form) => !form.archived), [forms]);

  const handleSelect = (formId) => {
    navigate(`/search?formId=${formId}`, {
      state: { fromMainPage: true }
    });
  };

  const handleGoAdmin = () => {
    navigate("/admin");
  };

  const sidebarButtonStyle = {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #CBD5E1",
    background: "#fff",
    cursor: "pointer",
    width: "100%",
    textAlign: "left",
  };

  return (
    <AppLayout
      title="フォーム一覧"
      backHidden
      sidebarActions={
        <button type="button" onClick={handleGoAdmin} style={sidebarButtonStyle}>
          管理画面へ
        </button>
      }
    >
      {loadingForms ? (
        <p style={{ color: "#6B7280" }}>読み込み中...</p>
      ) : activeForms.length === 0 ? (
        <p style={{ color: "#6B7280" }}>登録済みのフォームがありません。管理画面から作成してください。</p>
      ) : (
        <div style={listStyle}>
          {activeForms.map((form) => (
            <div key={form.id} style={cardStyle} onClick={() => handleSelect(form.id)}>
              <h2 style={titleStyle}>{form.name}</h2>
              {form.description && <p style={{ margin: 0, color: "#475569" }}>{form.description}</p>}
              <div style={metaStyle}>最終更新: {new Date(form.modifiedAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}

import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { theme } from "../app/theme/tokens.js";
import { formatUnixMsDateTime, toUnixMs } from "../utils/dateTime.js";

const listStyle = {
  display: "grid",
  gap: 16,
};

const cardStyle = {
  background: theme.surface,
  borderRadius: theme.radiusMd,
  border: `1px solid ${theme.borderMuted}`,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  cursor: "pointer",
};

const titleStyle = { fontSize: 16, fontWeight: 600, margin: 0 };
const metaStyle = { fontSize: 12, color: theme.textSubtle };

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
    borderRadius: theme.radiusSm,
    border: `1px solid ${theme.borderStrong}`,
    background: theme.surface,
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
        <p style={{ color: theme.textSubtle }}>読み込み中...</p>
      ) : activeForms.length === 0 ? (
        <p style={{ color: theme.textSubtle }}>登録済みのフォームがありません。管理画面から作成してください。</p>
      ) : (
        <div style={listStyle}>
          {activeForms.map((form) => (
            <div key={form.id} style={cardStyle} onClick={() => handleSelect(form.id)}>
              <h2 style={titleStyle}>{form.settings?.formTitle || "(無題)"}</h2>
              {form.description && <p style={{ margin: 0, color: theme.textMuted }}>{form.description}</p>}
              <div style={metaStyle}>
                最終更新: {formatUnixMsDateTime(form.modifiedAtUnixMs ?? toUnixMs(form.modifiedAt))}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}

import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { formatUnixMsDateTime, toUnixMs } from "../utils/dateTime.js";

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

  return (
    <AppLayout
      title="フォーム一覧"
      backHidden
      sidebarActions={
        <button type="button" onClick={handleGoAdmin} className="nf-btn-outline nf-btn-sidebar">
          管理画面へ
        </button>
      }
    >
      {loadingForms ? (
        <p className="nf-text-subtle">読み込み中...</p>
      ) : activeForms.length === 0 ? (
        <p className="nf-text-subtle">登録済みのフォームがありません。管理画面から作成してください。</p>
      ) : (
        <div className="main-list">
          {activeForms.map((form) => (
            <div key={form.id} className="main-card" onClick={() => handleSelect(form.id)}>
              <h2 className="main-title">{form.settings?.formTitle || "(無題)"}</h2>
              {form.description && <p className="nf-m-0 nf-text-muted">{form.description}</p>}
              <div className="main-meta">
                最終更新: {formatUnixMsDateTime(form.modifiedAtUnixMs ?? toUnixMs(form.modifiedAt))}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}

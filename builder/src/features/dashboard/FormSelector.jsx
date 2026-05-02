import React from "react";

export default function FormSelector({ forms, selectedFormIds, onChange, recordsByForm, loading }) {
  const visibleForms = (forms || []).filter((form) => !form.archived);
  const selectedSet = new Set(selectedFormIds);

  const toggle = (formId) => {
    if (selectedSet.has(formId)) {
      onChange(selectedFormIds.filter((id) => id !== formId));
    } else {
      onChange([...selectedFormIds, formId]);
    }
  };

  const selectAll = () => {
    onChange(visibleForms.map((f) => f.id));
  };

  const clearAll = () => {
    onChange([]);
  };

  return (
    <div className="dashboard-form-selector nf-card">
      <div className="nf-row nf-gap-6 nf-mb-8">
        <strong className="nf-text-13">集計対象フォーム</strong>
        <span className="nf-flex-1" />
        <button type="button" className="nf-btn-outline nf-text-12" onClick={selectAll}>
          全選択
        </button>
        <button type="button" className="nf-btn-outline nf-text-12" onClick={clearAll}>
          解除
        </button>
        {loading && <span className="nf-text-subtle nf-text-12">読み込み中...</span>}
      </div>
      <div className="nf-row nf-gap-12 nf-flex-wrap">
        {visibleForms.length === 0 && (
          <span className="nf-text-subtle nf-text-13">利用可能なフォームがありません</span>
        )}
        {visibleForms.map((form) => {
          const checked = selectedSet.has(form.id);
          const cached = recordsByForm?.[form.id];
          const count = cached?.entries ? cached.entries.length : null;
          return (
            <label key={form.id} className="dashboard-form-chip">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(form.id)}
              />
              <span className="nf-ml-4">{form.settings?.formTitle || "(無題)"}</span>
              {checked && count !== null && (
                <span className="nf-text-subtle nf-text-12 nf-ml-4">({count}件)</span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

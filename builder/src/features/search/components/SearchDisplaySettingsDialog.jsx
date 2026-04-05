import React from "react";
import BaseDialog from "../../../app/components/BaseDialog.jsx";

export default function SearchDisplaySettingsDialog({ open, onClose, overrides, onUpdateOverride, formSettings, globalSettings }) {
  const fields = [
    {
      key: "pageSize",
      label: "1画面あたりの表示件数",
      placeholder: String(
        Number(formSettings?.pageSize) || Number(globalSettings?.pageSize) || 20
      ),
    },
    {
      key: "searchTableMaxWidth",
      label: "検索結果テーブルの幅（px）",
      placeholder: String(
        Number(formSettings?.searchTableMaxWidth) || Number(globalSettings?.searchTableMaxWidth) || ""
      ) || "制限なし",
    },
    {
      key: "searchCellMaxChars",
      label: "検索結果セルの表示文字数上限",
      placeholder: String(
        formSettings?.searchCellMaxChars ?? globalSettings?.searchCellMaxChars ?? ""
      ) || "50",
    },
  ];

  return (
    <BaseDialog
      open={open}
      title="検索結果の表示設定"
      footer={
        <button type="button" className="nf-btn nf-btn-secondary" onClick={onClose}>
          閉じる
        </button>
      }
    >
      <p className="nf-text-12 nf-text-subtle nf-mb-12">
        ここでの設定はこのフォームの検索画面にのみ適用され、フォーム設定より優先されます。
      </p>
      <div className="nf-col nf-gap-12">
        {fields.map(({ key, label, placeholder }) => (
          <div key={key} className="nf-col nf-gap-4">
            <label className="nf-label">{label}</label>
            <div className="nf-row nf-gap-6 nf-items-center">
              <input
                type="number"
                className="nf-input nf-flex-1"
                value={overrides?.[key] ?? ""}
                placeholder={placeholder}
                min={1}
                onChange={(e) => onUpdateOverride(key, e.target.value)}
              />
              <button
                type="button"
                className="nf-btn nf-btn-compact nf-btn-secondary"
                onClick={() => onUpdateOverride(key, "")}
                title="クリア（フォーム設定に戻す）"
              >
                クリア
              </button>
            </div>
          </div>
        ))}
      </div>
    </BaseDialog>
  );
}

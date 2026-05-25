import React from "react";
import BaseDialog from "../../../app/components/BaseDialog.jsx";

const parseDebounceMs = (raw) => {
  if (raw === "" || raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

export default function SearchDisplaySettingsDialog({ open, onClose, overrides, onUpdateOverride, formSettings, globalSettings, globalDebounceMs, onUpdateGlobalDebounce }) {
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
    {
      key: "searchHitColumnMinWidth",
      label: "検索ヒット箇所列の最小幅（px）",
      placeholder: String(
        Number(formSettings?.searchHitColumnMinWidth) || Number(globalSettings?.searchHitColumnMinWidth) || ""
      ) || "280",
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

      {onUpdateGlobalDebounce && (
        <div className="nf-col nf-gap-4 nf-mt-16">
          <label className="nf-label">検索の遅延時間（ミリ秒）</label>
          <input
            type="number"
            className="nf-input nf-flex-1"
            value={globalDebounceMs ?? ""}
            placeholder="300"
            min={0}
            onChange={(e) => onUpdateGlobalDebounce(parseDebounceMs(e.target.value))}
          />
          <p className="nf-text-12 nf-text-subtle">
            全フォーム共通の設定です。入力が止まってからこの時間後に検索を実行します（0で即時）。
          </p>
        </div>
      )}
    </BaseDialog>
  );
}

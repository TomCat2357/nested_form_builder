import React from "react";
import OverlayDialog from "./OverlayDialog.jsx";

const OVERLAY_STYLE = { alignItems: "center", background: "rgba(0,0,0,0.4)" };
const PANEL_STYLE = { background: "var(--nf-bg, #fff)", padding: 16, minWidth: 420, maxWidth: 560 };
const HEADER_STYLE = { marginBottom: 12 };

/**
 * カード単位の「ダッシュボードフィルタ → このカードのどの結果列に効かせるか」設定ダイアログ。
 *
 * cardColumns: 親 (Editor) が DashboardCardFrame の onColumnsLoaded から受け取った
 *              そのカードの実行結果カラム名配列。
 */
export default function DashboardCardFilterMappingDialog({
  card,
  filters,
  cardColumns,
  onChange,
  onClose,
}) {
  if (!card) return null;
  const mappings = card.filterMappings || {};

  const handleSelect = (filterId, column) => {
    const next = { ...mappings };
    if (!column) {
      delete next[filterId];
    } else {
      next[filterId] = { mode: "column", column };
    }
    onChange(card.id, next);
  };

  return (
    <OverlayDialog
      open
      onClose={onClose}
      title="フィルタマッピング"
      overlayStyle={OVERLAY_STYLE}
      panelClassName="nf-card"
      panelStyle={PANEL_STYLE}
      headerStyle={HEADER_STYLE}
    >
      <p className="nf-text-subtle" style={{ fontSize: 12, marginTop: 0 }}>
        このカードの結果列のうち、各ダッシュボードフィルタを適用したい列を選びます。
      </p>

      {(filters || []).length === 0 && (
        <p className="nf-text-subtle">ダッシュボードにフィルタが定義されていません。</p>
      )}

      {(filters || []).map((f) => {
        const current = mappings[f.id]?.column || "";
        return (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, minWidth: 120 }}>
              {f.label || f.id}
              <span className="nf-text-subtle" style={{ marginLeft: 4, fontSize: 11 }}>({f.type})</span>
            </span>
            <select
              className="nf-input"
              value={current}
              onChange={(e) => handleSelect(f.id, e.target.value)}
              style={{ fontSize: 12, padding: "2px 6px", flex: 1 }}
            >
              <option value="">(適用しない)</option>
              {(cardColumns || []).map((col) => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </div>
        );
      })}

      {(!cardColumns || cardColumns.length === 0) && filters && filters.length > 0 && (
        <p className="nf-text-subtle" style={{ fontSize: 11 }}>
          結果列がまだ取得できていません。Question 実行が完了するとこのリストに表示されます。
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button type="button" className="nf-btn-outline" onClick={onClose} style={{ fontSize: 12 }}>
          閉じる
        </button>
      </div>
    </OverlayDialog>
  );
}

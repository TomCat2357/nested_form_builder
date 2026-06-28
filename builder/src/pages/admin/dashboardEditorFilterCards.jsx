// DashboardEditorPage の繰り返しフィルタ行（プレゼンテーショナル）。
// 共通フィルタ定義行 / 簡易フィルタ定義行をそれぞれ子コンポーネントへ切り出す。
// DOM 構造・className・props・イベント挙動は元の JSX をそのまま保持する。

import React from "react";

// 共通フィルタ 1 件分の定義行。
export function FilterDefinitionCard({ filter, onChange, onRemove }) {
  const f = filter;
  return (
    <div className="nf-card" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", marginBottom: 6 }}>
      <span className="nf-text-subtle" style={{ fontSize: 11, minWidth: 80 }}>{f.type}</span>
      <input
        type="text"
        className="nf-input"
        value={f.label || ""}
        onChange={(e) => onChange(f.id, { label: e.target.value })}
        placeholder="ラベル"
        style={{ fontSize: 12, padding: "2px 6px", flex: 1, maxWidth: 200 }}
      />
      {f.type === "category" && (
        <input
          type="text"
          className="nf-input"
          value={(f.options?.values || []).join(",")}
          onChange={(e) => {
            const vals = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
            onChange(f.id, { options: { ...(f.options || {}), values: vals } });
          }}
          placeholder="選択肢 (カンマ区切り)"
          style={{ fontSize: 12, padding: "2px 6px", flex: 1 }}
        />
      )}
      {f.type === "category" && (
        <label style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 3 }}>
          <input
            type="checkbox"
            checked={!!f.options?.multi}
            onChange={(e) => onChange(f.id, { options: { ...(f.options || {}), multi: e.target.checked } })}
          />
          複数選択
        </label>
      )}
      <button
        type="button"
        className="nf-btn-outline nf-btn-danger"
        style={{ fontSize: 11, padding: "2px 6px" }}
        onClick={() => onRemove(f.id)}
      >
        削除
      </button>
    </div>
  );
}

// 簡易フィルタ 1 件分の定義行。
export function SimpleFilterDefinitionCard({ filter, availableColumns, onColumnSelect, onChange, onRemove }) {
  const f = filter;
  return (
    <div className="nf-card" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", marginBottom: 6, flexWrap: "wrap" }}>
      <select
        className="nf-input"
        value={f.column || ""}
        onChange={(e) => onColumnSelect(f.id, e.target.value)}
        style={{ fontSize: 12, padding: "2px 6px", minWidth: 200 }}
      >
        <option value="">項目を選択...</option>
        {availableColumns.map((c) => (
          <option key={c.alaSqlKey} value={c.alaSqlKey}>{c.key}</option>
        ))}
        {/* 既存の選択が候補一覧に無い場合（カード未描画等）も値を保持して表示する */}
        {f.column && !availableColumns.some((c) => c.alaSqlKey === f.column) && (
          <option value={f.column}>{f.column}（候補外）</option>
        )}
      </select>
      <span className="nf-text-subtle" style={{ fontSize: 11, minWidth: 48 }}>{f.valueType}</span>
      <input
        type="text"
        className="nf-input"
        value={f.label || ""}
        onChange={(e) => onChange(f.id, { label: e.target.value })}
        placeholder="ラベル（任意）"
        style={{ fontSize: 12, padding: "2px 6px", flex: 1, maxWidth: 200 }}
      />
      <button
        type="button"
        className="nf-btn-outline nf-btn-danger"
        style={{ fontSize: 11, padding: "2px 6px" }}
        onClick={() => onRemove(f.id)}
      >
        削除
      </button>
    </div>
  );
}

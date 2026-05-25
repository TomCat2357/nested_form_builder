import React from "react";

/**
 * ダッシュボード簡易フィルタの操作 UI。
 * 編集画面で選んだ項目（最大3）について、閲覧時に min / max を入力する。
 * valueType ("number" | "date" | "text") に応じて入力欄を出し分ける。
 * 値の形状は { min, max }。3項目間は AND（適用は元レコードテーブル側で行う）。
 */

function MinMaxInput({ valueType, value, onChange }) {
  const v = value || { min: null, max: null };
  const inputType = valueType === "number" ? "number" : valueType === "date" ? "date" : "text";
  const update = (key, raw) => {
    const next = raw === "" ? null : raw;
    onChange({ ...v, [key]: next });
  };
  const widthStyle = valueType === "date" ? {} : { width: 90 };
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input
        type={inputType}
        className="nf-input"
        value={v.min ?? ""}
        onChange={(e) => update("min", e.target.value)}
        placeholder="min"
        style={{ fontSize: 12, padding: "2px 6px", ...widthStyle }}
      />
      <span className="nf-text-subtle" style={{ fontSize: 12 }}>〜</span>
      <input
        type={inputType}
        className="nf-input"
        value={v.max ?? ""}
        onChange={(e) => update("max", e.target.value)}
        placeholder="max"
        style={{ fontSize: 12, padding: "2px 6px", ...widthStyle }}
      />
    </span>
  );
}

export default function SimpleFilterBar({ simpleFilters, values, onChange }) {
  if (!simpleFilters || simpleFilters.length === 0) return null;

  const handleChange = (filterId, v) => {
    onChange({ ...(values || {}), [filterId]: v });
  };

  return (
    <div
      className="nf-card"
      style={{
        padding: "8px 12px",
        marginBottom: 12,
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        alignItems: "center",
      }}
    >
      {simpleFilters.map((f) => (
        <div key={f.id} style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 11 }} className="nf-text-subtle">{f.label || f.column}</span>
          <MinMaxInput
            valueType={f.valueType}
            value={values ? values[f.id] : undefined}
            onChange={(v) => handleChange(f.id, v)}
          />
        </div>
      ))}
    </div>
  );
}

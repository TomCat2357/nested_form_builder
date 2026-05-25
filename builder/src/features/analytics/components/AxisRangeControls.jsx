import React from "react";
import { pad2 } from "../../../utils/dateTime.js";

/**
 * 軸 min/max スケーリング設定 UI。
 * - X 軸は scatter のときのみ（showX）
 * - Y 軸は yFields 全体の型が一致したときのみ（showY）
 *
 * axis の形: { x: { auto, min, max }, y: { auto, min, max } }。
 * onChange(nextAxis) で全体を返す。
 * VisualizePanel（管理者エディタ）と CardVizOverridePanel（閲覧者の一時上書き）で共有。
 */
export default function AxisRangeControls({ axis, xType, yType, showX, showY, onChange }) {
  if (!showX && !showY) return null;
  const a = axis || { x: { auto: true, min: null, max: null }, y: { auto: true, min: null, max: null } };
  const setSide = (side, patch) =>
    onChange({ ...a, [side]: { ...(a[side] || { auto: true, min: null, max: null }), ...patch } });
  return (
    <div style={{ marginBottom: "10px", padding: "8px 10px", border: "1px solid var(--nf-border)", borderRadius: 4, display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: "12px", fontWeight: 600 }}>軸スケール:</span>
      {showX && <SideControls label="X 軸" type={xType} cfg={a.x} onChange={(p) => setSide("x", p)} />}
      {showY && <SideControls label="Y 軸" type={yType} cfg={a.y} onChange={(p) => setSide("y", p)} />}
    </div>
  );
}

function SideControls({ label, type, cfg, onChange }) {
  const auto = cfg?.auto !== false;
  const inputType = type === "date" ? "datetime-local" : "number";
  const toStored = (raw) => {
    if (raw === "") return null;
    if (type === "date") {
      const d = new Date(raw);
      return Number.isFinite(d.getTime()) ? d.toISOString() : null;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const toInput = (v) => {
    if (v === null || v === undefined || v === "") return "";
    if (type === "date") {
      const d = v instanceof Date ? v : new Date(v);
      if (!Number.isFinite(d.getTime())) return "";
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }
    return String(v);
  };
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
      <span style={{ fontSize: "12px" }}>{label}</span>
      <label style={{ fontSize: "12px" }}>
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => onChange({ auto: e.target.checked })}
          style={{ marginRight: "4px" }}
        />
        自動
      </label>
      <label style={{ fontSize: "12px" }}>
        min
        <input
          className="nf-input"
          type={inputType}
          disabled={auto}
          value={toInput(cfg?.min)}
          onChange={(e) => onChange({ min: toStored(e.target.value) })}
          style={{ marginLeft: 4, width: type === "date" ? 180 : 110 }}
        />
      </label>
      <label style={{ fontSize: "12px" }}>
        max
        <input
          className="nf-input"
          type={inputType}
          disabled={auto}
          value={toInput(cfg?.max)}
          onChange={(e) => onChange({ max: toStored(e.target.value) })}
          style={{ marginLeft: 4, width: type === "date" ? 180 : 110 }}
        />
      </label>
    </div>
  );
}

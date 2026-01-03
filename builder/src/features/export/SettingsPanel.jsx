import React from "react";
import { SETTINGS_FIELDS } from "../settings/settingsSchema.js";
import { theme } from "../../app/theme/tokens.js";

const inputStyle = { width: "100%", boxSizing: "border-box", border: `1px solid ${theme.borderStrong}`, borderRadius: theme.radiusSm, padding: 8, background: theme.surface, color: theme.text };
const labelStyle = { display: "block", fontWeight: 600, marginBottom: 6 };

const SettingsField = ({ field, value, onChange }) => (
  <div style={{ marginBottom: 12 }}>
    <label style={labelStyle}>
      {field.label}
      {field.required && <span style={{ color: theme.dangerBright, marginLeft: 4 }}>*</span>}
    </label>
    <input
      style={inputStyle}
      type={field.type || "text"}
      value={value ?? ""}
      placeholder={field.placeholder}
      onChange={(event) => onChange(field.key, event.target.value)}
    />
  </div>
);

export default function SettingsPanel({ settings, onSettingsChange }) {
  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radiusMd, padding: 12, marginBottom: 12, background: theme.surface }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>基本設定</div>
      {SETTINGS_FIELDS.map((field) => (
        <SettingsField key={field.key} field={field} value={settings[field.key]} onChange={onSettingsChange} />
      ))}
    </div>
  );
}

import React from "react";
import { SETTINGS_FIELDS } from "../settings/settingsSchema.js";

const SettingsField = ({ field, value, onChange }) => (
  <div className="nf-mb-12">
    <label className="nf-block nf-fw-600 nf-mb-6">
      {field.label}
      {field.required && <span className="nf-text-danger nf-ml-4">*</span>}
    </label>
    <input
      className="nf-input"
      type={field.type || "text"}
      value={value ?? ""}
      placeholder={field.placeholder}
      onChange={(event) => onChange(field.key, event.target.value)}
    />
  </div>
);

export default function SettingsPanel({ settings, onSettingsChange }) {
  return (
    <div className="nf-card">
      <div className="nf-fw-600 nf-mb-8">基本設定</div>
      {SETTINGS_FIELDS.map((field) => (
        <SettingsField key={field.key} field={field} value={settings[field.key]} onChange={onSettingsChange} />
      ))}
    </div>
  );
}

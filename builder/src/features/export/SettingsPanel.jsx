import React from "react";
import { SETTINGS_GROUPS } from "../settings/settingsSchema.js";

const SettingsField = ({ field, value, onChange }) => {
  const isSelect = field.type === "select" || Array.isArray(field.options);
  const isCheckbox = field.type === "checkbox";

  if (isCheckbox) {
    return (
      <div className="nf-mb-12">
        <label className="nf-flex nf-items-center nf-gap-8" style={{ cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={value !== undefined ? !!value : !!field.defaultValue}
            onChange={(event) => onChange(field.key, event.target.checked)}
          />
          <span className="nf-fw-600">{field.label}</span>
        </label>
        {field.description && (
          <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">{field.description}</p>
        )}
      </div>
    );
  }

  return (
    <div className="nf-mb-12">
      <label className="nf-block nf-fw-600 nf-mb-6">
        {field.label}
        {field.required && <span className="nf-text-danger nf-ml-4">*</span>}
      </label>
      {isSelect ? (
        <select className="nf-input" value={value ?? ""} onChange={(event) => onChange(field.key, event.target.value)}>
          {(field.options || []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="nf-input"
          type={field.type || "text"}
          value={value ?? ""}
          placeholder={field.placeholder}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      )}
      {field.description && (
        <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">{field.description}</p>
      )}
    </div>
  );
};

export default function SettingsPanel({ settings, onSettingsChange }) {
  return (
    <div className="nf-card">
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.key} className="nf-mb-16">
          <div className="nf-settings-group-title nf-mb-12">{group.label}</div>
          {group.fields.map((field) => (
            <SettingsField key={field.key} field={field} value={settings[field.key]} onChange={onSettingsChange} />
          ))}
        </div>
      ))}
    </div>
  );
}

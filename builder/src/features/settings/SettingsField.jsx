import React from "react";
import { resolveSettingsCheckboxChecked, resolveSettingsFieldValue } from "../../utils/settings.js";

export function SettingsField({ field, value, onChange, disabled }) {
  const isSelect = field.type === "select" || Array.isArray(field.options);

  if (isSelect) {
    return (
      <select
        className="nf-input"
        value={resolveSettingsFieldValue(field, value)}
        onChange={(event) => onChange(field.key, event.target.value)}
        disabled={disabled}
      >
        {(field.options || []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      className="nf-input"
      type={field.type || "text"}
      value={value ?? ""}
      placeholder={field.placeholder}
      onChange={(event) => onChange(field.key, event.target.value)}
      disabled={disabled}
    />
  );
}

export function SettingsCheckboxField({ field, value, onChange, disabled }) {
  return (
    <label className="nf-flex nf-items-center nf-gap-8" style={{ cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={resolveSettingsCheckboxChecked(field, value)}
        onChange={(event) => onChange(field.key, event.target.checked)}
        disabled={disabled}
      />
      <span className="nf-fw-600">{field.label}</span>
    </label>
  );
}

export function SettingsGroupFields({ fields, values, onChange, disabled }) {
  const checkboxFields = fields.filter((f) => f.type === "checkbox");
  const otherFields = fields.filter((f) => f.type !== "checkbox");

  return (
    <>
      {otherFields.map((field) => (
        <div key={field.key} className="nf-mb-12">
          <label className="nf-block nf-fw-600 nf-mb-6">
            {field.label}
            {field.required && <span className="nf-text-danger nf-ml-4">*</span>}
          </label>
          <SettingsField
            field={field}
            value={values[field.key]}
            onChange={onChange}
            disabled={disabled}
          />
          {field.description && (
            <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">{field.description}</p>
          )}
        </div>
      ))}
      {checkboxFields.length > 0 && (
        <div className="nf-flex nf-flex-wrap nf-gap-16 nf-mb-12">
          {checkboxFields.map((field) => (
            <SettingsCheckboxField
              key={field.key}
              field={field}
              value={values[field.key]}
              onChange={onChange}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </>
  );
}

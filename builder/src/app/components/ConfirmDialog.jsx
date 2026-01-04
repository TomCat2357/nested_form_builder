import React from "react";

const getVariantClass = (variant) => {
  if (variant === "primary") return "primary";
  if (variant === "danger") return "danger";
  return "";
};

export default function ConfirmDialog({ open, title, message, options = [] }) {
  if (!open) return null;
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <div className="dialog-panel">
        <h2 id="confirm-dialog-title" className="dialog-title">{title}</h2>
        {message && <p className="dialog-message">{message}</p>}
        <div className="dialog-footer">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`dialog-btn ${getVariantClass(option.variant)}`}
              onClick={option.onSelect}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

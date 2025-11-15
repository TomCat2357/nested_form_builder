import React from "react";

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle = {
  width: "min(420px, 90vw)",
  background: "#fff",
  borderRadius: 12,
  boxShadow: "0 20px 45px rgba(15, 23, 42, 0.25)",
  padding: "24px 24px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const titleStyle = { margin: 0, fontSize: 18, fontWeight: 600 };
const messageStyle = { margin: 0, fontSize: 14, color: "#334155", lineHeight: 1.6 };
const footerStyle = { display: "flex", justifyContent: "flex-end", gap: 8 };

const baseButtonStyle = {
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 14,
  cursor: "pointer",
  border: "1px solid #CBD5E1",
  background: "#fff",
};

const getVariantStyle = (variant) => {
  if (variant === "primary") {
    return { background: "#2563EB", borderColor: "#2563EB", color: "#fff" };
  }
  if (variant === "danger") {
    return { background: "#DC2626", borderColor: "#DC2626", color: "#fff" };
  }
  return {};
};

export default function ConfirmDialog({ open, title, message, options = [] }) {
  if (!open) return null;
  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <div style={dialogStyle}>
        <h2 id="confirm-dialog-title" style={titleStyle}>{title}</h2>
        {message && <p style={messageStyle}>{message}</p>}
        <div style={footerStyle}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              style={{ ...baseButtonStyle, ...getVariantStyle(option.variant) }}
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

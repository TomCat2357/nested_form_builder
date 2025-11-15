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
const messageStyle = { margin: 0, fontSize: 14, color: "#334155", lineHeight: 1.6, whiteSpace: "pre-wrap" };
const footerStyle = { display: "flex", justifyContent: "flex-end", gap: 8 };

const baseButtonStyle = {
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 14,
  cursor: "pointer",
  border: "1px solid #CBD5E1",
  background: "#2563EB",
  borderColor: "#2563EB",
  color: "#fff",
};

export default function AlertDialog({ open, title = "通知", message, onClose }) {
  if (!open) return null;

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="alert-dialog-title">
      <div style={dialogStyle}>
        {title && <h2 id="alert-dialog-title" style={titleStyle}>{title}</h2>}
        {message && <p style={messageStyle}>{message}</p>}
        <div style={footerStyle}>
          <button
            type="button"
            style={baseButtonStyle}
            onClick={onClose}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

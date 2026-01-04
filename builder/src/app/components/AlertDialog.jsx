import React from "react";

export default function AlertDialog({ open, title = "通知", message, onClose }) {
  if (!open) return null;

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="alert-dialog-title">
      <div className="dialog-panel">
        {title && <h2 id="alert-dialog-title" className="dialog-title">{title}</h2>}
        {message && <p className="dialog-message dialog-message-pre">{message}</p>}
        <div className="dialog-footer">
          <button
            type="button"
            className="dialog-btn primary"
            onClick={onClose}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

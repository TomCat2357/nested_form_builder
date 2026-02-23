import React from "react";
import BaseDialog from "./BaseDialog.jsx";

export default function AlertDialog({ open, title = "通知", message, onClose }) {
  const footer = (
    <button type="button" className="dialog-btn primary" onClick={onClose}>
      OK
    </button>
  );

  return (
    <BaseDialog open={open} title={title} footer={footer}>
      {message && (
        typeof message === "string"
          ? <p className="dialog-message dialog-message-pre">{message}</p>
          : <div className="dialog-message">{message}</div>
      )}
    </BaseDialog>
  );
}

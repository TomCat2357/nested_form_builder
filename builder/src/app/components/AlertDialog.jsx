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
      {message && <p className="dialog-message dialog-message-pre">{message}</p>}
    </BaseDialog>
  );
}

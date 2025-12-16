import React from "react";
import DialogFrame from "./DialogFrame.jsx";
import DialogActions from "./DialogActions.jsx";

export default function AlertDialog({ open, title = "通知", message, onClose }) {
  return (
    <DialogFrame
      open={open}
      title={title}
      message={message}
      messageStyle={{ whiteSpace: "pre-wrap" }}
      ariaLabelledById="alert-dialog-title"
    >
      <DialogActions actions={[{ label: "OK", variant: "primary", onClick: onClose }]} />
    </DialogFrame>
  );
}

import React from "react";
import DialogFrame from "./DialogFrame.jsx";
import DialogActions from "./DialogActions.jsx";

export default function ConfirmDialog({ open, title, message, options = [] }) {
  return (
    <DialogFrame
      open={open}
      title={title}
      message={message}
      ariaLabelledById="confirm-dialog-title"
    >
      <DialogActions actions={options} />
    </DialogFrame>
  );
}

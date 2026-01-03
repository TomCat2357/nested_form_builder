import React from "react";

import { baseButtonStyle, dialogStyle, footerStyle, messageStyle, overlayStyle, titleStyle } from "./dialogStyles.js";
import { theme } from "../theme/tokens.js";

const okButtonStyle = { ...baseButtonStyle, background: theme.primaryStrong, borderColor: theme.primaryStrong, color: theme.surface };

export default function AlertDialog({ open, title = "通知", message, onClose }) {
  if (!open) return null;

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="alert-dialog-title">
      <div style={dialogStyle}>
        {title && <h2 id="alert-dialog-title" style={titleStyle}>{title}</h2>}
        {message && <p style={{ ...messageStyle, whiteSpace: "pre-wrap" }}>{message}</p>}
        <div style={footerStyle}>
          <button
            type="button"
            style={okButtonStyle}
            onClick={onClose}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

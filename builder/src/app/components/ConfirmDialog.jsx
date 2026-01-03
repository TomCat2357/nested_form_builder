import React from "react";

import { baseButtonStyle, dialogStyle, footerStyle, messageStyle, overlayStyle, titleStyle } from "./dialogStyles.js";
import { theme } from "../theme/tokens.js";

const getVariantStyle = (variant) => {
  if (variant === "primary") {
    return { background: theme.primaryStrong, borderColor: theme.primaryStrong, color: theme.surface };
  }
  if (variant === "danger") {
    return { background: theme.dangerStrong, borderColor: theme.dangerStrong, color: theme.surface };
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

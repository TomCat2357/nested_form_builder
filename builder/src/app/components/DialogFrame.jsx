import React from "react";
import { baseMessageStyle, dialogStyle, overlayStyle, titleStyle } from "./dialogStyles.js";

export default function DialogFrame({ open, title, message, messageStyle, ariaLabelledById, children }) {
  if (!open) return null;

  const labelledBy = title ? ariaLabelledById : undefined;

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div style={dialogStyle}>
        {title && <h2 id={ariaLabelledById} style={titleStyle}>{title}</h2>}
        {message && <p style={{ ...baseMessageStyle, ...messageStyle }}>{message}</p>}
        {children}
      </div>
    </div>
  );
}

import React from "react";

export default function BaseDialog({ open, title, children, footer }) {
  if (!open) return null;
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="dialog-panel">
        {title && <h2 id="dialog-title" className="dialog-title">{title}</h2>}
        {children}
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}

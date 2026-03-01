import React from "react";

export default function AlertDialog({ title = "通知", message, time, onClose }) {
  const timeStr = time ? time.toLocaleTimeString("ja-JP") : null;
  return (
    <div className="alert-banner" role="alert">
      <div className="alert-banner-body">
        {title && (
          <div className="alert-banner-header">
            <span className="alert-banner-title">{title}</span>
            {timeStr && <span className="alert-banner-time">{timeStr}</span>}
          </div>
        )}
        {message && (
          typeof message === "string"
            ? <p className="alert-banner-message">{message}</p>
            : <div className="alert-banner-message">{message}</div>
        )}
      </div>
      <button type="button" className="alert-banner-close" onClick={onClose} aria-label="閉じる">
        ×
      </button>
    </div>
  );
}

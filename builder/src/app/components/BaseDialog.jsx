import React from "react";
import { createPortal } from "react-dom";

export default function BaseDialog({ open, title, children, footer }) {
  if (!open) return null;
  // document.body へ portal する。ヘッダー（.app-header）には preview-overrides.css の
  // `header { backdrop-filter: blur(10px) }` が掛かっており、backdrop-filter は子孫の
  // position:fixed の含有ブロックを生成する。ヘッダー内から開く UploadSyncPanel 等の
  // .dialog-overlay がビューポートではなくヘッダー（高さ ~50px）基準で配置され、
  // パネル上部（タイトル）がヘッダー上にはみ出して切れていた。body 直下へ出して回避する。
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="dialog-panel">
        {title && <h2 id="dialog-title" className="dialog-title">{title}</h2>}
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

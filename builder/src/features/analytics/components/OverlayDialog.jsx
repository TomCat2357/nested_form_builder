import React, { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * createPortal で body 直下に出す軽量モーダル。
 * Escape キー / オーバーレイ（外側）クリックで閉じ、RGL セルなど transform 配下から呼んでも崩れない。
 * ヘッダはタイトル h3 ＋ 任意の headerActions ＋ ✕ ボタンで構成する。
 *
 * props:
 *   open / onClose                … 表示制御と閉じるコールバック
 *   title                         … ヘッダ左のタイトル
 *   headerActions                 … ヘッダ右、✕ ボタンの左に並べる要素（CSV/PNG ボタン等。省略可）
 *   overlayStyle                  … BASE_OVERLAY にマージする上書き（alignItems / padding / background など）
 *   panelClassName                … パネルの class（既定なし。"nf-card" を渡すとカード装飾になる）
 *   panelStyle                    … パネルの style
 *   headerStyle                   … BASE_HEADER にマージする上書き（marginBottom や borderBottom など）
 *   bodyStyle                     … 指定すると children を <div style={bodyStyle}> で包む（既定: 包まずそのまま）
 *   closeLabel                    … ✕ ボタンの aria-label（既定 "閉じる"）
 */

const BASE_OVERLAY = {
  position: "fixed",
  top: 0, left: 0, right: 0, bottom: 0,
  display: "flex",
  justifyContent: "center",
  zIndex: 1000,
};

const BASE_HEADER = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const TITLE_STYLE = {
  margin: 0,
  fontSize: 14,
  fontWeight: 600,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const CLOSE_BTN_STYLE = { fontSize: 12, padding: "2px 8px" };

export default function OverlayDialog({
  open,
  onClose,
  title,
  headerActions = null,
  overlayStyle,
  panelClassName,
  panelStyle,
  headerStyle,
  bodyStyle,
  closeLabel = "閉じる",
  children,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      // IME 変換中の Escape はキャンセル操作なのでダイアログを閉じない
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      style={{ ...BASE_OVERLAY, ...overlayStyle }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className={panelClassName} style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...BASE_HEADER, ...headerStyle }}>
          <h3 style={TITLE_STYLE}>{title}</h3>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {headerActions}
            <button
              type="button"
              className="nf-btn-outline"
              style={CLOSE_BTN_STYLE}
              onClick={() => onClose?.()}
              aria-label={closeLabel}
            >✕</button>
          </span>
        </div>
        {bodyStyle ? <div style={bodyStyle}>{children}</div> : children}
      </div>
    </div>,
    document.body,
  );
}

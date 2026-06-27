import React from "react";

// BaseDialog の footer に渡す「キャンセル / 実行」2 ボタン構成の共通化。
// 各ダイアログで同形の JSX が重複していたため 1 箇所へ集約する。
// 文言・disabled 条件・実行ボタンの種別 (primary / danger 等) は props で差し替える。
export default function DialogFooter({
  onCancel,
  onConfirm,
  confirmLabel,
  cancelLabel = "キャンセル",
  confirmDisabled = false,
  cancelDisabled = false,
  confirmVariant = "primary",
}) {
  return (
    <>
      <button type="button" className="dialog-btn" onClick={onCancel} disabled={cancelDisabled}>
        {cancelLabel}
      </button>
      <button
        type="button"
        className={`dialog-btn ${confirmVariant}`}
        onClick={onConfirm}
        disabled={confirmDisabled}
      >
        {confirmLabel}
      </button>
    </>
  );
}

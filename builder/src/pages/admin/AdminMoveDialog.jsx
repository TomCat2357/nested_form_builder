import React from "react";
import BaseDialog from "../../app/components/BaseDialog.jsx";

/**
 * フォーム/フォルダの移動ダイアログ。移動先フォルダパスを入力する。
 * 空欄なら最上位へ。存在しないフォルダはエラー（呼び出し側で検証）。
 */
export default function AdminMoveDialog({
  open,
  count = 0,
  value,
  onChange,
  onConfirm,
  onCancel,
  error = "",
}) {
  return (
    <BaseDialog
      open={open}
      title="移動"
      footer={
        <>
          <button type="button" className="dialog-btn" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" className="dialog-btn primary" onClick={onConfirm}>
            移動
          </button>
        </>
      }
    >
      <p className="dialog-message">
        選択中の {count} 件を移動します。移動先フォルダを入力してください。
      </p>
      <div>
        <label className="nf-block nf-mb-6 nf-text-13 nf-fw-600">移動先フォルダ</label>
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onConfirm();
          }}
          className="nf-input"
          placeholder="例: 苦情・通報/クマ （空欄=最上位）"
          autoFocus
        />
        {error && <p className="nf-mt-6 nf-text-danger-strong nf-text-12">{error}</p>}
        <p className="nf-mt-6 nf-text-muted nf-text-11">
          既存のフォルダパスを入力してください。空欄にすると最上位に移動します。
        </p>
      </div>
    </BaseDialog>
  );
}

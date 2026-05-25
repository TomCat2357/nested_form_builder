import React from "react";
import BaseDialog from "../../app/components/BaseDialog.jsx";

/**
 * 新規フォルダ作成ダイアログ。現在の階層 (parentPath) 配下にフォルダを作る。
 */
export default function AdminNewFolderDialog({
  open,
  parentPath = "",
  value,
  onChange,
  onConfirm,
  onCancel,
  error = "",
}) {
  const handleConfirm = () => {
    if (!(value || "").trim()) return;
    onConfirm();
  };

  return (
    <BaseDialog
      open={open}
      title="新規フォルダ"
      footer={
        <>
          <button type="button" className="dialog-btn" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" className="dialog-btn primary" onClick={handleConfirm}>
            作成
          </button>
        </>
      }
    >
      <p className="dialog-message">
        {parentPath
          ? `「${parentPath}」の中に新しいフォルダを作成します。`
          : "最上位に新しいフォルダを作成します。"}
      </p>
      <div>
        <label className="nf-block nf-mb-6 nf-text-13 nf-fw-600">フォルダ名</label>
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleConfirm();
          }}
          className="nf-input"
          placeholder="例: 苦情・通報"
          autoFocus
        />
        {error && <p className="nf-mt-6 nf-text-danger-strong nf-text-12">{error}</p>}
        <p className="nf-mt-6 nf-text-muted nf-text-11">
          スラッシュ区切りで複数階層も作成できます（例: 苦情・通報/クマ）。
        </p>
      </div>
    </BaseDialog>
  );
}

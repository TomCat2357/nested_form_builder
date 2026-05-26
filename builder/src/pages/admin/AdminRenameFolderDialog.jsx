import React from "react";
import BaseDialog from "../../app/components/BaseDialog.jsx";

/**
 * フォルダ名変更ダイアログ。親パスは保持し leaf 名だけを変更する（mv の rename 相当）。
 * 現在のフォルダ名をプリセットし、新しい名前を入力させる。
 */
export default function AdminRenameFolderDialog({
  open,
  currentName = "",
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
      title="フォルダ名を変更"
      footer={
        <>
          <button type="button" className="dialog-btn" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" className="dialog-btn primary" onClick={handleConfirm}>
            変更
          </button>
        </>
      }
    >
      <p className="dialog-message">
        {currentName
          ? `フォルダ「${currentName}」の名前を変更します。中のアイテムや下位フォルダも一緒に移動します。`
          : "フォルダの名前を変更します。"}
      </p>
      <div>
        <label className="nf-block nf-mb-6 nf-text-13 nf-fw-600">新しいフォルダ名</label>
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
          「/」は使用できません（同じ階層内での名前変更のみ）。
        </p>
      </div>
    </BaseDialog>
  );
}

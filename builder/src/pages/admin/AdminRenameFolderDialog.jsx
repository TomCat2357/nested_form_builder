import React from "react";
import BaseDialog from "../../app/components/BaseDialog.jsx";

/**
 * 名前変更ダイアログ。既定はフォルダ名変更（親パスを保持し leaf 名だけを変える mv の rename 相当）。
 * props で title / message / label / placeholder / note を渡せばフォーム・Question・Dashboard
 * など任意アイテムの名前変更にも使い回せる（既定値はフォルダ用なので未指定なら従来挙動）。
 * 現在の名前をプリセットし、新しい名前を入力させる。
 */
export default function AdminRenameFolderDialog({
  open,
  currentName = "",
  value,
  onChange,
  onConfirm,
  onCancel,
  error = "",
  title = "フォルダ名を変更",
  message,
  label = "新しいフォルダ名",
  placeholder = "例: 苦情・通報",
  note = "「/」は使用できません（同じ階層内での名前変更のみ）。",
}) {
  const handleConfirm = () => {
    if (!(value || "").trim()) return;
    onConfirm();
  };

  const resolvedMessage = message !== undefined
    ? message
    : (currentName
      ? `フォルダ「${currentName}」の名前を変更します。中のアイテムや下位フォルダも一緒に移動します。`
      : "フォルダの名前を変更します。");

  return (
    <BaseDialog
      open={open}
      title={title}
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
      {resolvedMessage && <p className="dialog-message">{resolvedMessage}</p>}
      <div>
        <label className="nf-block nf-mb-6 nf-text-13 nf-fw-600">{label}</label>
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleConfirm();
          }}
          className="nf-input"
          placeholder={placeholder}
          autoFocus
        />
        {error && <p className="nf-mt-6 nf-text-danger-strong nf-text-12">{error}</p>}
        {note && <p className="nf-mt-6 nf-text-muted nf-text-11">{note}</p>}
      </div>
    </BaseDialog>
  );
}

import React from "react";
import BaseDialog from "../../app/components/BaseDialog.jsx";

/**
 * テキスト 1 行を入力させる汎用ダイアログ。新規フォルダ作成・フォルダ/アイテム名変更を
 * 1 コンポーネントで賄う（旧 AdminNewFolderDialog / AdminRenameFolderDialog を統合）。
 * 既定値はフォルダ名変更用なので、未指定なら従来の rename 挙動になる。
 *
 * - title / message / label / placeholder / note … 表示文言（省略時はフォルダ rename 用既定）。
 * - confirmLabel … 確定ボタン文言（既定 "変更"。作成系は "作成" を渡す）。
 * - currentName … message 未指定時に rename 用の既定メッセージを組み立てるのに使う。
 */
export default function AdminFolderNameDialog({
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
  confirmLabel = "変更",
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
            {confirmLabel}
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

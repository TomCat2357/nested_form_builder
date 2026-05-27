import React, { useEffect, useState } from "react";
import BaseDialog from "../../app/components/BaseDialog.jsx";

// 標準フォルダ構成を別ルートへコピーするダイアログ。
// コピー先ルート URL + 「データもコピー」「webhooks もコピー」オプションを受け取る。
export default function AdminCopyStructureDialog({
  open,
  url,
  onUrlChange,
  copyData,
  onCopyDataChange,
  copyWebhooks,
  onCopyWebhooksChange,
  onConfirm,
  onCancel,
  loading,
}) {
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) setError("");
  }, [open]);

  const handleConfirm = () => {
    const trimmed = (url || "").trim();
    if (!trimmed) {
      setError("コピー先ルートフォルダの URL を入力してください");
      return;
    }
    setError("");
    onConfirm();
  };

  return (
    <BaseDialog
      open={open}
      title="フォルダ構成をコピー"
      footer={
        <>
          <button type="button" className="dialog-btn" onClick={onCancel} disabled={loading}>
            キャンセル
          </button>
          <button type="button" className="dialog-btn primary" onClick={handleConfirm} disabled={loading}>
            {loading ? "コピー中..." : "コピー"}
          </button>
        </>
      }
    >
      <p className="dialog-message">
        標準フォルダ構成（01_forms〜08_documents）をコピー先ルートへ複製し、フォーム→スプレッドシート等の
        リンクをコピー後の URL で再構成します。標準フォルダ構成外を指すリンクは削除されます。
      </p>

      <div>
        <label className="nf-block nf-mb-6 nf-text-13 nf-fw-600">コピー先ルートフォルダ URL</label>
        <input
          type="text"
          value={url}
          onChange={(event) => {
            onUrlChange(event.target.value);
            if (error) setError("");
          }}
          className="nf-input"
          placeholder="https://drive.google.com/drive/folders/..."
        />
        {error && <p className="nf-mt-6 nf-text-danger-strong nf-text-12">{error}</p>}
      </div>

      <label className="nf-row nf-gap-8 nf-mt-12" style={{ alignItems: "center", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={!!copyData}
          onChange={(event) => onCopyDataChange(event.target.checked)}
        />
        <span className="nf-text-13">データもコピーする（スプレッドシートの 12 行目以降）</span>
      </label>
      <p className="nf-mt-2 nf-text-11 nf-text-muted">
        OFF の場合、コピー先スプレッドシートはヘッダー（1〜11 行）のみで、回答データは含めません。
      </p>

      <label className="nf-row nf-gap-8 nf-mt-12" style={{ alignItems: "center", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={!!copyWebhooks}
          onChange={(event) => onCopyWebhooksChange(event.target.checked)}
        />
        <span className="nf-text-13">07_webhooks もコピーする</span>
      </label>
      <p className="nf-mt-2 nf-text-11 nf-text-muted">
        Webhook は URL 埋め込み等を含む場合があります。OFF の場合 07_webhooks は複製せず、フォーム内の
        Webhook 送信先 URL もクリアします（コピー先で再リンクしてください）。
      </p>

      <p className="nf-mt-12 nf-text-11 nf-text-muted">
        コピー完了後、コピー先の appsscript 本体で「マッピングを再構築」を 1 回実行する必要があります。
      </p>
    </BaseDialog>
  );
}

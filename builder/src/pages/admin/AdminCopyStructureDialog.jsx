import React, { useEffect, useState } from "react";
import BaseDialog from "../../app/components/BaseDialog.jsx";

// システムごと（appsscript 本体 + 標準フォルダ構成）を別ルートへコピーするダイアログ。
// コピー先ルート URL +「データもコピー」「webhooks もコピー」「マッピングを再構築」オプションを受け取る。
export default function AdminCopyStructureDialog({
  open,
  url,
  onUrlChange,
  copyData,
  onCopyDataChange,
  copyWebhooks,
  onCopyWebhooksChange,
  rebuildMapping,
  onRebuildMappingChange,
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
      title="システムごとコピー"
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
        appsscript 本体と標準フォルダ構成（01_forms〜08_documents）をコピー先ルートへ複製し、
        フォーム→スプレッドシート等のリンクをコピー後の URL で再構成します。標準フォルダ構成外を指すリンクは
        削除されます。コピー先スクリプトの Web アプリは手動で再デプロイが必要です（Script Properties は
        引き継がれず、マッピングは初回管理者アクセス時に自動再構築されます）。
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

      <label className="nf-row nf-gap-8 nf-mt-12" style={{ alignItems: "center", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={!!rebuildMapping}
          onChange={(event) => onRebuildMappingChange(event.target.checked)}
        />
        <span className="nf-text-13">マッピングを再構築する（コピー先 GAS を開いたときに自動実行・推奨）</span>
      </label>
      <p className="nf-mt-2 nf-text-11 nf-text-muted">
        ON の場合、コピー先ルートに再構築マーカーを残し、コピー先の appsscript を管理者で開いたときに
        マッピングが自動で 1 回だけ再構築されます。OFF の場合のみ、コピー先で手動再構築が必要です。
      </p>
    </BaseDialog>
  );
}

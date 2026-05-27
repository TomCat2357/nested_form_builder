import React, { useEffect, useState } from "react";
import BaseDialog from "../../app/components/BaseDialog.jsx";

// システムごと（appsscript 本体 + 標準フォルダ構成）を別ルートへコピーするダイアログ。
// コピー先ルート URL +「データもコピー」「webhooks もコピー」「マッピング JSON を書き出す」オプションを受け取る。
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
            {loading ? "コピー中..." : "別ルートへコピー"}
          </button>
        </>
      }
    >
      <p className="dialog-message">
        appsscript 本体と標準フォルダ構成（01_forms〜08_documents）をコピー先ルートへ複製し、
        フォーム→スプレッドシート等のリンクをコピー後の URL で再構成します。標準フォルダ構成外を指すリンクは
        削除されます。コピー先スクリプトの Web アプリは手動で再デプロイが必要です（Script Properties は
        引き継がれず、マッピングはコピー先の 設定 &gt; 管理 から「インポート」または「同期」で手動復元します）。
      </p>
      <p className="nf-mt-6 nf-text-12 nf-text-muted">
        ※ appsscript 本体の複製には Apps Script API を使用します。事前に実行ユーザーが
        script.google.com/home/usersettings で「Google Apps Script API」を ON にしておいてください
        （OFF のままだと本体はコピーされません）。
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
        <span className="nf-text-13">マッピング JSON を書き出す（推奨）</span>
      </label>
      <p className="nf-mt-2 nf-text-11 nf-text-muted">
        ON の場合、コピー先ルートに _nfb_mapping.json（新 fileId に振り直し済み）を保存します。コピー先の
        設定 &gt; 管理 から「インポート」（URL 空欄でルートの最新を読込）または「同期」を実行してマッピングを
        復元してください。OFF の場合は JSON を残さず、コピー先では「同期」のみで復元します。
      </p>
    </BaseDialog>
  );
}

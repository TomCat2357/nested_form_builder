import React, { useEffect, useState } from "react";
import BaseDialog from "../app/components/BaseDialog.jsx";

export default function ImportUrlDialog({ open, url, onUrlChange, onImport, onCancel }) {
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setError("");
    }
  }, [open]);

  const handleImport = () => {
    const trimmed = (url || "").trim();
    if (!trimmed) {
      setError("Google Drive URLを入力してください");
      return;
    }
    setError("");
    onImport();
  };

  return (
    <BaseDialog
      open={open}
      title="Google Driveからインポート"
      footer={
        <>
          <button type="button" className="dialog-btn" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className="dialog-btn primary"
            onClick={handleImport}
          >
            インポート
          </button>
        </>
      }
    >
      <p className="dialog-message">
        ファイルURLまたはフォルダURLを入力してください。
      </p>

      <div>
        <label className="nf-block nf-mb-6 nf-text-13 nf-fw-600">
          Google Drive URL
        </label>
        <input
          type="text"
          value={url}
          onChange={(event) => {
            onUrlChange(event.target.value);
            if (error) setError("");
          }}
          className="nf-input"
          placeholder="https://drive.google.com/file/d/... または https://drive.google.com/drive/folders/..."
        />
        {error && <p className="nf-mt-6 nf-text-danger-strong nf-text-12">{error}</p>}
        <p className="nf-mt-6 nf-text-muted nf-text-11">
          ・ファイルURL: そのフォームのみをインポート<br />
          ・フォルダURL: フォルダ内の全ての.jsonファイルをインポート<br />
          ・既にプロパティサービスに存在するフォームIDは自動的にスキップされます
        </p>
      </div>
    </BaseDialog>
  );
}

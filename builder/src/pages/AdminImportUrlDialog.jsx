import React, { useEffect, useState } from "react";

export default function ImportUrlDialog({ open, url, onUrlChange, onImport, onCancel }) {
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setError("");
    }
  }, [open]);

  if (!open) return null;

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
    <div className="admin-import-overlay">
      <div className="admin-import-panel">
        <h3 className="nf-text-18 nf-fw-700 nf-mb-8">Google Driveからインポート</h3>
        <p className="nf-mb-16 nf-text-muted nf-text-14">
          ファイルURLまたはフォルダURLを入力してください。
        </p>

        <div className="nf-mb-16">
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
            className="nf-input admin-import-input"
            placeholder="https://drive.google.com/file/d/... または https://drive.google.com/drive/folders/..."
          />
          {error && <p className="nf-mt-6 nf-text-danger-strong nf-text-12">{error}</p>}
          <p className="nf-mt-6 nf-text-muted nf-text-11">
            ・ファイルURL: そのフォームのみをインポート<br />
            ・フォルダURL: フォルダ内の全ての.jsonファイルをインポート<br />
            ・既にプロパティサービスに存在するフォームIDは自動的にスキップされます
          </p>
        </div>

        <div className="nf-row nf-gap-12 nf-mt-24 nf-justify-end">
          <button type="button" className="nf-btn-outline admin-import-btn" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className="admin-import-btn admin-import-btn-primary"
            onClick={handleImport}
          >
            インポート
          </button>
        </div>
      </div>
    </div>
  );
}

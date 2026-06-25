import React, { useEffect, useState } from "react";
import BaseDialog from "../../app/components/BaseDialog.jsx";
import DriveBrowserDialog from "../../features/drive/DriveBrowserDialog.jsx";

export default function ImportUrlDialog({
  open,
  url,
  onUrlChange,
  onImport,
  onCancel,
  title = "Google Driveからインポート",
  description = "ファイルURLまたはフォルダURLを入力してください。",
  helpText,
  itemLabel = "フォーム",
  pickerMode = "json",
}) {
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setError("");
      setPickerOpen(false);
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

  const defaultHelpText = (
    <>
      ・ファイルURL: その{itemLabel}のみをインポート<br />
      ・フォルダURL: フォルダ内の全ての.jsonファイルをインポート<br />
      ・既に登録されているIDは自動的にスキップされます
    </>
  );

  return (
    <>
      <BaseDialog
        open={open}
        title={title}
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
        <p className="dialog-message">{description}</p>

        <div>
          <label className="nf-block nf-mb-6 nf-text-13 nf-fw-600">
            Google Drive URL
          </label>
          <div className="nf-row nf-gap-8">
            <input
              type="text"
              value={url}
              onChange={(event) => {
                onUrlChange(event.target.value);
                if (error) setError("");
              }}
              className="nf-input nf-flex-1"
              placeholder="https://drive.google.com/file/d/... または https://drive.google.com/drive/folders/..."
            />
            <button type="button" className="nf-btn" onClick={() => setPickerOpen(true)}>
              Driveから選択
            </button>
          </div>
          {error && <p className="nf-mt-6 nf-text-danger-strong nf-text-12">{error}</p>}
          <p className="nf-mt-6 nf-text-muted nf-text-11">
            {helpText || defaultHelpText}
          </p>
        </div>
      </BaseDialog>

      <DriveBrowserDialog
        open={pickerOpen}
        mode={pickerMode}
        select="both"
        title={`${itemLabel}をインポート: ファイルまたはフォルダを選択`}
        onCancel={() => setPickerOpen(false)}
        onSelect={({ url: pickedUrl }) => {
          setPickerOpen(false);
          onUrlChange(pickedUrl);
          if (error) setError("");
        }}
      />
    </>
  );
}

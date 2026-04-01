import React from "react";

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result;
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      resolve(btoa(binary));
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });

const FileUploadField = ({ field, value, onChange, readOnly, driveSettings, gasClient }) => {
  const files = Array.isArray(value) ? value : [];
  const fileInputRef = React.useRef(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [driveUrl, setDriveUrl] = React.useState("");
  const [error, setError] = React.useState("");

  const uploadFile = async (file) => {
    setError("");
    setUploading(true);
    try {
      const base64 = await toBase64(file);
      const result = await gasClient.uploadFileToDrive({
        base64,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        driveSettings,
      });
      const entry = { name: result.fileName, driveFileId: result.fileId, driveFileUrl: result.fileUrl };
      const next = field.allowMultipleFiles ? [...files, entry] : [entry];
      onChange(next);
    } catch (err) {
      setError(err?.message || "アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  const handleFiles = (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const targets = field.allowMultipleFiles ? Array.from(fileList) : [fileList[0]];
    targets.reduce((chain, f) => chain.then(() => uploadFile(f)), Promise.resolve());
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragOver(false);
    if (readOnly) return;
    handleFiles(event.dataTransfer.files);
  };

  const handleDriveUrlCopy = async () => {
    if (!driveUrl.trim()) return;
    setError("");
    setUploading(true);
    try {
      const result = await gasClient.copyDriveFileToDrive({
        sourceUrl: driveUrl.trim(),
        driveSettings,
      });
      const entry = { name: result.fileName, driveFileId: result.fileId, driveFileUrl: result.fileUrl };
      const next = field.allowMultipleFiles ? [...files, entry] : [entry];
      onChange(next);
      setDriveUrl("");
    } catch (err) {
      setError(err?.message || "Driveファイルのコピーに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (index) => {
    const next = files.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : "");
  };

  if (readOnly) {
    return (
      <div>
        {files.length === 0 && <span className="nf-text-muted">ファイルなし</span>}
        {files.map((f, i) => (
          <div key={i} className="nf-mb-4">
            {f.driveFileUrl ? (
              <a href={f.driveFileUrl} target="_blank" rel="noopener noreferrer">{f.name || "ファイル"}</a>
            ) : (
              <span>{f.name || "ファイル"}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragOver ? "#1a73e8" : "#dadce0"}`,
          borderRadius: 8,
          padding: "24px 16px",
          textAlign: "center",
          backgroundColor: dragOver ? "#e8f0fe" : "#fafafa",
          cursor: "pointer",
          transition: "border-color 0.2s, background-color 0.2s",
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="nf-text-muted nf-mb-8">ファイルをドラッグ&ドロップ</div>
        <button
          type="button"
          className="nf-btn"
          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
        >
          ファイルを選択
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple={!!field.allowMultipleFiles}
          style={{ display: "none" }}
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      <div className="nf-row nf-gap-8 nf-mt-8">
        <input
          type="text"
          className="nf-input nf-flex-1"
          value={driveUrl}
          onChange={(e) => setDriveUrl(e.target.value)}
          placeholder="Google DriveファイルURLを貼り付け"
        />
        <button
          type="button"
          className="nf-btn"
          onClick={handleDriveUrlCopy}
          disabled={uploading || !driveUrl.trim()}
        >
          Driveからコピー
        </button>
      </div>

      {uploading && (
        <div className="nf-text-12 nf-text-muted nf-mt-8">アップロード中...</div>
      )}

      {error && (
        <div className="nf-text-danger-ink nf-text-12 nf-mt-4">{error}</div>
      )}

      {files.length > 0 && (
        <div className="nf-mt-8">
          {files.map((f, i) => (
            <div key={i} className="nf-row nf-gap-8 nf-items-center nf-mb-4">
              {f.driveFileUrl ? (
                <a href={f.driveFileUrl} target="_blank" rel="noopener noreferrer" className="nf-flex-1 nf-text-12">
                  {f.name || "ファイル"}
                </a>
              ) : (
                <span className="nf-flex-1 nf-text-12">{f.name || "ファイル"}</span>
              )}
              <button
                type="button"
                className="nf-btn nf-btn-danger nf-text-11"
                style={{ padding: "2px 8px" }}
                onClick={() => removeFile(i)}
              >
                削除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FileUploadField;

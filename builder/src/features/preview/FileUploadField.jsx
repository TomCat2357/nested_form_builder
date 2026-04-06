import React from "react";
import {
  appendDriveFileId,
  normalizeDriveFolderState,
  resolveEffectiveDriveFolderUrl,
} from "../../utils/driveFolderState.js";

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result;
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      resolve(btoa(binary));
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });

const FileUploadField = ({
  field,
  value,
  onChange,
  readOnly,
  driveSettings,
  gasClient,
  folderState,
  onFolderStateChange,
}) => {
  const files = Array.isArray(value) ? value : [];
  const fileInputRef = React.useRef(null);
  const filesRef = React.useRef(files);
  const [dragOver, setDragOver] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [driveUrl, setDriveUrl] = React.useState("");
  const [error, setError] = React.useState("");

  const normalizedFolderState = normalizeDriveFolderState(folderState);
  const folderStateRef = React.useRef(normalizedFolderState);
  const effectiveFolderUrl = resolveEffectiveDriveFolderUrl(normalizedFolderState);
  const displayedFolderUrl = effectiveFolderUrl || normalizedFolderState.resolvedUrl.trim();
  const allowFolderUrlEdit = field?.allowFolderUrlEdit === true;

  React.useEffect(() => {
    folderStateRef.current = normalizeDriveFolderState(folderState);
  }, [folderState]);

  React.useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const updateFolderStateFromUploadResult = React.useCallback((result) => {
    if (typeof onFolderStateChange !== "function") return;
    onFolderStateChange((prevState) => {
      const prev = normalizeDriveFolderState(prevState);
      const current = normalizeDriveFolderState(folderStateRef.current);
      const currentEffectiveFolderUrl = resolveEffectiveDriveFolderUrl(current);
      const nextResolvedUrl = typeof result?.folderUrl === "string" && result.folderUrl.trim()
        ? result.folderUrl.trim()
        : (currentEffectiveFolderUrl || prev.resolvedUrl);
      const keepAutoCreated = prev.autoCreated && prev.resolvedUrl.trim() && prev.resolvedUrl.trim() === nextResolvedUrl;
      const nextState = normalizeDriveFolderState({
        ...prev,
        resolvedUrl: nextResolvedUrl,
        inputUrl: prev.inputUrl.trim() ? prev.inputUrl : nextResolvedUrl,
        autoCreated: keepAutoCreated || result?.autoCreated === true,
        sessionUploadFileIds: appendDriveFileId(prev.sessionUploadFileIds, result?.fileId),
      });
      folderStateRef.current = nextState;
      return nextState;
    });
  }, [onFolderStateChange]);

  const buildUploadDriveSettings = React.useCallback(() => {
    const current = normalizeDriveFolderState(folderStateRef.current);
    return {
      ...(driveSettings || {}),
      folderUrl: resolveEffectiveDriveFolderUrl(current),
      autoCreated: current.autoCreated,
    };
  }, [driveSettings]);

  const uploadFile = async (file) => {
    setError("");
    setUploading(true);
    try {
      const base64 = await toBase64(file);
      const result = await gasClient.uploadFileToDrive({
        base64,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        driveSettings: buildUploadDriveSettings(),
      });
      const entry = { name: result.fileName, driveFileId: result.fileId, driveFileUrl: result.fileUrl };
      const next = [...filesRef.current, entry];
      filesRef.current = next;
      onChange(next);
      updateFolderStateFromUploadResult(result);
    } catch (err) {
      setError(err?.message || "アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  const handleFiles = (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const targets = Array.from(fileList);
    targets.reduce((chain, file) => chain.then(() => uploadFile(file)), Promise.resolve());
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
        driveSettings: buildUploadDriveSettings(),
      });
      const entry = { name: result.fileName, driveFileId: result.fileId, driveFileUrl: result.fileUrl };
      const next = [...filesRef.current, entry];
      filesRef.current = next;
      onChange(next);
      updateFolderStateFromUploadResult(result);
      setDriveUrl("");
    } catch (err) {
      setError(err?.message || "Driveファイルのコピーに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (index) => {
    const next = files.filter((_, i) => i !== index);
    filesRef.current = next;
    onChange(next.length > 0 ? next : "");
    const currentFolderState = normalizeDriveFolderState(folderStateRef.current);
    const effectiveFolderUrl = resolveEffectiveDriveFolderUrl(currentFolderState);
    if (!effectiveFolderUrl || typeof gasClient?.finalizeRecordDriveFolder !== "function") return;
    const currentSettings = buildUploadDriveSettings();
    gasClient.finalizeRecordDriveFolder({
      currentDriveFolderUrl: effectiveFolderUrl,
      inputDriveFolderUrl: currentFolderState.inputUrl.trim(),
      folderNameTemplate: currentSettings.folderNameTemplate || "",
      responses: currentSettings.responses || {},
      fieldLabels: currentSettings.fieldLabels || {},
      fieldValues: currentSettings.fieldValues || {},
      recordId: currentSettings.recordId || "",
    }).then((result) => {
      if (!result?.folderUrl || typeof onFolderStateChange !== "function") return;
      onFolderStateChange((prevState) => {
        const prev = normalizeDriveFolderState(prevState);
        return normalizeDriveFolderState({
          ...prev,
          resolvedUrl: result.folderUrl,
          inputUrl: prev.inputUrl.trim() ? prev.inputUrl : result.folderUrl,
          autoCreated: prev.autoCreated || result.autoCreated === true,
        });
      });
    }).catch(() => {
      // 削除操作自体はローカル完結のため、フォルダ名更新失敗時は無視する
    });
  };

  const handleFolderUrlChange = (event) => {
    if (typeof onFolderStateChange !== "function") return;
    const nextInputUrl = event.target.value;
    onFolderStateChange((prevState) => {
      const prev = normalizeDriveFolderState(prevState);
      const nextState = {
        ...prev,
        inputUrl: nextInputUrl,
      };
      const normalizedNextState = normalizeDriveFolderState(nextState);
      folderStateRef.current = normalizedNextState;
      return normalizedNextState;
    });
  };

  if (readOnly) {
    return (
      <div>
        {displayedFolderUrl && (
          <div className="nf-mb-6">
            <button
              type="button"
              className="nf-btn nf-btn-compact"
              onClick={() => window.open(displayedFolderUrl, "_blank", "noopener,noreferrer")}
            >
              フォルダを開く
            </button>
          </div>
        )}
        {files.length === 0 && (
          <span className="nf-text-muted">
            {displayedFolderUrl ? "ファイルなし" : "フォルダ未設定"}
          </span>
        )}
        {files.map((file, index) => (
          <div key={index} className="nf-mb-4">
            {file.driveFileUrl ? (
              <a href={file.driveFileUrl} target="_blank" rel="noopener noreferrer">{file.name || "ファイル"}</a>
            ) : (
              <span>{file.name || "ファイル"}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {allowFolderUrlEdit && (
        <div className="nf-mb-8">
          <label className="nf-block nf-fw-600 nf-mb-6">保存先フォルダURL</label>
          <input
            type="text"
            className="nf-input"
            value={normalizedFolderState.inputUrl}
            onChange={handleFolderUrlChange}
            placeholder="空欄の場合は初回アップロード時に自動作成 / Google DriveフォルダURLを入力するとそのフォルダを使用"
          />
        </div>
      )}

      <div
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
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
          onClick={(event) => { event.stopPropagation(); fileInputRef.current?.click(); }}
        >
          ファイルを選択
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(event) => { handleFiles(event.target.files); event.target.value = ""; }}
        />
      </div>

      {field.allowUploadByUrl === true && (
        <div className="nf-row nf-gap-8 nf-mt-8">
          <input
            type="text"
            className="nf-input nf-flex-1"
            value={driveUrl}
            onChange={(event) => setDriveUrl(event.target.value)}
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
      )}

      {displayedFolderUrl && (
        <div className="nf-text-12 nf-text-muted nf-mt-8">
          現在の保存先:
          {" "}
          <a href={displayedFolderUrl} target="_blank" rel="noopener noreferrer" className="nf-link">
            フォルダを開く
          </a>
        </div>
      )}

      {uploading && (
        <div className="nf-text-12 nf-text-muted nf-mt-8">アップロード中...</div>
      )}

      {error && (
        <div className="nf-text-danger-ink nf-text-12 nf-mt-4">{error}</div>
      )}

      {files.length > 0 && (
        <div className="nf-mt-8">
          {files.map((file, index) => (
            <div key={index} className="nf-row nf-gap-8 nf-items-center nf-mb-4">
              {file.driveFileUrl ? (
                <a href={file.driveFileUrl} target="_blank" rel="noopener noreferrer" className="nf-flex-1 nf-text-12">
                  {file.name || "ファイル"}
                </a>
              ) : (
                <span className="nf-flex-1 nf-text-12">{file.name || "ファイル"}</span>
              )}
              <button
                type="button"
                className="nf-btn nf-btn-danger nf-text-11"
                style={{ padding: "2px 8px" }}
                onClick={() => removeFile(index)}
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

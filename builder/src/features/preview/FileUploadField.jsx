import { ensureArray } from "../../utils/arrays.js";
import React from "react";
import {
  normalizeDriveFolderState,
  resolveEffectiveDriveFolderUrl,
} from "../../utils/driveFolderState.js";
import { buildFileUploadEntry, resolveFileDisplayName } from "../../core/collect.js";
import { fileToBase64 } from "../../utils/fileEncoding.js";
import {
  buildDriveUploadSettings,
  computeFolderStateAfterFinalize,
  computeFolderStateAfterUpload,
  validateUploadFile,
} from "./fileUploadHelpers.js";
import DriveBrowserDialog from "../drive/DriveBrowserDialog.jsx";

export {
  buildDriveUploadSettings,
  computeFolderStateAfterFinalize,
  computeFolderStateAfterUpload,
  validateUploadFile,
} from "./fileUploadHelpers.js";

const FileUploadReadOnlyView = ({ files, displayedFolderUrl, hideFileExtension }) => (
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
          <a href={file.driveFileUrl} target="_blank" rel="noopener noreferrer">{resolveFileDisplayName(file.name, hideFileExtension)}</a>
        ) : (
          <span>{resolveFileDisplayName(file.name, hideFileExtension)}</span>
        )}
      </div>
    ))}
  </div>
);

const FileUploadFolderStatus = ({ displayedFolderUrl, canDeleteDriveFolder, onDeleteDriveFolder }) => (
  <div className="nf-text-12 nf-text-muted nf-mt-8 nf-row nf-items-center nf-gap-8">
    <span>
      現在の保存先:
      {" "}
      <a href={displayedFolderUrl} target="_blank" rel="noopener noreferrer" className="nf-link">
        フォルダを開く
      </a>
    </span>
    {canDeleteDriveFolder && (
      <button
        type="button"
        className="nf-btn nf-btn-danger nf-text-11"
        style={{ padding: "2px 8px" }}
        onClick={onDeleteDriveFolder}
      >
        フォルダ削除
      </button>
    )}
  </div>
);

const FileUploadField = ({
  field,
  value,
  onChange,
  readOnly,
  driveSettings,
  gasClient,
  folderState,
  onFolderStateChange,
  canDeleteDriveFolder,
  onDeleteDriveFolder,
}) => {
  const fileInputRef = React.useRef(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const upload = useDriveFileUpload({
    field,
    value,
    onChange,
    gasClient,
    driveSettings,
    folderState,
    onFolderStateChange,
  });

  const {
    files,
    uploading,
    error,
    driveUrl,
    setDriveUrl,
    uploadFiles,
    copyFromDriveUrl,
    copyFromDrivePickedFile,
    removeFile,
    displayedFolderUrl,
  } = upload;

  if (readOnly) {
    return (
      <FileUploadReadOnlyView
        files={files}
        displayedFolderUrl={displayedFolderUrl}
        hideFileExtension={field?.hideFileExtension}
      />
    );
  }

  const handleDrop = (event) => {
    event.preventDefault();
    setDragOver(false);
    uploadFiles(event.dataTransfer.files);
  };

  return (
    <div>
      <div
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragOver ? "var(--primary)" : "var(--border-strong)"}`,
          borderRadius: 8,
          padding: "24px 16px",
          textAlign: "center",
          backgroundColor: dragOver ? "var(--primary-soft)" : "var(--surface-subtle)",
          color: "var(--text, inherit)",
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
          onChange={(event) => { uploadFiles(event.target.files); event.target.value = ""; }}
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
            onClick={copyFromDriveUrl}
            disabled={uploading || !driveUrl.trim()}
          >
            Driveからコピー
          </button>
        </div>
      )}

      {field.allowDriveBrowse === true && (
        <div className="nf-row nf-gap-8 nf-mt-8">
          <button
            type="button"
            className="nf-btn"
            onClick={() => setPickerOpen(true)}
            disabled={uploading}
          >
            Driveから選択
          </button>
        </div>
      )}

      <DriveBrowserDialog
        open={pickerOpen}
        mode="all"
        select="file"
        title="Google Drive からファイルを選択"
        onCancel={() => setPickerOpen(false)}
        onSelect={({ url }) => { setPickerOpen(false); copyFromDrivePickedFile(url); }}
      />

      {displayedFolderUrl && (
        <FileUploadFolderStatus
          displayedFolderUrl={displayedFolderUrl}
          canDeleteDriveFolder={canDeleteDriveFolder}
          onDeleteDriveFolder={onDeleteDriveFolder}
        />
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
                  {resolveFileDisplayName(file.name, field?.hideFileExtension)}
                </a>
              ) : (
                <span className="nf-flex-1 nf-text-12">{resolveFileDisplayName(file.name, field?.hideFileExtension)}</span>
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

export function useDriveFileUpload({
  field,
  value,
  onChange,
  gasClient,
  driveSettings,
  folderState,
  onFolderStateChange,
}) {
  const files = ensureArray(value);
  const filesRef = React.useRef(files);
  const [uploading, setUploading] = React.useState(false);
  const [driveUrl, setDriveUrl] = React.useState("");
  const [error, setError] = React.useState("");

  const normalizedFolderState = normalizeDriveFolderState(folderState);
  const folderStateRef = React.useRef(normalizedFolderState);
  const effectiveFolderUrl = resolveEffectiveDriveFolderUrl(normalizedFolderState);
  const displayedFolderUrl = effectiveFolderUrl || normalizedFolderState.resolvedUrl.trim();

  React.useEffect(() => {
    folderStateRef.current = normalizeDriveFolderState(folderState);
  }, [folderState]);

  React.useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const updateFolderStateFromUploadResult = React.useCallback((result) => {
    if (typeof onFolderStateChange !== "function") return;
    onFolderStateChange((prevState) => {
      const nextState = computeFolderStateAfterUpload({
        prev: prevState,
        current: folderStateRef.current,
        result,
      });
      folderStateRef.current = nextState;
      return nextState;
    });
  }, [onFolderStateChange]);

  const buildUploadDriveSettings = React.useCallback(() => (
    buildDriveUploadSettings({
      folderState: folderStateRef.current,
      field,
      driveSettings,
    })
  ), [driveSettings, field]);

  const runUploadWithGuard = async (fallbackErrorMessage, runGasAction) => {
    setError("");
    setUploading(true);
    try {
      const result = await runGasAction(buildUploadDriveSettings());
      const entry = buildFileUploadEntry(result);
      const next = [...filesRef.current, entry];
      filesRef.current = next;
      onChange(next);
      updateFolderStateFromUploadResult(result);
      return result;
    } catch (err) {
      setError(err?.message || fallbackErrorMessage);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const uploadFile = (file) => {
    if (file && file.size === 0) {
      setError("空ファイルは送信できません");
      return Promise.resolve(null);
    }
    const validationError = validateUploadFile(file);
    if (validationError) {
      setError(validationError);
      return Promise.resolve(null);
    }
    return runUploadWithGuard("アップロードに失敗しました", async (settings) => {
      const base64 = await fileToBase64(file);
      return gasClient.uploadFileToDrive({
        base64,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        driveSettings: settings,
      });
    });
  };

  const uploadFiles = (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const targets = Array.from(fileList);
    targets.reduce((chain, file) => chain.then(() => uploadFile(file)), Promise.resolve());
  };

  const copyFromDriveUrl = async () => {
    const trimmedUrl = driveUrl.trim();
    if (!trimmedUrl) return;
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setError("有効なURLを入力してください");
      return;
    }
    const result = await runUploadWithGuard("Driveファイルのコピーに失敗しました", (settings) => (
      gasClient.copyDriveFileToDrive({
        sourceUrl: trimmedUrl,
        driveSettings: settings,
      })
    ));
    if (result) setDriveUrl("");
  };

  // Drive ブラウザ（ピッカー）で選んだファイルを、URL 貼付と同じコピー経路で取り込む。
  // 引数で URL を受ける点だけが copyFromDriveUrl と異なる（driveUrl state に依存しない）。
  const copyFromDrivePickedFile = async (url) => {
    const trimmedUrl = (url || "").trim();
    if (!trimmedUrl) return;
    await runUploadWithGuard("Driveファイルのコピーに失敗しました", (settings) => (
      gasClient.copyDriveFileToDrive({
        sourceUrl: trimmedUrl,
        driveSettings: settings,
      })
    ));
  };

  const removeFile = (index) => {
    const next = files.filter((_, i) => i !== index);
    filesRef.current = next;
    onChange(next.length > 0 ? next : "");
    const currentFolderState = normalizeDriveFolderState(folderStateRef.current);
    const currentEffectiveUrl = resolveEffectiveDriveFolderUrl(currentFolderState);
    if (!currentEffectiveUrl || typeof gasClient?.finalizeRecordDriveFolder !== "function") return;
    const currentSettings = buildUploadDriveSettings();
    gasClient.finalizeRecordDriveFolder({
      currentDriveFolderUrl: currentEffectiveUrl,
      inputDriveFolderUrl: currentFolderState.inputUrl.trim(),
      responses: currentSettings.responses || {},
      fieldPaths: currentSettings.fieldPaths || {},
      fieldValues: currentSettings.fieldValues || {},
      recordId: currentSettings.recordId || "",
    }).then((result) => {
      if (!result?.folderUrl || typeof onFolderStateChange !== "function") return;
      onFolderStateChange((prevState) => computeFolderStateAfterFinalize({ prev: prevState, result }));
    }).catch(() => {
      // 削除操作自体はローカル完結のため、フォルダ名更新失敗時は無視する
    });
  };

  // プロジェクト移動・コピー後など、物理（driveFileUrl）が欠落しているファイルを、
  // 論理パス（folderName ＋ ファイル名）で GAS 側に解決させて自己修復する（物理優先・論理フォールバック）。
  // 解決できた物理は onChange で in-memory 値へ反映し、次回保存で前進補完される。
  const resolveAttemptRef = React.useRef("");
  React.useEffect(() => {
    if (typeof gasClient?.resolveUploadFiles !== "function") return;
    const folderName = normalizeDriveFolderState(folderStateRef.current).folderName;
    if (!folderName) return;
    const currentFiles = filesRef.current;
    const needsResolve = currentFiles.some((file) => file && file.name && !file.driveFileUrl);
    if (!needsResolve) return;
    const signature = folderName + "|" + currentFiles
      .map((file) => `${file?.name || ""}:${file?.driveFileId || ""}:${file?.driveFileUrl ? 1 : 0}`)
      .join(",");
    if (resolveAttemptRef.current === signature) return;
    resolveAttemptRef.current = signature;
    let cancelled = false;
    gasClient.resolveUploadFiles({
      folderName,
      files: currentFiles.map((file) => ({ name: file?.name || "", driveFileId: file?.driveFileId || "" })),
    }).then((result) => {
      if (cancelled || !result || !Array.isArray(result.files)) return;
      const base = filesRef.current;
      const merged = base.map((file, index) => {
        const resolved = result.files[index];
        if (!resolved) return file;
        return {
          ...file,
          driveFileId: resolved.driveFileId || file.driveFileId,
          driveFileUrl: resolved.driveFileUrl || file.driveFileUrl,
        };
      });
      const changed = merged.some((file, index) => (
        file.driveFileUrl !== base[index]?.driveFileUrl || file.driveFileId !== base[index]?.driveFileId
      ));
      if (!changed) return;
      filesRef.current = merged;
      onChange(merged);
    }).catch(() => {
      // 解決失敗は無視（リンクはそのまま空表示）。次回オープン時に再試行される。
    });
    return () => { cancelled = true; };
  }, [value, gasClient, onChange]);

  return {
    files,
    uploading,
    error,
    driveUrl,
    setDriveUrl,
    uploadFiles,
    copyFromDriveUrl,
    copyFromDrivePickedFile,
    removeFile,
    normalizedFolderState,
    effectiveFolderUrl,
    displayedFolderUrl,
  };
}

export default FileUploadField;

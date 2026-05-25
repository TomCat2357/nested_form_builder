import {
  appendDriveFileId,
  normalizeDriveFolderState,
  resolveEffectiveDriveFolderUrl,
} from "../../utils/driveFolderState.js";

// バックエンド (gas/constants.gs NFB_MAX_UPLOAD_BYTES / NFB_BLOCKED_UPLOAD_EXTENSIONS)
// と揃えたクライアント側の事前チェック。最終防衛線はバックエンド、ここは即時 UX 用。
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const BLOCKED_UPLOAD_EXTENSIONS = ["exe", "bat", "cmd", "com", "msi", "scr", "js", "vbs", "vbe", "wsf", "wsh", "ps1", "sh", "jar", "app", "cpl", "hta", "jse"];

export const validateUploadFile = (file) => {
  if (!file) return "";
  if (file.size > MAX_UPLOAD_BYTES) return "ファイルサイズが上限(25MB)を超えています";
  const name = String(file.name || "");
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex >= 0 && dotIndex < name.length - 1) {
    const ext = name.slice(dotIndex + 1).toLowerCase().trim();
    if (BLOCKED_UPLOAD_EXTENSIONS.includes(ext)) return "このファイル形式はアップロードできません: ." + ext;
  }
  return "";
};

export const computeFolderStateAfterUpload = ({ prev, current, result }) => {
  const prevState = normalizeDriveFolderState(prev);
  const currentState = normalizeDriveFolderState(current);
  const currentEffectiveFolderUrl = resolveEffectiveDriveFolderUrl(currentState);
  const nextResolvedUrl = typeof result?.folderUrl === "string" && result.folderUrl.trim()
    ? result.folderUrl.trim()
    : (currentEffectiveFolderUrl || prevState.resolvedUrl);
  const keepAutoCreated = prevState.autoCreated && prevState.resolvedUrl.trim() && prevState.resolvedUrl.trim() === nextResolvedUrl;
  return normalizeDriveFolderState({
    ...prevState,
    resolvedUrl: nextResolvedUrl,
    inputUrl: prevState.inputUrl.trim() ? prevState.inputUrl : nextResolvedUrl,
    autoCreated: keepAutoCreated || result?.autoCreated === true,
    sessionUploadFileIds: appendDriveFileId(prevState.sessionUploadFileIds, result?.fileId),
  });
};

export const computeFolderStateAfterFinalize = ({ prev, result }) => {
  const prevState = normalizeDriveFolderState(prev);
  return normalizeDriveFolderState({
    ...prevState,
    resolvedUrl: result.folderUrl,
    inputUrl: prevState.inputUrl.trim() ? prevState.inputUrl : result.folderUrl,
    autoCreated: prevState.autoCreated || result.autoCreated === true,
  });
};

export const buildDriveUploadSettings = ({ folderState, field, driveSettings }) => {
  const current = normalizeDriveFolderState(folderState);
  return {
    ...(driveSettings || {}),
    rootFolderUrl: field?.driveRootFolderUrl || "",
    folderNameTemplate: field?.driveFolderNameTemplate || "",
    folderUrl: resolveEffectiveDriveFolderUrl(current),
    autoCreated: current.autoCreated,
  };
};

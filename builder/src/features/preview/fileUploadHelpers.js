import {
  appendDriveFileId,
  normalizeDriveFolderState,
  resolveEffectiveDriveFolderUrl,
} from "../../utils/driveFolderState.js";

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

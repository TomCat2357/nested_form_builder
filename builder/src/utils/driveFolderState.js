const EMPTY_DRIVE_FOLDER_STATE = {
  resolvedUrl: "",
  inputUrl: "",
  pendingDeleteUrl: "",
  autoCreated: false,
  sessionUploadFileIds: [],
  pendingPrintFileIds: [],
};

export const createEmptyDriveFolderState = () => ({
  ...EMPTY_DRIVE_FOLDER_STATE,
  sessionUploadFileIds: [],
  pendingPrintFileIds: [],
});

export const normalizeDriveFileIds = (value) => {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  return source.reduce((ids, candidate) => {
    const normalized = typeof candidate === "string" ? candidate.trim() : "";
    if (!normalized || seen.has(normalized)) return ids;
    seen.add(normalized);
    ids.push(normalized);
    return ids;
  }, []);
};

export const appendDriveFileId = (ids, candidate) => {
  const normalized = typeof candidate === "string" ? candidate.trim() : "";
  if (!normalized) return ids;
  return ids.includes(normalized) ? ids : [...ids, normalized];
};

const areDriveFileIdListsEqual = (left, right) => {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
};

export const normalizeDriveFolderState = (value) => {
  const source = value && typeof value === "object" ? value : EMPTY_DRIVE_FOLDER_STATE;
  const resolvedUrl = typeof source.resolvedUrl === "string"
    ? source.resolvedUrl
    : (typeof source.url === "string" ? source.url : "");
  const inputUrl = typeof source.inputUrl === "string" ? source.inputUrl : resolvedUrl;
  const pendingDeleteUrl = typeof source.pendingDeleteUrl === "string" ? source.pendingDeleteUrl : "";
  return {
    resolvedUrl,
    inputUrl,
    pendingDeleteUrl,
    autoCreated: source.autoCreated === true,
    sessionUploadFileIds: normalizeDriveFileIds(source.sessionUploadFileIds),
    pendingPrintFileIds: normalizeDriveFileIds(source.pendingPrintFileIds),
  };
};

export const resolveEffectiveDriveFolderUrl = (value) => {
  const normalized = normalizeDriveFolderState(value);
  return normalized.inputUrl.trim() || normalized.resolvedUrl.trim();
};

export const hasConfiguredDriveFolder = (value) => {
  const normalized = normalizeDriveFolderState(value);
  return Boolean(normalized.inputUrl.trim() || normalized.resolvedUrl.trim());
};

export const areDriveFolderStatesEqual = (left, right) => {
  const a = normalizeDriveFolderState(left);
  const b = normalizeDriveFolderState(right);
  return a.resolvedUrl === b.resolvedUrl
    && a.inputUrl === b.inputUrl
    && a.pendingDeleteUrl === b.pendingDeleteUrl
    && a.autoCreated === b.autoCreated
    && areDriveFileIdListsEqual(a.sessionUploadFileIds, b.sessionUploadFileIds)
    && areDriveFileIdListsEqual(a.pendingPrintFileIds, b.pendingPrintFileIds);
};

export const markDriveFolderForDeletion = (value) => {
  const normalized = normalizeDriveFolderState(value);
  const targetUrl = resolveEffectiveDriveFolderUrl(normalized) || normalized.pendingDeleteUrl.trim();
  return normalizeDriveFolderState({
    ...normalized,
    resolvedUrl: "",
    inputUrl: "",
    pendingDeleteUrl: targetUrl,
    autoCreated: false,
  });
};

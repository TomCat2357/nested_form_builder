import { ensureArray } from "./arrays.js";
import { isPlainObject } from "./objectShape.js";
import { asString, asTrimmedString } from "./strings.js";

const EMPTY_DRIVE_FOLDER_STATE = {
  resolvedUrl: "",
  inputUrl: "",
  pendingDeleteUrl: "",
  // 論理パスのフォルダ部（06_upload_files 直下の一意フォルダ名 record_<id>_<uuid>）。
  // 物理URLが死んでも論理パスで再リンクできるよう保持し、保存時にセルへ書き出す。
  folderName: "",
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
  const source = ensureArray(value);
  const seen = new Set();
  return source.reduce((ids, candidate) => {
    const normalized = asTrimmedString(candidate);
    if (!normalized || seen.has(normalized)) return ids;
    seen.add(normalized);
    ids.push(normalized);
    return ids;
  }, []);
};

export const appendDriveFileId = (ids, candidate) => {
  const normalized = asTrimmedString(candidate);
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
    : asString(source.url);
  const inputUrl = typeof source.inputUrl === "string" ? source.inputUrl : resolvedUrl;
  const pendingDeleteUrl = asString(source.pendingDeleteUrl);
  const folderName = asString(source.folderName);
  return {
    resolvedUrl,
    inputUrl,
    pendingDeleteUrl,
    folderName,
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
    && a.folderName === b.folderName
    && a.autoCreated === b.autoCreated
    && areDriveFileIdListsEqual(a.sessionUploadFileIds, b.sessionUploadFileIds)
    && areDriveFileIdListsEqual(a.pendingPrintFileIds, b.pendingPrintFileIds);
};

export const createEmptyDriveFolderStates = () => ({});

// sessionStorage に保存された Drive フォルダ下書き（{ fieldId: state } マップ）を読み出し、
// 各 state を normalizeDriveFolderState で正規化したマップを返す。
// 未保存・JSON 破損・非オブジェクトはすべて空マップにフォールバックする。
export const loadDriveFolderStatesDraft = (storageKey) => {
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (isPlainObject(parsed)) {
        const next = {};
        for (const [fid, value] of Object.entries(parsed)) {
          next[fid] = normalizeDriveFolderState(value);
        }
        return next;
      }
    }
  } catch (e) {
    /* 破損データは無視して空マップ */
  }
  return createEmptyDriveFolderStates();
};

export const setDriveFolderStateForField = (statesMap, fieldId, updater) => {
  const base = statesMap || {};
  const current = normalizeDriveFolderState(base[fieldId]);
  const nextRaw = typeof updater === "function" ? updater(current) : updater;
  return { ...base, [fieldId]: normalizeDriveFolderState(nextRaw) };
};

export const areDriveFolderStatesMapsEqual = (left, right) => {
  const a = left || {};
  const b = right || {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!areDriveFolderStatesEqual(a[key], b[key])) return false;
  }
  return true;
};

export const hasAnyConfiguredDriveFolder = (statesMap) =>
  Object.values(statesMap || {}).some((value) => hasConfiguredDriveFolder(value));

export const markDriveFolderForDeletion = (value) => {
  const normalized = normalizeDriveFolderState(value);
  const targetUrl = resolveEffectiveDriveFolderUrl(normalized) || normalized.pendingDeleteUrl.trim();
  return normalizeDriveFolderState({
    ...normalized,
    resolvedUrl: "",
    inputUrl: "",
    pendingDeleteUrl: targetUrl,
    // フォルダごと削除するので論理パス（folderName）も落とす（再リンクのアンカーを残さない）。
    folderName: "",
    autoCreated: false,
  });
};

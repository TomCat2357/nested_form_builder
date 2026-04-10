import {
  normalizeDriveFileIds,
  normalizeDriveFolderState,
} from "../utils/driveFolderState.js";

export const fallbackForForm = (formId, locationState) => {
  if (locationState?.from) return locationState.from;
  if (formId) return `/search?form=${formId}`;
  return "/";
};

export const toResponseObject = (value) => (value && typeof value === "object" ? value : {});

export const diffResponses = (prevValue, nextValue) => {
  const prev = toResponseObject(prevValue);
  const next = toResponseObject(nextValue);
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);

  const addedKeys = nextKeys.filter((key) => !Object.prototype.hasOwnProperty.call(prev, key));
  const removedKeys = prevKeys.filter((key) => !Object.prototype.hasOwnProperty.call(next, key));
  const changedKeys = nextKeys.filter((key) => Object.prototype.hasOwnProperty.call(prev, key) && prev[key] !== next[key]);

  return {
    prevCount: prevKeys.length,
    nextCount: nextKeys.length,
    addedKeys,
    removedKeys,
    changedKeys,
  };
};

export const sampleKeys = (keys, max = 8) => keys.slice(0, max);

export const toEntryVersion = (candidate) => {
  const value = Number(candidate?.modifiedAtUnixMs ?? candidate?.modifiedAt ?? 0);
  return Number.isFinite(value) ? value : 0;
};

export const pickLatestEntry = (current, incoming) => {
  if (!current) return incoming || null;
  if (!incoming) return current;
  const currentVersion = toEntryVersion(current);
  const incomingVersion = toEntryVersion(incoming);
  return incomingVersion > currentVersion ? incoming : current;
};

export const collectDriveFileIds = (responses) => {
  const seen = new Set();
  Object.values(toResponseObject(responses)).forEach((value) => {
    if (!Array.isArray(value)) return;
    value.forEach((entry) => {
      const fileId = typeof entry?.driveFileId === "string" ? entry.driveFileId.trim() : "";
      if (fileId) seen.add(fileId);
    });
  });
  return normalizeDriveFileIds(Array.from(seen));
};

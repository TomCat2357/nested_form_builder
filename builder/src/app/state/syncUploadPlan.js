import { resolveUnixMs } from "../../utils/dateTime.js";

const toUploadRecord = (entry) => {
  const createdAtUnixMs = resolveUnixMs(entry?.createdAtUnixMs, entry?.createdAt);
  const modifiedAtUnixMs = resolveUnixMs(entry?.modifiedAtUnixMs, entry?.modifiedAt);
  const deletedAtUnixMs = resolveUnixMs(entry?.deletedAtUnixMs, entry?.deletedAt);
  return {
    ...entry,
    createdAt: Number.isFinite(createdAtUnixMs) ? createdAtUnixMs : (entry?.createdAt || ""),
    modifiedAt: Number.isFinite(modifiedAtUnixMs) ? modifiedAtUnixMs : (entry?.modifiedAt || ""),
    deletedAt: Number.isFinite(deletedAtUnixMs) ? deletedAtUnixMs : null,
  };
};

export const buildUploadRecordsForSync = ({ entries = [], baseServerReadAt = 0, forceFullSync = false } = {}) => {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const normalizedBaseServerReadAt = Number.isFinite(Number(baseServerReadAt)) ? Number(baseServerReadAt) : 0;
  const targets = forceFullSync
    ? safeEntries
    : safeEntries.filter((entry) => (entry?.modifiedAtUnixMs || 0) > normalizedBaseServerReadAt);
  return targets.map(toUploadRecord);
};

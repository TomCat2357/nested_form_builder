import { computeSchemaHash } from "../core/schema.js";
import { genId } from "../core/ids.js";
import { collectDisplayFieldSettings } from "./formPaths.js";
import { toUnixMs } from "./dateTime.js";

const defaultNowFn = () => toUnixMs(Date.now());

const resolveNow = (nowFn) => {
  const value = typeof nowFn === "function" ? nowFn() : defaultNowFn();
  return Number.isFinite(value) ? value : defaultNowFn();
};

const resolveCreatedAt = (source, fallbackCreatedAt, now) => {
  const createdAt = Number.isFinite(source?.createdAt)
    ? source.createdAt
    : (Number.isFinite(source?.createdAtUnixMs) ? source.createdAtUnixMs : toUnixMs(source?.createdAt));
  if (Number.isFinite(createdAt)) return createdAt;

  const fallback = toUnixMs(fallbackCreatedAt);
  if (Number.isFinite(fallback)) return fallback;

  return now;
};

export const normalizeFormRecord = (source = {}, options = {}) => {
  const { fallbackId = genId(), fallbackCreatedAt = undefined, nowFn = defaultNowFn, preserveUnknownFields = false } = options;
  const now = resolveNow(nowFn);
  const schema = Array.isArray(source.schema) ? source.schema : [];
  const displayFieldSettings = collectDisplayFieldSettings(schema);
  const createdAt = resolveCreatedAt(source, fallbackCreatedAt, now);
  const settings =
    source.settings && typeof source.settings === "object" && !Array.isArray(source.settings)
      ? { ...source.settings }
      : {};
  const base = preserveUnknownFields ? { ...source } : {};

  if (!settings.formTitle) {
    settings.formTitle = source.name || "無題のフォーム";
  }

  return {
    ...base,
    id: source.id || fallbackId,
    description: source.description || "",
    schema,
    settings,
    schemaHash: computeSchemaHash(schema),
    importantFields: displayFieldSettings.map((item) => item.path),
    displayFieldSettings,
    createdAt,
    modifiedAt: now,
    createdAtUnixMs: createdAt,
    modifiedAtUnixMs: now,
    archived: !!source.archived,
    schemaVersion: Number.isFinite(source.schemaVersion) ? source.schemaVersion : 1,
  };
};

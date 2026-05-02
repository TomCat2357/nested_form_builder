import { genDashboardId } from "../../core/ids.js";

export const DASHBOARD_SCHEMA_VERSION = 1;

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const cloneSettings = (raw) => {
  if (!isPlainObject(raw)) return {};
  const next = {};
  for (const key of Object.keys(raw)) next[key] = raw[key];
  return next;
};

export function normalizeDashboard(raw) {
  if (!isPlainObject(raw)) {
    throw new Error("ダッシュボード定義が不正です");
  }

  const settings = cloneSettings(raw.settings);
  if (typeof settings.title !== "string") settings.title = "";

  return {
    id: raw.id ? String(raw.id) : "",
    schemaVersion: Number.isFinite(raw.schemaVersion) ? raw.schemaVersion : DASHBOARD_SCHEMA_VERSION,
    description: typeof raw.description === "string" ? raw.description : "",
    settings,
    templateUrl: typeof raw.templateUrl === "string" ? raw.templateUrl : "",
    templateFileId: typeof raw.templateFileId === "string" ? raw.templateFileId : "",
    dataSources: Array.isArray(raw.dataSources) ? raw.dataSources : [],
    queries: Array.isArray(raw.queries) ? raw.queries : [],
    widgets: Array.isArray(raw.widgets) ? raw.widgets : [],
    layout: Array.isArray(raw.layout) ? raw.layout : [],
    archived: !!raw.archived,
    readOnly: !!raw.readOnly,
    driveFileUrl: raw.driveFileUrl ? String(raw.driveFileUrl) : "",
    createdAtUnixMs: Number.isFinite(raw.createdAtUnixMs) ? raw.createdAtUnixMs : null,
    modifiedAtUnixMs: Number.isFinite(raw.modifiedAtUnixMs) ? raw.modifiedAtUnixMs : null,
  };
}

export function createEmptyDashboard({ id } = {}) {
  return normalizeDashboard({
    id: id || genDashboardId(),
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    settings: { title: "" },
    description: "",
    templateUrl: "",
    templateFileId: "",
    dataSources: [],
    queries: [],
    widgets: [],
    layout: [],
  });
}

export function sanitizeImportedDashboard(raw) {
  if (!isPlainObject(raw)) return null;
  try {
    return normalizeDashboard(raw);
  } catch (_err) {
    return null;
  }
}

import {
  listDashboards as listDashboardsFromGas,
  getDashboard as getDashboardFromGas,
  saveDashboard as saveDashboardToGas,
  copyDashboard as copyDashboardFromGas,
  deleteDashboardsFromDrive,
  archiveDashboards as archiveDashboardsInGas,
  unarchiveDashboards as unarchiveDashboardsInGas,
  setDashboardsReadOnly as setDashboardsReadOnlyInGas,
  clearDashboardsReadOnly as clearDashboardsReadOnlyInGas,
  registerImportedDashboard as registerImportedDashboardInGas,
} from "../../services/gasClient.js";
import { createEmptyDashboard, normalizeDashboard } from "../../features/dashboards/dashboardSchema.js";
import { getDashboardsFromCache } from "./dashboardsCache.js";

const safeNormalize = (dashboard) => {
  if (!dashboard) return null;
  try {
    return normalizeDashboard(dashboard);
  } catch (_err) {
    return null;
  }
};

export const dashboardsStore = {
  async listDashboards({ includeArchived = false } = {}) {
    const result = await listDashboardsFromGas({ includeArchived });
    const dashboards = Array.isArray(result.dashboards) ? result.dashboards : [];
    const loadFailures = Array.isArray(result.loadFailures) ? result.loadFailures : [];
    return {
      dashboards: dashboards.map(safeNormalize).filter(Boolean),
      loadFailures,
      source: "gas",
    };
  },

  async getDashboard(dashboardId) {
    try {
      const { dashboards = [] } = await getDashboardsFromCache();
      const cached = dashboards.find((d) => d.id === dashboardId);
      if (cached) return safeNormalize(cached);
    } catch (error) {
      console.warn("[dashboardsStore.getDashboard] Cache lookup failed:", error);
    }
    const dashboard = await getDashboardFromGas(dashboardId);
    return dashboard ? safeNormalize(dashboard) : null;
  },

  async createDashboard(payload, targetUrl = null, saveMode = "auto") {
    const draft = normalizeDashboard({ ...createEmptyDashboard(), ...payload });
    const result = await saveDashboardToGas(draft, targetUrl, saveMode);
    const saved = result?.dashboard ? safeNormalize(result.dashboard) : null;
    if (!saved) return draft;
    if (result?.fileUrl && !saved.driveFileUrl) saved.driveFileUrl = result.fileUrl;
    return saved;
  },

  async updateDashboard(dashboardId, updates, targetUrl = null, saveMode = "auto") {
    let current = null;
    try {
      current = await this.getDashboard(dashboardId);
    } catch (error) {
      console.warn("[dashboardsStore.updateDashboard] Failed to fetch current:", error);
    }
    if (!current) {
      current = normalizeDashboard({ id: dashboardId, ...updates });
    }
    const next = normalizeDashboard({
      ...current,
      ...updates,
      id: current.id || dashboardId,
      createdAtUnixMs: updates?.createdAtUnixMs ?? current.createdAtUnixMs,
      driveFileUrl: current.driveFileUrl || updates?.driveFileUrl || "",
    });
    const result = await saveDashboardToGas(next, targetUrl, saveMode);
    const saved = result?.dashboard ? safeNormalize(result.dashboard) : null;
    if (!saved) return next;
    if (result?.fileUrl && !saved.driveFileUrl) saved.driveFileUrl = result.fileUrl;
    return saved;
  },

  async copyDashboard(dashboardId) {
    const result = await copyDashboardFromGas(dashboardId);
    const saved = result?.dashboard ? safeNormalize(result.dashboard) : null;
    if (saved && result?.fileUrl && !saved.driveFileUrl) saved.driveFileUrl = result.fileUrl;
    return saved;
  },

  async _batchAction(dashboardIds, gasFn) {
    const targetIds = Array.isArray(dashboardIds) ? dashboardIds.filter(Boolean) : [dashboardIds].filter(Boolean);
    if (!targetIds.length) return { dashboards: [], updated: 0, errors: [] };
    const result = await gasFn(targetIds);
    return {
      dashboards: (result.dashboards || []).map(safeNormalize).filter(Boolean),
      updated: result.updated || 0,
      errors: result.errors || [],
    };
  },

  archiveDashboards(dashboardIds) {
    return this._batchAction(dashboardIds, archiveDashboardsInGas);
  },
  unarchiveDashboards(dashboardIds) {
    return this._batchAction(dashboardIds, unarchiveDashboardsInGas);
  },
  setDashboardsReadOnly(dashboardIds) {
    return this._batchAction(dashboardIds, setDashboardsReadOnlyInGas);
  },
  clearDashboardsReadOnly(dashboardIds) {
    return this._batchAction(dashboardIds, clearDashboardsReadOnlyInGas);
  },

  async deleteDashboards(dashboardIds) {
    const targetIds = Array.isArray(dashboardIds) ? dashboardIds.filter(Boolean) : [dashboardIds].filter(Boolean);
    if (!targetIds.length) return;
    await deleteDashboardsFromDrive(targetIds);
  },

  async registerImportedDashboard(payload) {
    const result = await registerImportedDashboardInGas(payload);
    const dashboard = result?.dashboard ? safeNormalize(result.dashboard) : null;
    if (dashboard && result?.fileUrl && !dashboard.driveFileUrl) dashboard.driveFileUrl = result.fileUrl;
    return dashboard;
  },

  async exportDashboards(dashboardIds) {
    const { dashboards: allDashboards } = await this.listDashboards({ includeArchived: true });
    const selected = allDashboards.filter((d) => dashboardIds.includes(d.id));
    return selected.map((dashboard) => {
      const { id: _id, createdAtUnixMs: _c, modifiedAtUnixMs: _m, driveFileUrl: _u, ...rest } = dashboard;
      return JSON.parse(JSON.stringify(rest));
    });
  },
};

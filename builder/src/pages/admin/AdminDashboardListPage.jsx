import React from "react";
import {
  listDashboards,
  listDashboardsSWR,
  saveDashboard,
  archiveDashboards,
  unarchiveDashboards,
  copyDashboard,
  deleteDashboards,
  exportDashboards,
  importDashboardsFromDrive,
  registerImportedDashboard,
  listDashboardFolders,
  createDashboardFolder,
  moveDashboards,
  renameDashboardFolder,
  deleteDashboardFolder,
} from "../../features/analytics/analyticsStore.js";
import AdminAnalyticsListPage from "./AdminAnalyticsListPage.jsx";

const store = {
  list: listDashboards,
  listSWR: listDashboardsSWR,
  save: saveDashboard,
  archive: archiveDashboards,
  unarchive: unarchiveDashboards,
  copy: copyDashboard,
  remove: deleteDashboards,
  exportItems: exportDashboards,
  importFromDrive: importDashboardsFromDrive,
  registerImported: registerImportedDashboard,
  listFolders: listDashboardFolders,
  createFolder: createDashboardFolder,
  moveItems: moveDashboards,
  renameFolder: renameDashboardFolder,
  deleteFolder: deleteDashboardFolder,
};

const extraColumn = {
  header: "カード数",
  render: (d) => (Array.isArray(d.cards) ? d.cards.length : 0),
};

const renderNameCell = (d) => (
  <>
    <div className="nf-fw-600">{d.name || "(無題)"}</div>
    {d.description && <div className="nf-text-muted nf-text-12 nf-pre-wrap">{d.description}</div>}
  </>
);

export default function AdminDashboardListPage() {
  return (
    <AdminAnalyticsListPage
      kind="dashboards"
      itemLabel="Dashboard"
      title="Dashboard 管理"
      fallbackPath="/admin"
      newItemPath="/admin/dashboards/new"
      buildEditPath={(id) => `/admin/dashboards/${id}/edit`}
      store={store}
      extraColumn={extraColumn}
      renderNameCell={renderNameCell}
      enableUrlCopy
      copyUrlPathPrefix="/dashboards/"
    />
  );
}

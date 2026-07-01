import React, { useCallback } from "react";
import {
  listDashboards,
  listDashboardsSWR,
  saveDashboard,
  archiveDashboards,
  unarchiveDashboards,
  copyDashboard,
  deleteDashboards,
  deleteDashboardsWithFiles,
  exportDashboards,
  importDashboardsFromDrive,
  registerImportedDashboard,
  listDashboardFolders,
  createDashboardFolder,
  moveDashboards,
  renameDashboardFolder,
  deleteDashboardFolder,
  listQuestionsSWR,
} from "../../features/analytics/analyticsStore.js";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import AdminAnalyticsListPage from "./AdminAnalyticsListPage.jsx";

const store = {
  list: listDashboards,
  listSWR: listDashboardsSWR,
  save: saveDashboard,
  archive: archiveDashboards,
  unarchive: unarchiveDashboards,
  copy: copyDashboard,
  remove: deleteDashboards,
  removeWithFiles: deleteDashboardsWithFiles,
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
  const { refreshForms } = useAppData();

  // Dashboard は Question に、Question は Form に依存するため、更新はその下流も丸ごと再取得する。
  const cascadeRefresh = useCallback(async () => {
    await Promise.all([
      listQuestionsSWR({ forceRefresh: true }),
      refreshForms({ reason: "cascade:admin-dashboard-list", background: true }),
    ]);
  }, [refreshForms]);

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
      cascadeRefresh={cascadeRefresh}
    />
  );
}

import React from "react";
import {
  listCrossSearches,
  listCrossSearchesSWR,
  saveCrossSearch,
  archiveCrossSearches,
  unarchiveCrossSearches,
  copyCrossSearch,
  deleteCrossSearches,
  deleteCrossSearchesWithFiles,
  exportCrossSearches,
  importCrossSearchesFromDrive,
  registerImportedCrossSearch,
  listCrossSearchFolders,
  createCrossSearchFolder,
  moveCrossSearches,
  renameCrossSearchFolder,
  deleteCrossSearchFolder,
} from "../../features/analytics/crossFormSearchStore.js";
import AdminAnalyticsListPage from "./AdminAnalyticsListPage.jsx";

const store = {
  list: listCrossSearches,
  listSWR: listCrossSearchesSWR,
  save: saveCrossSearch,
  archive: archiveCrossSearches,
  unarchive: unarchiveCrossSearches,
  copy: copyCrossSearch,
  remove: deleteCrossSearches,
  removeWithFiles: deleteCrossSearchesWithFiles,
  exportItems: exportCrossSearches,
  importFromDrive: importCrossSearchesFromDrive,
  registerImported: registerImportedCrossSearch,
  listFolders: listCrossSearchFolders,
  createFolder: createCrossSearchFolder,
  moveItems: moveCrossSearches,
  renameFolder: renameCrossSearchFolder,
  deleteFolder: deleteCrossSearchFolder,
};

const extraColumn = {
  header: "対象フォーム数",
  render: (cfs) => (Array.isArray(cfs.formIds) ? cfs.formIds.length : 0),
};

const renderNameCell = (cfs) => (
  <>
    <div className="nf-fw-600">{cfs.name || "(無題)"}</div>
    {cfs.description && <div className="nf-text-muted nf-text-12 nf-pre-wrap">{cfs.description}</div>}
  </>
);

export default function AdminCrossSearchListPage() {
  return (
    <AdminAnalyticsListPage
      kind="crossSearches"
      itemLabel="串刺し検索"
      title="串刺しフォーム検索 管理"
      fallbackPath="/admin"
      newItemPath="/admin/cross-searches/new"
      buildEditPath={(id) => `/admin/cross-searches/${id}/edit`}
      store={store}
      extraColumn={extraColumn}
      renderNameCell={renderNameCell}
      enableUrlCopy
      copyUrlPathPrefix="/cross-search?id="
    />
  );
}

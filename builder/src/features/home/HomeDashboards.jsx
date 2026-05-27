import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { listDashboardsSWR } from "../analytics/analyticsStore.js";
import { useAnalyticsList } from "../analytics/useAnalyticsList.js";
import { useFolderBrowser } from "../folders/useFolderBrowser.js";
import FolderSearchBar from "../folders/FolderSearchBar.jsx";
import FolderBreadcrumbs from "../folders/FolderBreadcrumbs.jsx";
import FolderCard from "../folders/FolderCard.jsx";

export default function HomeDashboards({ resetNonce = 0 }) {
  const navigate = useNavigate();
  const { items, loading, refreshing, error } = useAnalyticsList({ listSWR: listDashboardsSWR });
  const browser = useFolderBrowser(items, {
    getFolder: (d) => d.folder,
    getName: (d) => d.name || "",
    urlParam: "folder",
  });

  // 閲覧へ遷移するとき、戻り先として現在のフォルダ付きホーム URL を渡す。
  const handleSelect = (dashboardId) => {
    const from = `/?view=dashboards${browser.currentPath ? `&folder=${encodeURIComponent(browser.currentPath)}` : ""}`;
    navigate(`/dashboards/${dashboardId}`, { state: { from } });
  };

  // 親（HomePage）のタブ再クリックでルート（すべて）へ戻し検索も空にする。
  useEffect(() => {
    if (resetNonce > 0) {
      browser.goTo("");
      browser.setQuery("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  if (loading) return <p className="nf-text-subtle">読み込み中...</p>;
  if (error && items.length === 0) return <p className="nf-text-warning">{error}</p>;
  if (items.length === 0) {
    return <p className="nf-text-subtle">ダッシュボードがありません。</p>;
  }

  return (
    <div className="nf-col nf-gap-12">
      {refreshing && <p className="nf-text-subtle nf-text-12 nf-m-0">更新中...</p>}
      <FolderSearchBar value={browser.query} onChange={browser.setQuery} placeholder="ダッシュボード名で検索（例: 売上。正規表現も可）" />
      <FolderBreadcrumbs breadcrumbs={browser.breadcrumbs} onNavigate={browser.goTo} hidden={browser.searching} />
      {browser.folders.length === 0 && browser.visibleItems.length === 0 ? (
        <p className="nf-text-subtle">{browser.searching ? "一致するダッシュボードがありません。" : "このフォルダにダッシュボードはありません。"}</p>
      ) : (
        <div className="main-list">
          {browser.folders.map((f) => (
            <FolderCard key={f.path} name={f.name} count={f.count} onOpen={() => browser.openFolder(f.path)} />
          ))}
          {browser.visibleItems.map((d) => (
            <div
              key={d.id}
              className="main-card"
              onClick={() => handleSelect(d.id)}
            >
              <h2 className="main-title">{d.name || "(無題)"}</h2>
              {d.description && <p className="nf-m-0 nf-text-muted nf-pre-wrap">{d.description}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { listDashboards } from "../analytics/analyticsStore.js";
import { useAsyncResource } from "../../app/hooks/useAsyncResource.js";
import { useFolderBrowser } from "../folders/useFolderBrowser.js";
import FolderSearchBar from "../folders/FolderSearchBar.jsx";
import FolderBreadcrumbs from "../folders/FolderBreadcrumbs.jsx";
import FolderCard from "../folders/FolderCard.jsx";

export default function HomeDashboards({ resetNonce = 0 }) {
  const navigate = useNavigate();
  const { data: dashboards, loading, error } = useAsyncResource(
    () => listDashboards(),
    [],
  );

  const items = useMemo(() => dashboards || [], [dashboards]);
  const browser = useFolderBrowser(items, {
    getFolder: (d) => d.folder,
    getName: (d) => d.name || "",
  });

  // 親（HomePage）のタブ再クリックでルート（すべて）へ戻し検索も空にする。
  useEffect(() => {
    if (resetNonce > 0) {
      browser.goTo("");
      browser.setQuery("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  if (error) return <p className="nf-text-warning">{error}</p>;
  if (loading) return <p className="nf-text-subtle">読み込み中...</p>;
  if (items.length === 0) {
    return <p className="nf-text-subtle">ダッシュボードがありません。</p>;
  }

  return (
    <div className="nf-col nf-gap-12">
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
              onClick={() => navigate(`/dashboards/${d.id}`)}
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

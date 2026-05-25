import React from "react";

/**
 * フォルダのパンくず。ルート（ホーム）と各セグメントをクリックして移動できる。
 * 検索中（searching=true）や currentPath が空のときは非表示。
 */
export default function FolderBreadcrumbs({ breadcrumbs, onNavigate, rootLabel = "すべて", hidden = false }) {
  if (hidden || !breadcrumbs || breadcrumbs.length === 0) return null;
  return (
    <nav className="folder-breadcrumbs" aria-label="フォルダ階層">
      <button type="button" className="folder-crumb" onClick={() => onNavigate("")}>
        {rootLabel}
      </button>
      {breadcrumbs.map((crumb, idx) => (
        <React.Fragment key={crumb.path}>
          <span className="folder-crumb-sep">/</span>
          {idx === breadcrumbs.length - 1 ? (
            <span className="folder-crumb folder-crumb-current">{crumb.name}</span>
          ) : (
            <button type="button" className="folder-crumb" onClick={() => onNavigate(crumb.path)}>
              {crumb.name}
            </button>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

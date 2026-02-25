import React from "react";

export default function SearchToolbar({ query, onChange, lastSyncedAt, useCache, cacheDisabled, backgroundLoading }) {
  return (
    <div className="search-bar">
      <input
        type="search"
        placeholder="キーワード検索"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        className="search-input nf-flex-1-0-220"
      />
      <span className="nf-text-subtle nf-text-12">
        最終更新: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "未取得"} {useCache ? "(キャッシュ)" : cacheDisabled ? "(キャッシュ無効)" : ""}
        {backgroundLoading ? <span className="nf-text-primary-strong nf-ml-6 nf-fw-600">🔄 最新データを取得中...</span> : ""}
      </span>
    </div>
  );
}

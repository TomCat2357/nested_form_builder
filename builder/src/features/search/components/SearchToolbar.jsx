import React from "react";
import { theme } from "../../../app/theme/tokens.js";

export default function SearchToolbar({ query, onChange, lastSyncedAt, useCache, cacheDisabled }) {
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
      </span>
    </div>
  );
}

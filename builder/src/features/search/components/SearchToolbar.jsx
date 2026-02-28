import React from "react";
import { formatUnixMsDateTimeSec } from "../../../utils/dateTime.js";

export default function SearchToolbar({ query, onChange, lastSyncedAt, useCache, cacheDisabled, backgroundLoading, lockWaiting, hasUnsynced }) {
  const lastSyncedLabel = lastSyncedAt ? (formatUnixMsDateTimeSec(lastSyncedAt) || "未取得") : "未取得";
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
        最終更新: {lastSyncedLabel} {useCache ? "(キャッシュ)" : cacheDisabled ? "(キャッシュ無効)" : ""}
        {lockWaiting ? <span className="nf-text-primary-strong nf-ml-6 nf-fw-600">🔒 ロック解除待ち...</span> : ""}
        {backgroundLoading ? <span className="nf-text-primary-strong nf-ml-6 nf-fw-600">🔄 最新データを取得中...</span> : ""}
        {hasUnsynced ? <span className="nf-text-warning nf-ml-6 nf-fw-600">⚠️ サーバーに未送信の変更があります</span> : ""}
      </span>
    </div>
  );
}

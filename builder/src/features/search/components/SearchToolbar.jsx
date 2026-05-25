import React from "react";
import { formatUnixMsDateTimeSec } from "../../../utils/dateTime.js";

export default function SearchToolbar({ query, onChange, lastSyncedAt, useCache, cacheDisabled, backgroundLoading, lockWaiting, hasUnsynced, unsyncedCount = 0, syncInProgress = false, showSearch = true, onSettingsClick, filterError }) {
  const lastSyncedLabel = lastSyncedAt ? (formatUnixMsDateTimeSec(lastSyncedAt) || "未取得") : "未取得";
  return (
    <div className="search-bar">
      {showSearch && (
        <input
          type="search"
          placeholder="検索（正規表現）: 田中 / 氏名:^山田 / 年齢>=20  （WHERE・SEARCH で厳密検索も可）"
          value={query}
          onChange={(event) => onChange(event.target.value)}
          className="search-input nf-flex-1-0-220"
          title="検索ボックス"
        />
      )}
      {filterError && (
        <span className="nf-text-warning nf-ml-6 nf-fw-600" title={filterError}>⚠️ 検索式エラー</span>
      )}
      {onSettingsClick && (
        <button type="button" className="nf-btn nf-btn-compact nf-btn-secondary" onClick={onSettingsClick} title="表示設定">
          表示設定
        </button>
      )}
      <span className="nf-text-subtle nf-text-12">
        最終更新: {lastSyncedLabel} {useCache ? "(キャッシュ)" : cacheDisabled ? "(キャッシュ無効)" : ""}
        {lockWaiting ? <span className="nf-text-primary-strong nf-ml-6 nf-fw-600">🔒 ロック解除待ち...</span> : ""}
        {(syncInProgress || backgroundLoading) ? <span className="nf-text-primary-strong nf-ml-6 nf-fw-600">🔄 同期中</span> : ""}
        {hasUnsynced ? <span className="nf-text-warning nf-ml-6 nf-fw-600">⚠️ 未アップロードあり（{unsyncedCount}件）</span> : ""}
      </span>
    </div>
  );
}

import React from "react";
import { formatUnixMsDateTimeSec } from "../../../utils/dateTime.js";
import { useDebouncedSearchInput } from "../useDebouncedSearchInput.js";

export default function SearchToolbar({ query, onChange, lastSyncedAt, useCache, cacheDisabled, backgroundLoading, lockWaiting, hasUnsynced, unsyncedCount = 0, syncInProgress = false, showSearch = true, onSettingsClick, filterError, debounceMs = 0, manualSearch = false }) {
  const lastSyncedLabel = lastSyncedAt ? (formatUnixMsDateTimeSec(lastSyncedAt) || "未取得") : "未取得";
  const { inputValue, handleChange, handleCompositionStart, handleCompositionEnd, commitNow } = useDebouncedSearchInput({
    value: query,
    onCommit: onChange,
    delayMs: debounceMs,
    manual: manualSearch,
  });
  return (
    <div className="search-bar">
      {showSearch && (
        <input
          type="search"
          placeholder="検索（正規表現）: 田中 / 氏名:^山田 / 年齢>=20  （WHERE・SEARCH で厳密検索も可）"
          value={inputValue}
          onChange={(event) => handleChange(event.target.value)}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={(event) => handleCompositionEnd(event.target.value)}
          onKeyDown={manualSearch ? (event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) commitNow();
          } : undefined}
          className="search-input nf-flex-1-0-220"
          title="検索ボックス"
        />
      )}
      {manualSearch && showSearch && (
        <button type="button" className="nf-btn nf-btn-compact nf-btn-primary" onClick={commitNow} title="検索を実行">
          検索
        </button>
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

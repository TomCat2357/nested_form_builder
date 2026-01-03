import React from "react";
import { inputStyle, searchBarStyle } from "../searchStyles.js";
import { theme } from "../../../app/theme/tokens.js";

export default function SearchToolbar({ query, onChange, lastSyncedAt, useCache, cacheDisabled }) {
  return (
    <div style={searchBarStyle}>
      <input
        type="search"
        placeholder="キーワード検索"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        style={{ ...inputStyle, flex: "1 0 220px" }}
      />
      <span style={{ color: theme.textSubtle, fontSize: 12 }}>
        最終更新: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "未取得"} {useCache ? "(キャッシュ)" : cacheDisabled ? "(キャッシュ無効)" : ""}
      </span>
    </div>
  );
}

import React from "react";
import { sidebarButtonStyle } from "../searchStyles.js";
import { theme } from "../../../app/theme/tokens.js";

export default function SearchSidebar({
  onCreate,
  onDelete,
  onRefresh,
  useCache,
  loading,
  selectedCount,
}) {
  return (
    <>
      <button type="button" style={sidebarButtonStyle} onClick={onCreate}>
        新規入力
      </button>
      <button
        type="button"
        style={{
          ...sidebarButtonStyle,
          borderColor: theme.dangerBorder,
          background: theme.dangerWeak,
        }}
        onClick={onDelete}
        disabled={selectedCount === 0}
      >
        削除
      </button>
      <button
        type="button"
        style={{
          ...sidebarButtonStyle,
          background: useCache ? theme.warningWeak : theme.surface,
          borderColor: useCache ? theme.warning : theme.borderStrong,
        }}
        onClick={onRefresh}
        disabled={loading}
        title={useCache ? "キャッシュから表示中 - クリックで最新データを取得" : "最新データを取得"}
      >
        {useCache ? "🔄 更新" : "更新"}
      </button>
    </>
  );
}

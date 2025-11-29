import React from "react";
import { sidebarButtonStyle } from "../searchStyles.js";

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
          borderColor: "#FCA5A5",
          background: "#FEF2F2",
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
          background: useCache ? "#FEF3C7" : "#fff",
          borderColor: useCache ? "#F59E0B" : "#CBD5E1",
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

import React from "react";
export default function SearchSidebar({
  onCreate,
  onConfig,
  onDelete,
  onRefresh,
  useCache,
  loading,
  selectedCount,
}) {
  return (
    <>
      <button type="button" className="search-input search-sidebar-btn" onClick={onCreate}>
        新規入力
      </button>
      {onConfig && (
        <button type="button" className="search-input search-sidebar-btn" onClick={onConfig}>
          設定
        </button>
      )}
      <button
        type="button"
        className="search-input search-sidebar-btn search-sidebar-btn-danger"
        onClick={onDelete}
        disabled={selectedCount === 0}
      >
        削除
      </button>
      <button
        type="button"
        className={`search-input search-sidebar-btn${useCache ? " search-sidebar-btn-warning" : ""}`}
        onClick={onRefresh}
        disabled={loading}
        title={useCache ? "キャッシュから表示中 - クリックで最新データを取得" : "最新データを取得"}
      >
        {"🔄 更新"}
      </button>
    </>
  );
}

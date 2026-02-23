import React from "react";
export default function SearchSidebar({
  onBack,
  showBack,
  onCreate,
  onConfig,
  onDelete,
  onRefresh,
  onExport,
  useCache,
  loading,
  exporting,
  selectedCount,
  filteredCount,
}) {
  return (
    <>
      {showBack && onBack && (
        <button type="button" className="search-input search-sidebar-btn" onClick={onBack}>
          ← 戻る
        </button>
      )}
      <button type="button" className="search-input search-sidebar-btn" onClick={onCreate}>
        新規入力
      </button>
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
      <button
        type="button"
        className="search-input search-sidebar-btn"
        onClick={onExport}
        disabled={exporting || filteredCount === 0}
        title={filteredCount === 0 ? "出力するデータがありません" : `検索結果 ${filteredCount} 件を出力`}
      >
        {exporting ? "出力中..." : "検索結果を出力"}
      </button>
      {onConfig && (
        <button type="button" className="search-input search-sidebar-btn" onClick={onConfig}>
          設定
        </button>
      )}
    </>
  );
}

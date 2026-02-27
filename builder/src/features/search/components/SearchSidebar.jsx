import React from "react";
const SidebarButton = ({ onClick, disabled, className = "", title, children }) => (
  <button type="button" className={`search-input search-sidebar-btn ${className}`} onClick={onClick} disabled={disabled} title={title}>
    {children}
  </button>
);

export default function SearchSidebar({
  onBack, showBack, onCreate, onConfig, onDelete, onRefresh, onExport,
  useCache, refreshBusy, refreshDisabled, exporting, selectedCount, filteredCount,
}) {
  const buttons = [
    showBack && onBack && { label: "← 戻る", onClick: onBack },
    { label: "新規入力", onClick: onCreate },
    { label: "削除", onClick: onDelete, disabled: selectedCount === 0, className: "search-sidebar-btn-danger" },
    { label: refreshBusy ? "🔄 更新中..." : "🔄 更新", onClick: onRefresh, disabled: refreshDisabled, className: useCache && !refreshBusy ? "search-sidebar-btn-warning" : "", title: useCache ? "キャッシュから表示中 - クリックで最新データを取得" : "最新データを取得" },
    { label: exporting ? "出力中..." : "検索結果を出力", onClick: onExport, disabled: exporting || filteredCount === 0, title: filteredCount === 0 ? "出力するデータがありません" : `検索結果 ${filteredCount} 件を出力` },
    onConfig && { label: "設定", onClick: onConfig }
  ].filter(Boolean);

  return (
    <>
      {buttons.map((btn, idx) => (
        <SidebarButton key={idx} {...btn}>{btn.label}</SidebarButton>
      ))}
    </>
  );
}

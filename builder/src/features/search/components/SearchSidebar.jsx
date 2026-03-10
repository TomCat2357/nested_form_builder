import React from "react";
const SidebarButton = ({ onClick, disabled, className = "", title, children }) => (
  <button type="button" className={`search-input search-sidebar-btn ${className}`} onClick={onClick} disabled={disabled} title={title}>
    {children}
  </button>
);

export default function SearchSidebar({
  onBack, showBack, onCreate, onConfig, onDelete, onUndelete, onPrint, onRefresh, onExport,
  useCache, refreshBusy, refreshDisabled, exporting, selectedCount, filteredCount,
  isUndoDelete, printing,
}) {
  const deleteBtn = isUndoDelete
    ? { label: "削除取消し", onClick: onUndelete, disabled: selectedCount === 0, className: "search-sidebar-btn-warning" }
    : { label: "削除", onClick: onDelete, disabled: selectedCount === 0, className: "search-sidebar-btn-danger" };
  const buttons = [
    showBack && onBack && { label: "← 戻る", onClick: onBack },
    { label: "新規入力", onClick: onCreate },
    deleteBtn,
    onPrint && {
      label: printing ? "作成中..." : "印刷フォームを作成",
      onClick: onPrint,
      disabled: printing,
      title: selectedCount === 0 ? "印刷するレコードを選択してください" : `選択中の${selectedCount}件を印刷フォームとして作成`,
    },
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

export const buildSearchSidebarButtons = ({
  onBack,
  showBack,
  onCreate,
  onConfig,
  onDelete,
  onUndelete,
  onPrint,
  onRefresh,
  onExport,
  useCache,
  refreshBusy,
  refreshDisabled,
  exporting,
  selectedCount,
  filteredCount,
  isUndoDelete,
  printing,
}) => {
  const deleteBtn = isUndoDelete
    ? { label: "削除取消し", onClick: onUndelete, disabled: selectedCount === 0, className: "search-sidebar-btn-warning" }
    : { label: "削除", onClick: onDelete, disabled: selectedCount === 0, className: "search-sidebar-btn-danger" };

  return [
    showBack && onBack && { label: "← 戻る", onClick: onBack },
    { label: "新規入力", onClick: onCreate },
    deleteBtn,
    { label: refreshBusy ? "🔄 更新中..." : "🔄 更新", onClick: onRefresh, disabled: refreshDisabled, className: useCache && !refreshBusy ? "search-sidebar-btn-warning" : "", title: useCache ? "キャッシュから表示中 - クリックで最新データを取得" : "最新データを取得" },
    { label: exporting ? "出力中..." : "検索結果を出力", onClick: onExport, disabled: exporting || filteredCount === 0, title: filteredCount === 0 ? "出力するデータがありません" : `検索結果 ${filteredCount} 件を出力` },
    onPrint && {
      label: printing ? "出力中..." : "印刷様式を出力",
      onClick: onPrint,
      disabled: printing,
      title: selectedCount === 0 ? "出力するレコードを選択してください" : `選択中の${selectedCount}件を印刷様式として出力`,
    },
    onConfig && { label: "設定", onClick: onConfig },
  ].filter(Boolean);
};

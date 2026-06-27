// ポップアップブロック等で例外が出ても無言で続行する新規タブ起動。
// 戻り値の window ハンドルを使う用途（後から navigate する pendingTab 等）には使わないこと。
export const openInNewTab = (url) => {
  try { window.open(url, "_blank", "noopener,noreferrer"); } catch (_e) { /* noop */ }
};

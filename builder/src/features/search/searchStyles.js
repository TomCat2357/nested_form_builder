import { theme } from "../../app/theme/tokens.js";

// 共通スタイル定義: Searchページで使用するUIの見た目を一元管理

export const createTableStyle = (maxWidth) => ({
  width: maxWidth ? `${maxWidth}px` : "100%",
  borderCollapse: "collapse",
  background: theme.surface,
  borderRadius: theme.radiusMd,
  overflow: "hidden",
});

export const thStyle = {
  textAlign: "left",
  padding: "12px 16px",
  borderBottom: `1px solid ${theme.border}`,
  background: theme.surfaceSubtle,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export const tdStyle = {
  padding: "12px 16px",
  borderBottom: `1px solid ${theme.borderSubtle}`,
  fontSize: 13,
  color: theme.textStrong,
  verticalAlign: "top",
};

export const searchBarStyle = {
  display: "flex",
  gap: 12,
  marginBottom: 16,
  flexWrap: "wrap",
  alignItems: "center",
};

export const inputStyle = {
  padding: "8px 12px",
  borderRadius: 8,
  border: `1px solid ${theme.borderStrong}`,
  background: theme.surface,
  fontSize: 14,
};

export const sidebarButtonStyle = {
  ...inputStyle,
  width: "100%",
  textAlign: "left",
};

export const paginationInfoStyle = {
  color: theme.textSubtle,
  fontSize: 13,
};

export const paginationContainerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginTop: 16,
};

export const paginationNavStyle = {
  display: "flex",
  gap: 8,
};

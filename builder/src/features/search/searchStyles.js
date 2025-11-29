// 共通スタイル定義: Searchページで使用するUIの見た目を一元管理

export const createTableStyle = (maxWidth) => ({
  width: maxWidth ? `${maxWidth}px` : "100%",
  borderCollapse: "collapse",
  background: "#fff",
  borderRadius: 12,
  overflow: "hidden",
});

export const thStyle = {
  textAlign: "left",
  padding: "12px 16px",
  borderBottom: "1px solid #E5E7EB",
  background: "#F8FAFC",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export const tdStyle = {
  padding: "12px 16px",
  borderBottom: "1px solid #F1F5F9",
  fontSize: 13,
  color: "#1F2937",
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
  border: "1px solid #CBD5E1",
  background: "#fff",
  fontSize: 14,
};

export const sidebarButtonStyle = {
  ...inputStyle,
  width: "100%",
  textAlign: "left",
};

export const paginationInfoStyle = {
  color: "#6B7280",
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

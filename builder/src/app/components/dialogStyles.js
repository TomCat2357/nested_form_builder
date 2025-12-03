export const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

export const dialogStyle = {
  width: "min(420px, 90vw)",
  background: "#fff",
  borderRadius: 12,
  boxShadow: "0 20px 45px rgba(15, 23, 42, 0.25)",
  padding: "24px 24px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

export const titleStyle = { margin: 0, fontSize: 18, fontWeight: 600 };
export const baseMessageStyle = { margin: 0, fontSize: 14, color: "#334155", lineHeight: 1.6 };
export const footerStyle = { display: "flex", justifyContent: "flex-end", gap: 8 };

export const baseButtonStyle = {
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 14,
  cursor: "pointer",
  border: "1px solid #CBD5E1",
  background: "#fff",
};

const buttonVariantStyles = {
  primary: { background: "#2563EB", borderColor: "#2563EB", color: "#fff" },
  danger: { background: "#DC2626", borderColor: "#DC2626", color: "#fff" },
};

export const getButtonStyle = (variant) => ({
  ...baseButtonStyle,
  ...(buttonVariantStyles[variant] || {}),
});

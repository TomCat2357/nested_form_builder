import { theme } from "../theme/tokens.js";

export const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: theme.overlay,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

export const dialogStyle = {
  width: "min(420px, 90vw)",
  background: theme.surface,
  borderRadius: theme.radiusMd,
  boxShadow: theme.shadowLg,
  padding: "24px 24px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

export const titleStyle = { margin: 0, fontSize: 18, fontWeight: 600 };
export const footerStyle = { display: "flex", justifyContent: "flex-end", gap: 8 };

export const baseButtonStyle = {
  borderRadius: theme.radiusSm,
  padding: "8px 14px",
  fontSize: 14,
  cursor: "pointer",
  border: `1px solid ${theme.borderStrong}`,
  background: theme.surface,
};

export const messageStyle = { margin: 0, fontSize: 14, color: theme.textMuted, lineHeight: 1.6 };

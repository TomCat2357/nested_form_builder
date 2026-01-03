import { theme } from "../../app/theme/tokens.js";

export const styles = {
  input: { width: "100%", boxSizing: "border-box", border: `1px solid ${theme.borderStrong}`, borderRadius: theme.radiusSm, padding: 8, background: theme.surface, color: theme.text },
  btn: { border: `1px solid ${theme.borderStrong}`, background: theme.surfaceSubtle, padding: "8px 12px", borderRadius: theme.radiusSm, cursor: "pointer", color: theme.text },
  btnDanger: { border: `1px solid ${theme.dangerBorderStrong}`, background: theme.dangerWeakStrong, padding: "8px 12px", borderRadius: theme.radiusSm, cursor: "pointer", color: theme.text },
  child: { borderLeft: `2px solid ${theme.border}`, paddingLeft: 12, marginTop: 8 },
  card: (depth = 0) => ({
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusMd,
    padding: 12,
    marginBottom: 12,
    boxShadow: depth > 0 ? theme.shadowSm : "none",
    background: theme.surface,
  }),
};

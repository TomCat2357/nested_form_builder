export const styles = {
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #CBD5E1", borderRadius: 8, padding: 8 },
  btn: { border: "1px solid #CBD5E1", background: "#F8FAFC", padding: "8px 12px", borderRadius: 8, cursor: "pointer" },
  btnDanger: { border: "1px solid #FECACA", background: "#FEE2E2", padding: "8px 12px", borderRadius: 8, cursor: "pointer" },
  child: { borderLeft: "2px solid #E5E7EB", paddingLeft: 12, marginTop: 8 },
  card: (depth = 0) => ({
    border: "1px solid #E5E7EB",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    boxShadow: depth > 0 ? "0 2px 8px rgba(0,0,0,.05)" : "none",
    background: "#fff",
  }),
};

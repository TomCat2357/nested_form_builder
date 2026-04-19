export const styles = {
  input: { className: "nf-input" },
  btn: { className: "nf-btn" },
  btnDanger: { className: "nf-btn nf-btn-danger" },
  child: { className: "nf-child" },
  card: (depth = 0, isSelected = false) => ({
    className: "nf-card",
    "data-depth": String(depth),
    "data-selected": isSelected ? "true" : "false",
  }),
};

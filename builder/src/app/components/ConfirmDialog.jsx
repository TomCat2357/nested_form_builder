import React from "react";
import BaseDialog from "./BaseDialog.jsx";

const getVariantClass = (variant) => {
  if (variant === "primary") return "primary";
  if (variant === "danger") return "danger";
  return "";
};

export default function ConfirmDialog({ open, title, message, options = [] }) {
  const footer = options.map((option) => (
    <button
      key={option.value}
      type="button"
      className={`dialog-btn ${getVariantClass(option.variant)}`}
      onClick={option.onSelect}
    >
      {option.label}
    </button>
  ));

  return (
    <BaseDialog open={open} title={title} footer={footer}>
      {message && <p className="dialog-message">{message}</p>}
    </BaseDialog>
  );
}

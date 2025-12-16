import React from "react";
import { footerStyle, getButtonStyle } from "./dialogStyles.js";

export default function DialogActions({ actions }) {
  if (!actions?.length) return null;

  return (
    <div style={footerStyle}>
      {actions.map((action, index) => {
        const { label, variant, onClick, onSelect, value } = action;
        const key = value ?? label ?? index;
        const handler = onClick || onSelect;

        return (
          <button
            key={key}
            type="button"
            style={getButtonStyle(variant)}
            onClick={handler}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

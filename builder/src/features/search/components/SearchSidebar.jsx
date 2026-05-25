import React from "react";
import { buildSearchSidebarButtons } from "./SearchSidebar.buttons.js";

const SidebarButton = ({ onClick, disabled, className = "", title, style, children }) => (
  <button type="button" className={`search-input search-sidebar-btn ${className}`} onClick={onClick} disabled={disabled} title={title} style={style}>
    {children}
  </button>
);

export default function SearchSidebar(props) {
  const buttons = buildSearchSidebarButtons(props);

  return (
    <>
      {buttons.map((btn, idx) => (
        <SidebarButton key={idx} {...btn}>{btn.label}</SidebarButton>
      ))}
    </>
  );
}

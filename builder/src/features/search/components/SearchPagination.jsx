import React from "react";
import { inputStyle, paginationContainerStyle, paginationInfoStyle, paginationNavStyle } from "../searchStyles.js";

export default function SearchPagination({ page, totalPages, totalEntries, startIndex, endIndex, onChange }) {
  return (
    <div style={paginationContainerStyle}>
      <span style={paginationInfoStyle}>
        {totalEntries} 件中 {startIndex} - {endIndex} 件
      </span>
      <div style={paginationNavStyle}>
        <button type="button" style={inputStyle} disabled={page <= 1} onClick={() => onChange(page - 1)}>
          前へ
        </button>
        <span style={{ lineHeight: "32px" }}>
          {page} / {totalPages}
        </span>
        <button type="button" style={inputStyle} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          次へ
        </button>
      </div>
    </div>
  );
}

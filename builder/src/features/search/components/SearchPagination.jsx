import React from "react";
export default function SearchPagination({ page, totalPages, totalEntries, startIndex, endIndex, onChange }) {
  return (
    <div className="search-pagination">
      <span className="search-pagination-info">
        {totalEntries} 件中 {startIndex} - {endIndex} 件
      </span>
      <div className="search-pagination-nav">
        <button type="button" className="search-input" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          前へ
        </button>
        <span className="search-pagination-page">
          {page} / {totalPages}
        </span>
        <button type="button" className="search-input" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          次へ
        </button>
      </div>
    </div>
  );
}

import React, { useState, useMemo } from "react";
import { sortAndFilterOptions } from "./searchableSelectOptions.js";

/**
 * 検索入力付きのネイティブ select。候補をフォルダ→名前順に並べ、上の検索ボックスで絞り込む。
 * options: { value, label, folder }[]（label = 表示かつ検索対象、folder = ソート用）
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "",
  searchPlaceholder = "名前で絞り込み...",
  style,
  selectStyle,
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () => sortAndFilterOptions(options, query, value),
    [options, query, value]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", ...style }}>
      <input
        type="text"
        className="nf-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={searchPlaceholder}
      />
      <select
        className="nf-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      >
        <option value="">{placeholder}</option>
        {visible.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

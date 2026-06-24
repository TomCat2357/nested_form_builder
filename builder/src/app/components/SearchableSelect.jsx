import React, { useState, useMemo } from "react";
import { sortAndFilterOptions } from "./searchableSelectOptions.js";
import { useDebouncedSearchInput } from "../../features/search/useDebouncedSearchInput.js";

/**
 * 検索入力付きのネイティブ select。候補をフォルダ→名前順に並べ、上の検索ボックスで絞り込む。
 * options: { value, label, folder }[]（label = 表示かつ検索対象、folder = ソート用）
 *
 * 絞り込みの確定は useDebouncedSearchInput に委譲する。入力表示は即時、絞り込み（query）への
 * 反映だけを遅延・IME 制御する：IME 変換中は確定（compositionend）まで絞り込みを churn させず、
 * searchDebounceMs>0 のときは大きな候補リストでも入力の取りこぼしを抑える。既定 0 は従来どおり
 * 非 IME 入力で即時反映（挙動不変）だが、IME 確定待ちだけは全利用箇所で有効になる。
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "",
  searchPlaceholder = "名前で絞り込み...",
  searchDebounceMs = 0,
  style,
  selectStyle,
}) {
  const [query, setQuery] = useState("");
  const { inputValue, handleChange, handleCompositionStart, handleCompositionEnd } =
    useDebouncedSearchInput({ value: query, onCommit: setQuery, delayMs: searchDebounceMs });
  const visible = useMemo(
    () => sortAndFilterOptions(options, query, value),
    [options, query, value]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", ...style }}>
      <input
        type="text"
        className="nf-input"
        value={inputValue}
        onChange={(e) => handleChange(e.target.value)}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={(e) => handleCompositionEnd(e.target.value)}
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

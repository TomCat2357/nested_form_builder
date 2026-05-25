import React from "react";

/**
 * フォルダ一覧画面共通の検索バー。名前に正規表現（部分一致・大文字小文字無視）を当てる。
 */
export default function FolderSearchBar({ value, onChange, placeholder }) {
  return (
    <div className="folder-search-bar">
      <input
        type="search"
        className="search-input nf-flex-1-0-220"
        placeholder={placeholder || "名前で検索（例: 売上。正規表現も可）"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

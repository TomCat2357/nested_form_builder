import React from "react";

/**
 * テーブル型一覧（管理画面）でフォルダを表す行。クリックで中に入る。
 * selectable=true のとき先頭にチェックボックス列を出す（フォルダ選択用）。
 */
export default function FolderRow({ name, count, colSpan, onOpen, selectable = false, selected = false, onToggle }) {
  if (!selectable) {
    return (
      <tr className="admin-row folder-row" data-clickable="true" onClick={onOpen}>
        <td className="search-td" colSpan={colSpan}>
          <span className="folder-icon" aria-hidden="true">📁</span>
          <span className="nf-fw-600">{name}</span>
          <span className="folder-count">{count}</span>
        </td>
      </tr>
    );
  }

  return (
    <tr className="admin-row folder-row" data-clickable="true" onClick={onOpen}>
      <td className="search-td" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={() => onToggle && onToggle()} />
      </td>
      <td className="search-td" colSpan={colSpan - 1}>
        <span className="folder-icon" aria-hidden="true">📁</span>
        <span className="nf-fw-600">{name}</span>
        <span className="folder-count">{count}</span>
      </td>
    </tr>
  );
}

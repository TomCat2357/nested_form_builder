import React from "react";

/**
 * カード型一覧（ホーム画面）でフォルダを表すカード。クリックで中に入る。
 */
export default function FolderCard({ name, count, onOpen }) {
  return (
    <div className="main-card folder-card" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}>
      <h2 className="main-title">
        <span className="folder-icon" aria-hidden="true">📁</span>
        {name}
        <span className="folder-count">{count}</span>
      </h2>
    </div>
  );
}

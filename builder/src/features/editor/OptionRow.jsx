import React from "react";
import { styles as s } from "./styles.js";

export default function OptionRow({ option, onChange, onDelete, onFocus, isSelected, onAddChild, childrenArea, canAddChild = true }) {
  return (
    <div className="nf-option-row" data-selected={isSelected ? "true" : "false"}>
      <div className="nf-row nf-gap-8">
        <button type="button" onClick={onDelete} className="nf-btn nf-btn-danger nf-btn-compact">削除</button>
        <input
          className={s.input.className}
          placeholder="選択肢"
          value={option.label}
          onChange={(event) => onChange({ ...option, label: event.target.value })}
          onFocus={onFocus}
        />
        <button type="button" onClick={onAddChild} className="nf-btn" disabled={!canAddChild}>子質問追加</button>
      </div>
      {childrenArea}
    </div>
  );
}

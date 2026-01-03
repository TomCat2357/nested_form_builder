import React from "react";
import { styles as s } from "./styles.js";
import { theme } from "../../app/theme/tokens.js";

export default function OptionRow({ option, onChange, onDelete, onFocus, isSelected, onAddChild, childrenArea, canAddChild = true }) {
  return (
    <div style={{ border: isSelected ? `2px solid ${theme.primary}` : `1px solid ${theme.border}`, borderRadius: theme.radiusSm, padding: 8, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" onClick={onDelete} style={{ ...s.btnDanger, padding: "4px 8px", fontSize: 12, flexShrink: 0 }}>削除</button>
        <input
          style={{ ...s.input, flex: 1 }}
          placeholder="選択肢"
          value={option.label}
          onChange={(event) => onChange({ ...option, label: event.target.value })}
          onFocus={onFocus}
        />
        <button type="button" onClick={onAddChild} style={{ ...s.btn, flexShrink: 0 }} disabled={!canAddChild}>子質問追加</button>
      </div>
      {childrenArea}
    </div>
  );
}

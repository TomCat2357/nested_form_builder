import { ensureArray } from "../../utils/arrays.js";
import React, { useEffect, useMemo } from "react";
import BaseDialog from "./BaseDialog.jsx";
import { useSetSelection } from "../hooks/useSetSelection.js";

const hasBranchChildren = (field) => {
  const branches = field?.childrenByValue;
  if (branches && typeof branches === "object"
      && Object.values(branches).some((children) => Array.isArray(children) && children.length > 0)) {
    return true;
  }
  return Array.isArray(field?.children) && field.children.length > 0;
};

export default function RecordCopyDialog({ open, schema, sourceResponses, onConfirm, onCancel }) {
  const items = useMemo(
    () =>
      (ensureArray(schema))
        .map((field, index) => {
          const id = typeof field?.id === "string" ? field.id.trim() : "";
          if (!id || field?.type === "message") return null;
          return {
            id,
            index: index + 1,
            label: (field?.label || "").trim() || `質問 ${index + 1}`,
            hasChildren: hasBranchChildren(field),
            hasValue: Object.prototype.hasOwnProperty.call(sourceResponses || {}, id),
          };
        })
        .filter(Boolean),
    [schema, sourceResponses],
  );

  const { selected, toggle, selectAll, clear } = useSetSelection();

  useEffect(() => {
    if (!open) return;
    selectAll(items.map((item) => item.id));
  }, [open, items, selectAll]);

  const allChecked = items.length > 0 && selected.size === items.length;
  // schema 順を保って選択 ID を取り出す（Set の挿入順に依存しない）。
  const selectedFieldIds = items.filter((item) => selected.has(item.id)).map((item) => item.id);

  const toggleAll = (checked) => {
    if (checked) selectAll(items.map((item) => item.id));
    else clear();
  };

  const footer = (
    <>
      <button type="button" className="dialog-btn" onClick={onCancel}>
        キャンセル
      </button>
      <button
        type="button"
        className="dialog-btn primary"
        disabled={selectedFieldIds.length === 0}
        onClick={() => onConfirm(selectedFieldIds)}
      >
        コピー
      </button>
    </>
  );

  return (
    <BaseDialog open={open} title="コピーする項目を選択" footer={footer}>
      <p className="dialog-message">コピー元レコードから反映したい項目を選択してください。</p>
      {items.length > 0 ? (
        <div className="record-copy-dialog">
          <label className="record-copy-dialog__toggle">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(event) => toggleAll(event.target.checked)}
            />
            <span>全チェック</span>
          </label>
          <ul className="record-copy-dialog__list">
            {items.map((item) => (
              <li key={item.id} className="record-copy-dialog__row">
                <label className="record-copy-dialog__item">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="record-copy-dialog__index">{item.index}.</span>
                  <span className="record-copy-dialog__label">{item.label}</span>
                  {item.hasChildren && <span className="record-copy-dialog__branch">+</span>}
                  {!item.hasValue && <span className="record-copy-dialog__empty">未回答</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="dialog-message">コピー可能な項目がありません。</p>
      )}
    </BaseDialog>
  );
}

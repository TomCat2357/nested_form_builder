import React, { useEffect, useMemo, useState } from "react";
import BaseDialog from "./BaseDialog.jsx";

const hasBranchChildren = (field) => {
  const branches = field?.childrenByValue;
  if (!branches || typeof branches !== "object") return false;
  return Object.values(branches).some((children) => Array.isArray(children) && children.length > 0);
};

export default function RecordCopyDialog({ open, schema, sourceResponses, onConfirm, onCancel }) {
  const items = useMemo(
    () =>
      (Array.isArray(schema) ? schema : [])
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

  const [selectedFieldIds, setSelectedFieldIds] = useState([]);

  useEffect(() => {
    if (!open) return;
    setSelectedFieldIds(items.map((item) => item.id));
  }, [open, items]);

  const allChecked = items.length > 0 && selectedFieldIds.length === items.length;

  const toggleAll = (checked) => {
    if (checked) {
      setSelectedFieldIds(items.map((item) => item.id));
    } else {
      setSelectedFieldIds([]);
    }
  };

  const toggleItem = (fieldId) => {
    setSelectedFieldIds((prev) => (
      prev.includes(fieldId)
        ? prev.filter((id) => id !== fieldId)
        : [...prev, fieldId]
    ));
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
                    checked={selectedFieldIds.includes(item.id)}
                    onChange={() => toggleItem(item.id)}
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

import React, { useEffect, useMemo, useState } from "react";
import BaseDialog from "../../../app/components/BaseDialog.jsx";

export default function PrintChildFormDialog({
  open,
  childForms,
  onCancel,
  onSubmit,
}) {
  const childFormIds = useMemo(
    () => (childForms || []).map((childForm) => String(childForm?.childFormId || "")).filter(Boolean),
    [childForms],
  );
  const [selectedIds, setSelectedIds] = useState(new Set(childFormIds));

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set(childFormIds));
  }, [childFormIds, open]);

  const allChecked = childFormIds.length > 0 && childFormIds.every((childFormId) => selectedIds.has(childFormId));

  const toggleAll = (checked) => {
    setSelectedIds(checked ? new Set(childFormIds) : new Set());
  };

  const toggleOne = (childFormId, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(childFormId);
      else next.delete(childFormId);
      return next;
    });
  };

  const footer = [
    <button key="cancel" type="button" className="dialog-btn" onClick={onCancel}>
      キャンセル
    </button>,
    <button
      key="submit"
      type="button"
      className="dialog-btn primary"
      onClick={() => onSubmit(Array.from(selectedIds))}
    >
      印刷を実行
    </button>,
  ];

  return (
    <BaseDialog open={open} title="印刷対象の子フォームを選択" footer={footer}>
      <div className="print-child-form-dialog">
        <label className="nf-row nf-gap-8 nf-items-center nf-fw-600">
          <input type="checkbox" checked={allChecked} onChange={(event) => toggleAll(event.target.checked)} />
          <span>全チェック / 全解除</span>
        </label>
        <div className="print-child-form-dialog__list">
          {(childForms || []).map((childForm) => {
            const childFormId = String(childForm?.childFormId || "");
            const title = childForm?.formTitle || childForm?.form?.settings?.formTitle || childFormId;
            return (
              <label key={childFormId} className="nf-row nf-gap-8 nf-items-center">
                <input
                  type="checkbox"
                  checked={selectedIds.has(childFormId)}
                  onChange={(event) => toggleOne(childFormId, event.target.checked)}
                />
                <span>{title}</span>
              </label>
            );
          })}
        </div>
      </div>
    </BaseDialog>
  );
}

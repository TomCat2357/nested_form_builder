import React from "react";
import { deepClone, normalizeSchemaIDs } from "../../core/schema.js";
import { genId } from "../../core/ids.js";
import { styles as s } from "./styles.js";

export default function NonChoiceChildrenSection({
  field,
  onChange,
  canAddChild,
  depth,
  QuestionListComponent,
  onQuestionControlChange,
  getTempState,
  setTempState,
  clearTempState,
}) {
  const handleAddChild = () => {
    if (!canAddChild) return;
    const next = deepClone(field);
    const existing = Array.isArray(next.children) ? next.children : [];
    next.children = normalizeSchemaIDs([...existing, { id: genId(), type: "text", label: "" }]);
    onChange(next);
  };

  const hasChildren = Array.isArray(field.children) && field.children.length > 0;

  return (
    <div className="nf-mt-8">
      <div className="nf-row-between nf-mb-6">
        <strong>子質問（値が入力されたとき表示）</strong>
        <button
          type="button"
          className={s.btn.className}
          onClick={handleAddChild}
          disabled={!canAddChild}
        >
          子質問を追加
        </button>
      </div>
      {hasChildren && (
        <div className={s.child.className}>
          <QuestionListComponent
            fields={field.children}
            onChange={(childFields) => {
              const next = deepClone(field);
              next.children = normalizeSchemaIDs(childFields);
              onChange(next);
            }}
            depth={depth + 1}
            onQuestionControlChange={onQuestionControlChange}
            getTempState={getTempState}
            setTempState={setTempState}
            clearTempState={clearTempState}
          />
        </div>
      )}
    </div>
  );
}

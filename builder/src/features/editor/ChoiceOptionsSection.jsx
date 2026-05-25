import React from "react";
import { deepClone, normalizeSchemaIDs } from "../../core/schema.js";
import { genId } from "../../core/ids.js";
import { styles as s } from "./styles.js";
import OptionRow from "./OptionRow.jsx";

export default function ChoiceOptionsSection({
  field,
  onChange,
  onFocus,
  canAddChild,
  depth,
  selectedOptionIndex,
  setSelectedOptionIndex,
  buildOptionControlInfo,
  updateChoiceDefaultSelection,
  QuestionListComponent,
  onQuestionControlChange,
  getTempState,
  setTempState,
  clearTempState,
}) {
  const handleAddOption = () => {
    const next = deepClone(field);
    next.options = next.options || [];
    next.options.push({ id: genId(), label: "", defaultSelected: false });
    onChange(next);
  };

  const handleOptionChange = (index, nextOpt) => {
    const next = deepClone(field);
    const opt = field.options[index];
    const prevLabel = opt.label || "";
    const nextLabel = nextOpt.label || "";
    next.options[index] = {
      id: nextOpt.id || genId(),
      label: nextLabel,
      defaultSelected: !!nextOpt.defaultSelected,
    };

    if (prevLabel !== nextLabel && next.childrenByValue?.[prevLabel]) {
      next.childrenByValue = { ...next.childrenByValue };
      const movedChildren = next.childrenByValue[prevLabel];
      const existing = next.childrenByValue[nextLabel];
      next.childrenByValue[nextLabel] = existing
        ? normalizeSchemaIDs([...movedChildren, ...existing])
        : movedChildren;
      delete next.childrenByValue[prevLabel];
    }
    onChange(next);
  };

  const handleOptionDelete = (index) => {
    const next = deepClone(field);
    next.options.splice(index, 1);
    onChange(next);
    if (selectedOptionIndex === index) {
      setSelectedOptionIndex(null);
    } else if (selectedOptionIndex > index) {
      setSelectedOptionIndex(selectedOptionIndex - 1);
    }
  };

  const handleOptionFocus = (index) => {
    setSelectedOptionIndex(index);
    const controlInfo = buildOptionControlInfo(index);
    if (controlInfo) onFocus(controlInfo);
  };

  const handleAddChild = (opt) => {
    if (!canAddChild) return;
    const next = deepClone(field);
    next.childrenByValue = next.childrenByValue || {};
    const key = opt.label;
    next.childrenByValue[key] = normalizeSchemaIDs(next.childrenByValue[key] || []);
    next.childrenByValue[key].push({ id: genId(), type: "text", label: "" });
    onChange(next);
  };

  const renderChildrenArea = (opt) => {
    const hasChildren = field.childrenByValue && field.childrenByValue[opt.label]?.length;
    if (!hasChildren) return null;
    return (
      <div className={s.child.className}>
        <QuestionListComponent
          fields={field.childrenByValue[opt.label]}
          onChange={(childFields) => {
            const next = deepClone(field);
            next.childrenByValue[opt.label] = normalizeSchemaIDs(childFields);
            onChange(next);
          }}
          depth={depth + 1}
          onQuestionControlChange={onQuestionControlChange}
          getTempState={getTempState}
          setTempState={setTempState}
          clearTempState={clearTempState}
        />
      </div>
    );
  };

  return (
    <div className="nf-mt-8">
      <div className="nf-row-between nf-mb-6">
        <strong>選択肢</strong>
        <button type="button" className={s.btn.className} onClick={handleAddOption}>
          選択肢を追加
        </button>
      </div>

      {(field.options || []).map((opt, index) => (
        <OptionRow
          key={opt.id}
          option={opt}
          onChange={(nextOpt) => handleOptionChange(index, nextOpt)}
          onDelete={() => handleOptionDelete(index)}
          onFocus={() => handleOptionFocus(index)}
          isSelected={selectedOptionIndex === index}
          onAddChild={() => handleAddChild(opt)}
          canAddChild={canAddChild}
          defaultSelectionControl={
            <label className="nf-row nf-gap-4 nf-nowrap">
              <input
                type="checkbox"
                checked={!!opt.defaultSelected}
                onChange={(event) => updateChoiceDefaultSelection(index, event.target.checked)}
                onFocus={() => handleOptionFocus(index)}
              />
              初期選択
            </label>
          }
          childrenArea={renderChildrenArea(opt)}
        />
      ))}
    </div>
  );
}

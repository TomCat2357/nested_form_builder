import React from "react";
import { deepClone } from "../../core/schema.js";

export function useQuestionCardOptions({ field, onChange, onFocus, isChoice }) {
  const [selectedOptionIndex, setSelectedOptionIndex] = React.useState(null);
  const latestFieldRef = React.useRef(field);
  const latestOnChangeRef = React.useRef(onChange);
  latestFieldRef.current = field;
  latestOnChangeRef.current = onChange;

  const moveOptionUp = (index) => {
    const currentField = latestFieldRef.current;
    if (!Array.isArray(currentField?.options)) return;
    if (index <= 0 || index >= currentField.options.length) return;
    const next = deepClone(currentField);
    [next.options[index - 1], next.options[index]] = [next.options[index], next.options[index - 1]];
    latestOnChangeRef.current(next);
    setSelectedOptionIndex(index - 1);
  };

  const moveOptionDown = (index) => {
    const currentField = latestFieldRef.current;
    if (!Array.isArray(currentField?.options)) return;
    if (index < 0 || index >= currentField.options.length - 1) return;
    const next = deepClone(currentField);
    [next.options[index], next.options[index + 1]] = [next.options[index + 1], next.options[index]];
    latestOnChangeRef.current(next);
    setSelectedOptionIndex(index + 1);
  };

  const buildOptionControlInfo = React.useCallback((index) => {
    const currentField = latestFieldRef.current;
    const options = Array.isArray(currentField?.options) ? currentField.options : [];
    if (index === null || index < 0 || index >= options.length) return null;
    return {
      type: "option",
      optionIndex: index,
      optionLabel: options[index]?.label || `選択肢 ${index + 1}`,
      canMoveUp: index > 0,
      canMoveDown: index < options.length - 1,
      moveUp: () => moveOptionUp(index),
      moveDown: () => moveOptionDown(index),
    };
  }, []);

  React.useEffect(() => {
    if (isChoice && selectedOptionIndex !== null) {
      const controlInfo = buildOptionControlInfo(selectedOptionIndex);
      if (controlInfo) onFocus(controlInfo);
    }
  }, [selectedOptionIndex, isChoice, field.options?.length, buildOptionControlInfo]);

  const updateChoiceDefaultSelection = (optionIndex, checked) => {
    const next = deepClone(field);
    next.options = (next.options || []).map((opt, index) => {
      if (field.type === "checkboxes") {
        return { ...opt, defaultSelected: index === optionIndex ? checked : !!opt.defaultSelected };
      }
      return { ...opt, defaultSelected: checked && index === optionIndex };
    });
    onChange(next);
  };

  return {
    selectedOptionIndex,
    setSelectedOptionIndex,
    moveOptionUp,
    moveOptionDown,
    buildOptionControlInfo,
    updateChoiceDefaultSelection,
  };
}

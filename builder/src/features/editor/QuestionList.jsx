import React from "react";
import { deepClone, normalizeSchemaIDs, validateMaxDepth, MAX_DEPTH } from "../../core/schema.js";
import { genId } from "../../core/ids.js";
import QuestionCard from "./QuestionCard.jsx";
import AlertDialog from "../../app/components/AlertDialog.jsx";
import { useAlert } from "../../app/hooks/useAlert.js";

/**
 * スキーマのバリデーションを実行
 * 入力中は深さチェックのみ行い、重複チェックは保存時のみ実施
 * @returns {object} { ok: boolean, error: string | null }
 */
function validateSchema(schema) {
  const depthResult = validateMaxDepth(schema, MAX_DEPTH);
  if (!depthResult.ok) {
    return { ok: false, error: `入れ子(キー)の深さは ${MAX_DEPTH} 段までです(現在: ${depthResult.depth} 段)。` };
  }

  return { ok: true, error: null };
}

/**
 * 配列の要素を入れ替える
 */
function swapItems(array, index1, index2) {
  const next = deepClone(array);
  [next[index1], next[index2]] = [next[index2], next[index1]];
  return next;
}

/**
 * 質問制御情報を生成
 */
function buildQuestionControlInfo(selectedIndex, normalized, moveUp, moveDown) {
  if (selectedIndex === null) {
    return {
      selectedIndex: null,
      questionLabel: null,
      canMoveUp: false,
      canMoveDown: false,
      moveUp: () => {},
      moveDown: () => {},
      isOption: false
    };
  }

  const questionLabel = normalized[selectedIndex]?.label || `質問 ${selectedIndex + 1}`;
  const canMoveUp = selectedIndex > 0;
  const canMoveDown = selectedIndex < normalized.length - 1;

  return {
    selectedIndex,
    questionLabel,
    canMoveUp,
    canMoveDown,
    moveUp: () => moveUp(selectedIndex),
    moveDown: () => moveDown(selectedIndex),
    isOption: false
  };
}

/**
 * 選択肢制御情報を生成
 */
function buildOptionControlInfo(selectedIndex, optionControl, normalized) {
  const questionLabel = selectedIndex !== null ? normalized[selectedIndex]?.label || `質問 ${selectedIndex + 1}` : null;

  return {
    selectedIndex,
    questionLabel,
    canMoveUp: optionControl.canMoveUp,
    canMoveDown: optionControl.canMoveDown,
    moveUp: optionControl.moveUp,
    moveDown: optionControl.moveDown,
    isOption: true,
    optionIndex: optionControl.optionIndex,
    optionLabel: optionControl.optionLabel
  };
}

export default function QuestionList({ fields, onChange, depth = 1, onQuestionControlChange }) {
  const { alertState, showAlert, closeAlert } = useAlert();
  const normalized = normalizeSchemaIDs(fields);
  const [selectedIndex, setSelectedIndex] = React.useState(null);
  const [optionControl, setOptionControl] = React.useState(null);

  React.useEffect(() => {
    if (depth === 1 && onQuestionControlChange) {
      let controlInfo;

      // 選択肢が選択されている場合は、選択肢の制御情報を使う
      if (optionControl && optionControl.type === 'option') {
        controlInfo = buildOptionControlInfo(selectedIndex, optionControl, normalized);
      } else {
        // 質問が選択されている場合
        controlInfo = buildQuestionControlInfo(selectedIndex, normalized, moveUp, moveDown);
      }

      onQuestionControlChange(controlInfo);
    }
  }, [selectedIndex, optionControl, normalized.length, depth]);

  const commit = (next) => {
    const fixed = normalizeSchemaIDs(next);
    const validation = validateSchema(fixed);
    if (!validation.ok) {
      showAlert(validation.error);
      return;
    }
    onChange(fixed);
  };

  const setOne = (index, field) => {
    const next = deepClone(normalized);
    next[index] = field.id ? field : { ...field, id: genId() };
    commit(next);
  };

  const insertAfter = (index) => {
    const next = deepClone(normalized);
    next.splice(index + 1, 0, { id: genId(), type: "text", label: "" });
    commit(next);
  };

  const removeOne = (index) => {
    const next = deepClone(normalized);
    next.splice(index, 1);
    commit(next);
    if (selectedIndex === index) {
      setSelectedIndex(null);
    } else if (selectedIndex > index) {
      setSelectedIndex(selectedIndex - 1);
    }
  };

  const moveUp = (index) => {
    if (index === 0) return;
    const next = swapItems(normalized, index - 1, index);
    commit(next);
    if (selectedIndex === index) {
      setSelectedIndex(index - 1);
    } else if (selectedIndex === index - 1) {
      setSelectedIndex(index);
    }
  };

  const moveDown = (index) => {
    if (index === normalized.length - 1) return;
    const next = swapItems(normalized, index, index + 1);
    commit(next);
    if (selectedIndex === index) {
      setSelectedIndex(index + 1);
    } else if (selectedIndex === index + 1) {
      setSelectedIndex(index);
    }
  };

  const canMoveUp = selectedIndex !== null && selectedIndex > 0;
  const canMoveDown = selectedIndex !== null && selectedIndex < normalized.length - 1;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {normalized.map((field, index) => (
          <QuestionCard
            key={field.id}
            field={field}
            onChange={(nextField) => setOne(index, nextField)}
            onAddBelow={() => insertAfter(index)}
            onDelete={() => removeOne(index)}
            onFocus={(controlInfo) => {
              if (controlInfo && typeof controlInfo === 'object') {
                // 選択肢が選択された場合
                setSelectedIndex(index);
                setOptionControl(controlInfo);
              } else {
                // 質問が選択された場合
                setSelectedIndex(index);
                setOptionControl(null);
              }
            }}
            isSelected={selectedIndex === index}
            QuestionListComponent={QuestionList}
            depth={depth}
          />
        ))}
      </div>
      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </>
  );
}

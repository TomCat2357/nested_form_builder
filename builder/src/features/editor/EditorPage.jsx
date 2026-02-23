import React from "react";
import QuestionList from "./QuestionList.jsx";
import { normalizeSchemaIDs } from "../../core/schema.js";
import { styles as s } from "./styles.js";
import { genId } from "../../core/ids.js";

function collectFieldIds(fields, ids = new Set()) {
  (fields || []).forEach((field) => {
    if (!field || typeof field !== "object") return;
    if (field.id) ids.add(field.id);
    if (field.childrenByValue && typeof field.childrenByValue === "object") {
      Object.values(field.childrenByValue).forEach((children) => {
        collectFieldIds(children, ids);
      });
    }
  });
  return ids;
}

/**
 * フォームエディターのメインページ
 * 質問リストを管理
 */
export default function EditorPage({ schema, onSchemaChange, onQuestionControlChange }) {
  const tempUiStateRef = React.useRef(new Map());

  const getTempState = React.useCallback((fieldId) => {
    if (!fieldId) return null;
    return tempUiStateRef.current.get(fieldId) || null;
  }, []);

  const setTempState = React.useCallback((fieldId, partialState) => {
    if (!fieldId || !partialState || typeof partialState !== "object") return;
    const current = tempUiStateRef.current.get(fieldId) || {};
    const nextState = { ...current, ...partialState };
    Object.keys(nextState).forEach((key) => {
      if (nextState[key] === undefined) delete nextState[key];
    });
    if (Object.keys(nextState).length === 0) {
      tempUiStateRef.current.delete(fieldId);
      return;
    }
    tempUiStateRef.current.set(fieldId, nextState);
  }, []);

  const clearTempState = React.useCallback((fieldId) => {
    if (!fieldId) return;
    tempUiStateRef.current.delete(fieldId);
  }, []);

  React.useEffect(() => {
    const aliveIds = collectFieldIds(schema || []);
    Array.from(tempUiStateRef.current.keys()).forEach((fieldId) => {
      if (!aliveIds.has(fieldId)) {
        tempUiStateRef.current.delete(fieldId);
      }
    });
  }, [schema]);

  /**
   * 新しい質問を追加
   */
  const handleAddQuestion = () => {
    const next = normalizeSchemaIDs([...(schema || [])]);
    next.push({ id: genId(), type: "text", label: "" });
    onSchemaChange(next);
  };

  return (
    <div>
      <QuestionList
        fields={schema}
        onChange={onSchemaChange}
        onQuestionControlChange={onQuestionControlChange}
        getTempState={getTempState}
        setTempState={setTempState}
        clearTempState={clearTempState}
      />
      <div className="nf-row-center nf-mt-12">
        <button type="button" className={s.btn.className} onClick={handleAddQuestion}>質問を追加</button>
      </div>
    </div>
  );
}

import React from "react";
import QuestionList from "./QuestionList.jsx";
import { normalizeSchemaIDs } from "../../core/schema.js";
import { styles as s } from "./styles.js";
import SettingsPanel from "../export/SettingsPanel.jsx";
import { genId } from "../../core/ids.js";

/**
 * フォームエディターのメインページ
 * 設定パネルと質問リストを管理
 */
export default function EditorPage({ schema, onSchemaChange, settings, onSettingsChange, onQuestionControlChange }) {
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
      <SettingsPanel
        settings={settings}
        onSettingsChange={(key, value) => {
          onSettingsChange(key, value);
        }}
      />
      <QuestionList fields={schema} onChange={onSchemaChange} onQuestionControlChange={onQuestionControlChange} />
      <div className="nf-row-center nf-mt-12">
        <button type="button" className={s.btn.className} onClick={handleAddQuestion}>質問を追加</button>
      </div>
    </div>
  );
}

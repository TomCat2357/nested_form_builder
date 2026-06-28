import React from "react";
import AppLayout from "../../app/components/AppLayout.jsx";
import ConfirmDialog from "../../app/components/ConfirmDialog.jsx";
import { useTempIdRedirect } from "../../app/hooks/useTempIdRedirect.js";
import VisualizePanel from "../../features/analytics/components/VisualizePanel.jsx";
import { buildQuestionEditPath } from "./questionEditorState.js";
import { QuestionMetaFields, QueryModeFieldset, QuestionGuiPanel, QuestionSqlPanel } from "./questionEditorComponents.jsx";
import { useQuestionEditor } from "./useQuestionEditor.js";

export default function QuestionEditorPage() {
  const editor = useQuestionEditor();
  // 一時 ID のままディープリンクで開かれた場合、アップロード完了後に実 ID の URL へ置き換える。
  useTempIdRedirect(editor.questionId, buildQuestionEditPath);

  const {
    isAdmin,
    questionId,
    location,
    forms,
    activeForms,
    name, setName,
    folder, setFolder,
    driveFileUrl,
    mode,
    sql, setSql,
    gui, setGui,
    selectedFormId, setSelectedFormId,
    formColumns,
    columnLoadError,
    selectedColumnKey, setSelectedColumnKey,
    copiedToken,
    vizType, setVizType,
    xField, setXField,
    yFields, setYFields,
    heatmap, setHeatmap,
    vizOptions, setVizOptions,
    viz,
    queryResult,
    running,
    runError,
    saving,
    saveError,
    loading,
    copyToken,
    handleGuiFormChange,
    handleRunQuery,
    handleSave,
    handleSwitchToSql,
    handleSwitchToGui,
    handleBack,
    goBack,
    unsavedDialog,
  } = editor;

  const confirmOptions = [
    {
      label: "保存して続行",
      value: "save",
      variant: "primary",
      onSelect: async () => {
        unsavedDialog.close();
        await handleSave();
      },
    },
    {
      label: "保存せずに戻る",
      value: "discard",
      onSelect: () => {
        unsavedDialog.close();
        goBack();
      },
    },
    {
      label: "キャンセル",
      value: "cancel",
      onSelect: unsavedDialog.close,
    },
  ];

  if (!isAdmin) return null;

  return (
    <AppLayout
      title={questionId ? "Question 編集" : "Question 作成"}
      fallbackPath={location.state?.from || "/admin/questions"}
      onBack={handleBack}
      sidebarActions={
        <button type="button" onClick={handleSave} disabled={saving} className="nf-btn-outline nf-btn-sidebar">
          {saving ? "保存中..." : "保存"}
        </button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {loading && <p className="nf-text-subtle">読み込み中...</p>}
        {saveError && <p className="nf-text-warning">{saveError}</p>}

        <QuestionMetaFields
          name={name}
          onNameChange={setName}
          folder={folder}
          onFolderChange={setFolder}
          questionId={questionId}
          driveFileUrl={driveFileUrl}
        />

        <QueryModeFieldset
          mode={mode}
          onSwitchToGui={handleSwitchToGui}
          onSwitchToSql={handleSwitchToSql}
        />

        {mode === "gui" ? (
          <QuestionGuiPanel
            gui={gui}
            onGuiChange={setGui}
            formColumns={formColumns}
            activeForms={activeForms}
            onFormChange={handleGuiFormChange}
            columnLoadError={columnLoadError}
            running={running}
            onRun={handleRunQuery}
          />
        ) : (
          <QuestionSqlPanel
            selectedFormId={selectedFormId}
            onSelectedFormIdChange={setSelectedFormId}
            activeForms={activeForms}
            forms={forms}
            formColumns={formColumns}
            selectedColumnKey={selectedColumnKey}
            onSelectedColumnKeyChange={setSelectedColumnKey}
            copiedToken={copiedToken}
            onCopyToken={copyToken}
            sql={sql}
            onSqlChange={setSql}
            running={running}
            onRun={handleRunQuery}
          />
        )}

        {runError && <p className="nf-text-warning">{runError}</p>}

        <VisualizePanel
          vizType={vizType}
          xField={xField}
          yFields={yFields}
          onVizTypeChange={setVizType}
          onXFieldChange={setXField}
          onYFieldsChange={setYFields}
          result={queryResult}
          viz={viz}
          compiledColumns={queryResult?.compiledColumns || null}
          heatmap={heatmap}
          onHeatmapChange={setHeatmap}
          vizOptions={vizOptions}
          onVizOptionsChange={setVizOptions}
        />
      </div>
      <ConfirmDialog
        open={unsavedDialog.state.open}
        title="未保存の変更があります"
        message="保存せずに離れますか？"
        options={confirmOptions}
      />
    </AppLayout>
  );
}

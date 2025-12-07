import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import EditorPage from "../editor/EditorPage.jsx";
import PreviewPage from "../preview/PreviewPage.jsx";
import SearchPreviewPanel from "./SearchPreviewPanel.jsx";
import { useBuilderSettings } from "../settings/settingsStore.js";
import { normalizeSchemaIDs, validateMaxDepth, validateRequiredLabels, validateUniqueLabels, MAX_DEPTH } from "../../core/schema.js";
import { runSelfTests } from "../../core/selfTests.js";
import AlertDialog from "../../app/components/AlertDialog.jsx";
import { useAlert } from "../../app/hooks/useAlert.js";

const containerStyle = { border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff", padding: 16 };
const toolbarButtonStyle = (active) => ({
  border: "1px solid #CBD5E1",
  background: active ? "#DBEAFE" : "#F8FAFC",
  padding: "8px 12px",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: active ? 600 : 500,
});

const shallowEqual = (a, b) => {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || !a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (error) {
    return false;
  }
};

const FormBuilderWorkspace = React.forwardRef(function FormBuilderWorkspace(
  { initialSchema, initialSettings, formTitle, onSave, onDirtyChange, showToolbarSave = true },
  ref,
) {
  const { alertState, showAlert, closeAlert } = useAlert();
  const [activeTab, setActiveTab] = useState("editor");
  const [schema, setSchema] = useState(() => normalizeSchemaIDs(initialSchema || []));
  const [responses, setResponses] = useState({});
  const { settings, replaceSettings, updateSetting } = useBuilderSettings();
  const initialSchemaRef = useRef(null);
  const initialSettingsRef = useRef(null);
  const [questionControl, setQuestionControl] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    runSelfTests();
  }, []);

  // initialSchema/initialSettingsが変わったら、リセット
  useEffect(() => {
    const normalized = normalizeSchemaIDs(initialSchema || []);
    setSchema(normalized);
    // replaceSettingsはマージ後の値を返すので、それを初期値として記録
    const mergedSettings = replaceSettings(initialSettings || {});

    initialSchemaRef.current = normalized;
    initialSettingsRef.current = mergedSettings;
    setIsInitialized(true);
    onDirtyChange?.(false);
  }, [initialSchema, initialSettings, replaceSettings, onDirtyChange]);

  // schema/settingsが変わったらdirty判定（初期化完了後のみ）
  useEffect(() => {
    if (!isInitialized) {
      return;
    }
    if (initialSchemaRef.current === null || initialSettingsRef.current === null) {
      return;
    }

    const schemaDirty = !shallowEqual(initialSchemaRef.current, schema);
    const settingsDirty = !shallowEqual(initialSettingsRef.current, settings);

    onDirtyChange?.(schemaDirty || settingsDirty);
  }, [schema, settings, isInitialized, onDirtyChange]);

  const handleSchemaChange = (nextSchema) => {
    const normalized = normalizeSchemaIDs(nextSchema);
    const depthCheck = validateMaxDepth(normalized, MAX_DEPTH);
    if (!depthCheck.ok) {
      showAlert(`入れ子（キー）の深さは ${MAX_DEPTH} 段までです（現在: ${depthCheck.depth} 段）。`);
      return;
    }
    setSchema(normalized);
  };

  const handleSave = useCallback(() => {
    const requiredCheck = validateRequiredLabels(
      schema,
      { responses: activeTab === "preview" ? responses : null, visibleOnly: activeTab === "preview" }
    );
    if (!requiredCheck.ok) {
      showAlert("項目名は入力必須です。すべての質問に名前を入力してください。");
      return false;
    }

    const uniqueCheck = validateUniqueLabels(schema);
    if (!uniqueCheck.ok) {
      showAlert(`重複する項目名: ${uniqueCheck.dup}`);
      return false;
    }

    initialSchemaRef.current = schema;
    initialSettingsRef.current = settings;
    onDirtyChange?.(false);
    onSave?.({ schema, settings });
    return true;
  }, [onSave, schema, settings, onDirtyChange, showAlert, activeTab, responses]);

  useImperativeHandle(
    ref,
    () => ({
      save: handleSave,
      getSchema: () => schema,
      getSettings: () => settings,
      setMode: setActiveTab,
      getQuestionControl: () => questionControl,
    }),
    [handleSave, schema, settings, questionControl],
  );

  const previewSettings = useMemo(() => ({ ...settings, formTitle }), [settings, formTitle]);

  return (
    <div style={containerStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{formTitle || "フォーム"}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" style={toolbarButtonStyle(activeTab === "editor")} onClick={() => setActiveTab("editor")}>
            編集
          </button>
          <button type="button" style={toolbarButtonStyle(activeTab === "preview")} onClick={() => setActiveTab("preview")}>
            プレビュー
          </button>
          {showToolbarSave && (
            <button type="button" style={toolbarButtonStyle(false)} onClick={handleSave}>
              保存
            </button>
          )}
        </div>
      </div>

      {activeTab === "editor" && (
        <EditorPage schema={schema} onSchemaChange={handleSchemaChange} settings={settings} onSettingsChange={updateSetting} onQuestionControlChange={setQuestionControl} />
      )}

      {activeTab === "preview" && (
        <>
          <PreviewPage
            schema={schema}
            responses={responses}
            setResponses={setResponses}
            settings={previewSettings}
            showOutputJson={false}
            showSaveButton={false}
          />
          <SearchPreviewPanel schema={schema} responses={responses} settings={settings} />
        </>
      )}
      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </div>
  );
});

export default FormBuilderWorkspace;

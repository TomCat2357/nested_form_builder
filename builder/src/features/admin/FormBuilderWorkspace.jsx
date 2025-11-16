import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import EditorPage from "../editor/EditorPage.jsx";
import PreviewPage from "../preview/PreviewPage.jsx";
import SearchPreviewPanel from "./SearchPreviewPanel.jsx";
import { useBuilderSettings } from "../settings/settingsStore.js";
import { normalizeSchemaIDs, validateMaxDepth, MAX_DEPTH } from "../../core/schema.js";
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
    console.warn("shallowEqual fallback", error);
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
    console.log('[FormBuilderWorkspace] initialSchema/initialSettings changed');
    console.log('  initialSettings:', initialSettings);
    const normalized = normalizeSchemaIDs(initialSchema || []);
    setSchema(normalized);
    replaceSettings(initialSettings || {});

    initialSchemaRef.current = normalized;
    setIsInitialized(false); // 初期化フラグをリセット
    console.log('  isInitialized set to false');
  }, [initialSchema, initialSettings, replaceSettings]);

  // settingsが更新されたら初期値を記録（初期化時のみ）
  useEffect(() => {
    console.log('[FormBuilderWorkspace] settings updated:', { isInitialized, settings });
    if (!isInitialized && settings) {
      console.log('  Recording initial settings:', settings);
      initialSettingsRef.current = settings;
      setIsInitialized(true);
      onDirtyChange?.(false);
      console.log('  isInitialized set to true, dirty=false');
    }
  }, [settings, isInitialized, onDirtyChange]);

  // schema/settingsが変わったらdirty判定（初期化完了後のみ）
  useEffect(() => {
    console.log('[FormBuilderWorkspace] dirty check:', { isInitialized, hasInitialSchema: initialSchemaRef.current !== null, hasInitialSettings: initialSettingsRef.current !== null });
    if (!isInitialized) {
      console.log('  Skipping: not initialized');
      return;
    }
    if (initialSchemaRef.current === null || initialSettingsRef.current === null) {
      console.log('  Skipping: no initial values');
      return;
    }

    const schemaDirty = !shallowEqual(initialSchemaRef.current, schema);
    const settingsDirty = !shallowEqual(initialSettingsRef.current, settings);
    const dirty = schemaDirty || settingsDirty;

    console.log('  Schema dirty:', schemaDirty);
    if (schemaDirty) {
      console.log('  Initial schema:', JSON.stringify(initialSchemaRef.current));
      console.log('  Current schema:', JSON.stringify(schema));
    }
    console.log('  Settings dirty:', settingsDirty);
    console.log('  Initial settings:', initialSettingsRef.current);
    console.log('  Current settings:', settings);
    console.log('  Overall dirty:', dirty);

    onDirtyChange?.(dirty);
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
    initialSchemaRef.current = schema;
    initialSettingsRef.current = settings;
    onDirtyChange?.(false);
    onSave?.({ schema, settings });
  }, [onSave, schema, settings, onDirtyChange]);

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
          <SearchPreviewPanel schema={schema} responses={responses} />
        </>
      )}
      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </div>
  );
});

export default FormBuilderWorkspace;

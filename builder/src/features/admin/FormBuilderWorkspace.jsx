import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import EditorPage from "../editor/EditorPage.jsx";
import PreviewPage from "../preview/PreviewPage.jsx";
import SearchPreviewPanel from "./SearchPreviewPanel.jsx";
import { useBuilderSettings } from "../settings/settingsStore.js";
import { normalizeSchemaIDs, validateMaxDepth, validateUniqueLabels, MAX_DEPTH } from "../../core/schema.js";
import { runSelfTests } from "../../core/selfTests.js";
import AlertDialog from "../../app/components/AlertDialog.jsx";
import { useAlert } from "../../app/hooks/useAlert.js";

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

const omitThemeSetting = (settings) => {
  if (!settings || typeof settings !== "object") return {};
  const { theme, ...rest } = settings;
  return rest;
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
    const settingsDirty = !shallowEqual(omitThemeSetting(initialSettingsRef.current), omitThemeSetting(settings));

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
  }, [onSave, schema, settings, onDirtyChange, showAlert]);

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
    <div className="form-builder">
      <div className="form-builder-header">
        <div className="form-builder-title">{formTitle || "フォーム"}</div>
        <div className="form-builder-tabs">
          <button type="button" className="form-builder-tab" data-active={activeTab === "editor" ? "true" : "false"} onClick={() => setActiveTab("editor")}>
            編集
          </button>
          <button type="button" className="form-builder-tab" data-active={activeTab === "preview" ? "true" : "false"} onClick={() => setActiveTab("preview")}>
            プレビュー
          </button>
          {showToolbarSave && (
            <button type="button" className="form-builder-tab" data-active="false" onClick={handleSave}>
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

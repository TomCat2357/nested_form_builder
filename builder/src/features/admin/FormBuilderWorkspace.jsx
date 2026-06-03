import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import EditorPage from "../editor/EditorPage.jsx";
import PreviewPage from "../preview/PreviewPage.jsx";
import SearchPreviewPanel from "./SearchPreviewPanel.jsx";
import { DEFAULT_SETTINGS } from "../../core/storage.js";
import { normalizeSchemaIDs, validateMaxDepth, validateRequiredLabels, validateUniqueLabels, validateLabelCharacters, MAX_DEPTH, countSchemaNodes } from "../../core/schema.js";
import { detectCircularReferences, validateSubstitutionTemplates } from "../../core/computedFields.js";
import { runSelfTests } from "../../core/selfTests.js";
import { useAlert } from "../../app/hooks/useAlert.js";
import { useAuth } from "../../app/state/authContext.jsx";
import { omitThemeSetting } from "../../utils/settings.js";
import { deepEqual } from "../../utils/deepEqual.js";

const FormBuilderWorkspace = React.forwardRef(function FormBuilderWorkspace(
  {
    initialSchema,
    initialSettings,
    formTitle,
    onSave,
    onDirtyChange,
    onQuestionControlChange,
    showToolbarSave = true,
  },
  ref,
) {
  const { showAlert } = useAlert();
  const { userName, userEmail, userAffiliation, userTitle, userPhone } = useAuth();
  const [activeTab, setActiveTab] = useState("editor");
  const [schema, setSchema] = useState(() => normalizeSchemaIDs(initialSchema || []));
  const [responses, setResponses] = useState({});
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...(initialSettings || {}) }));
  const updateSetting = useCallback((key, value) => {
    setSettings((prev) => (prev?.[key] === value ? prev : { ...prev, [key]: value }));
  }, []);
  const initialSchemaRef = useRef(null);
  const initialSettingsRef = useRef(null);
  const [questionControl, setQuestionControl] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    runSelfTests();
  }, []);

  // initialSchema/initialSettings が変わったらベースラインを再初期化する。
  // ただし「編集中（内部 schema/settings がベースラインと相違）」のときは、遅延更新などの
  // 外部 props 変化で作業コピーを破棄しない。clean のときだけ取り込む（作業コピーの最終防御線）。
  useEffect(() => {
    const normalized = normalizeSchemaIDs(initialSchema || []);
    const mergedSettings = { ...DEFAULT_SETTINGS, ...(initialSettings || {}) };

    // ベースラインが実質同一なら何もしない（同期チャーンでの不要な再初期化を防ぐ）。
    if (
      initialSchemaRef.current !== null &&
      deepEqual(initialSchemaRef.current, normalized) &&
      deepEqual(omitThemeSetting(initialSettingsRef.current), omitThemeSetting(mergedSettings))
    ) {
      return;
    }

    // 初期化済みで、かつ編集中（内部状態がベースラインと相違）なら上書きしない＝編集を守る。
    if (isInitialized && initialSchemaRef.current !== null) {
      const schemaDirty = !deepEqual(initialSchemaRef.current, schema);
      const settingsDirty = !deepEqual(omitThemeSetting(initialSettingsRef.current), omitThemeSetting(settings));
      if (schemaDirty || settingsDirty) {
        console.log("[FormBuilderWorkspace] keep working copy; skip reset during dirty edit", {
          cachedSchemaNodeCount: countSchemaNodes(schema),
          incomingSchemaNodeCount: countSchemaNodes(normalized),
        });
        return;
      }
    }

    console.log("[FormBuilderWorkspace] reset from incoming props", {
      previousSchemaNodeCount: countSchemaNodes(initialSchemaRef.current),
      nextSchemaNodeCount: countSchemaNodes(normalized),
    });
    setSchema(normalized);
    setSettings((prev) => (deepEqual(prev, mergedSettings) ? prev : mergedSettings));

    initialSchemaRef.current = normalized;
    initialSettingsRef.current = mergedSettings;
    setIsInitialized(true);
    onDirtyChange?.(false);
  }, [initialSchema, initialSettings, onDirtyChange, isInitialized, schema, settings]);

  // schema/settingsが変わったらdirty判定（初期化完了後のみ）
  useEffect(() => {
    if (!isInitialized) {
      return;
    }
    if (initialSchemaRef.current === null || initialSettingsRef.current === null) {
      return;
    }

    const schemaDirty = !deepEqual(initialSchemaRef.current, schema);
    const settingsDirty = !deepEqual(omitThemeSetting(initialSettingsRef.current), omitThemeSetting(settings));

    onDirtyChange?.(schemaDirty || settingsDirty);
  }, [schema, settings, isInitialized, onDirtyChange]);

  useEffect(() => {
    if (activeTab !== "editor") {
      setQuestionControl(null);
      onQuestionControlChange?.(null);
    }
  }, [activeTab, onQuestionControlChange]);

  useEffect(() => {
    if (activeTab === "editor") {
      onQuestionControlChange?.(questionControl);
    }
  }, [activeTab, questionControl, onQuestionControlChange]);

  const handleSchemaChange = (nextSchema) => {
    const normalized = normalizeSchemaIDs(nextSchema);
    const depthCheck = validateMaxDepth(normalized, MAX_DEPTH);
    if (!depthCheck.ok) {
      showAlert(`入れ子（キー）の深さは ${MAX_DEPTH} 段までです（現在: ${depthCheck.depth} 段）。`);
      return;
    }
    setSchema(normalized);
  };

  const commitSavedState = useCallback(() => {
    initialSchemaRef.current = schema;
    initialSettingsRef.current = settings;
    onDirtyChange?.(false);
  }, [schema, settings, onDirtyChange]);

  const handleSave = useCallback(async (options = {}) => {
    const { markClean = true } = options;
    const labelCheck = validateRequiredLabels(schema);
    if (!labelCheck.ok) {
      const items = (labelCheck.emptyLabels || []).map((entry, index) => `${index + 1}. ${entry.path}`).join("\n");
      showAlert(`以下の質問にラベルが設定されていません:\n\n${items}`, "ラベル未設定");
      return false;
    }

    const uniqueCheck = validateUniqueLabels(schema);
    if (!uniqueCheck.ok) {
      showAlert(`重複する項目名: ${uniqueCheck.dup}`);
      return false;
    }

    const charCheck = validateLabelCharacters(schema);
    if (!charCheck.ok) {
      const items = charCheck.invalidLabels
        .map((entry, index) => `${index + 1}. ${entry.path}（"${entry.label}" に使えない文字「${entry.char}」が含まれます）`)
        .join("\n");
      showAlert(`ラベルに使用できない文字が含まれています:\n\n${items}`, "ラベルの不正な文字");
      return false;
    }

    const circularCheck = detectCircularReferences(schema);
    if (circularCheck.hasCycle) {
      showAlert(`循環参照が検出されました: ${circularCheck.cycleFields.join(" → ")}`, "循環参照エラー");
      return false;
    }

    const templateCheck = await validateSubstitutionTemplates(schema);
    if (!templateCheck.ok) {
      const items = templateCheck.invalidTemplates
        .map((entry, index) => `${index + 1}. ${entry.path || entry.label || "(名称未設定)"}\n   ${entry.message}`)
        .join("\n\n");
      showAlert(`置換フィールドの式に文法エラーがあります。修正してから保存してください:\n\n${items}`, "置換式の文法エラー");
      return false;
    }

    if (markClean) {
      commitSavedState();
    }
    onSave?.({ schema, settings });
    return true;
  }, [commitSavedState, onSave, schema, settings, showAlert]);

  useImperativeHandle(
    ref,
    () => ({
      save: handleSave,
      commitSavedState,
      getSchema: () => schema,
      getSettings: () => settings,
      updateSetting: updateSetting,
      setMode: setActiveTab,
      getQuestionControl: () => questionControl,
      // 親（AdminFormEditorPage）が外部更新の取り込み可否を判断するための同期 dirty 判定。
      // 派生フラグの遅延に依存せず、内部状態を直接ベースラインと比較する。
      isDirty: () => {
        if (!isInitialized || initialSchemaRef.current === null) return false;
        const schemaDirty = !deepEqual(initialSchemaRef.current, schema);
        const settingsDirty = !deepEqual(omitThemeSetting(initialSettingsRef.current), omitThemeSetting(settings));
        return schemaDirty || settingsDirty;
      },
    }),
    [handleSave, commitSavedState, schema, settings, updateSetting, questionControl, isInitialized],
  );

  const previewSettings = useMemo(
    () => ({ ...settings, formTitle, userName, userEmail, userAffiliation, userTitle, userPhone }),
    [settings, formTitle, userName, userEmail, userAffiliation, userTitle, userPhone],
  );

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
        <EditorPage
          schema={schema}
          onSchemaChange={handleSchemaChange}
          onQuestionControlChange={setQuestionControl}
        />
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
    </div>
  );
});

export default FormBuilderWorkspace;

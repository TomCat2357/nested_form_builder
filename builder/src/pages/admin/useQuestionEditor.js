// QuestionEditorPage の state・ロード・各種ハンドラを束ねるカスタムフック。
// 元ページから振る舞い（依存配列・分岐・副作用順）を変えずに切り出したもの。
// 戻り値は state 値・setter・ハンドラ・派生値をまとめたオブジェクト。

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useConfirmDialog } from "../../app/hooks/useConfirmDialog.js";
import { useBeforeUnloadGuard } from "../../app/hooks/useBeforeUnloadGuard.js";
import { useDirtyTracking } from "../../app/hooks/useDirtyTracking.js";
import { useCancellable } from "../../app/hooks/useCancellable.js";
import { useAuth } from "../../app/state/authContext.jsx";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { getSheetConfig } from "../../app/state/dataStoreHelpers.js";
import { executeQuestion, saveQuestion, getQuestionById, getFormColumns, ERR_NO_SPREADSHEET } from "../../features/analytics/analyticsStore.js";
import { buildColumnIndex } from "../../features/analytics/utils/columnIdentifierResolver.js";
import { buildFormIndex } from "../../features/analytics/utils/formIdentifierResolver.js";
import { formRefsToNames, canonicalAliasToName } from "../../features/analytics/utils/rewriteSqlFormRefs.js";
import { compileStages } from "../../features/analytics/utils/compileStages.js";
import { normalizeFolderPath } from "../../utils/folderTree.js";
import { buildRunQuery, buildSaveQuery, buildQuestionVisualization } from "./questionEditorPayload.js";
import { emptyGui, emptyVizOptions, questionVisualizationToState, buildVizPreview } from "./questionEditorState.js";

export function useQuestionEditor() {
  const navigate = useNavigate();
  const { questionId } = useParams();
  const location = useLocation();
  const { isAdmin } = useAuth();
  const { forms, loadingForms } = useAppData();
  const isEdit = Boolean(questionId);

  const [mode, setMode] = useState("gui");
  const [name, setName] = useState("");
  const [driveFileUrl, setDriveFileUrl] = useState("");
  // 新規作成時は一覧で開いていたフォルダ (location.state.folder) を初期フォルダにする。
  const [folder, setFolder] = useState(() => isEdit ? "" : normalizeFolderPath(location.state?.folder || ""));
  const [selectedFormId, setSelectedFormId] = useState("");
  const [sql, setSql] = useState("");
  const [gui, setGui] = useState(() => emptyGui(""));
  const [vizType, setVizType] = useState("table");
  const [xField, setXField] = useState("");
  const [yFields, setYFields] = useState("");
  const [heatmap, setHeatmap] = useState({ enabled: false, direction: "column", excludeRows: "", excludeColumns: "", minColor: "", maxColor: "" });
  const [vizOptions, setVizOptions] = useState(() => emptyVizOptions());

  const [queryResult, setQueryResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copiedToken, setCopiedToken] = useState("");
  const [selectedColumnKey, setSelectedColumnKey] = useState("");
  const [definitionLoaded, setDefinitionLoaded] = useState(false);
  const autoRunQuestionIdRef = useRef(null);
  // forms 確定後に questionId ごと 1 回だけロードするためのガード。
  const loadedQuestionIdRef = useRef(null);

  const unsavedDialog = useConfirmDialog();

  useEffect(() => {
    if (!isAdmin) navigate("/", { replace: true });
  }, [isAdmin, navigate]);

  const activeForms = forms.filter((f) => !f.archived && !f.childOnly);

  useCancellable(async (isCancelled) => {
    if (!questionId) return;
    // forms 確定まで待つ（SQL の fileId → フォーム名 置換に formIndex が要る）。
    if (loadingForms) return;
    // questionId ごとに 1 回だけロードする（forms の背景リフレッシュで再ロードして
    // ユーザー編集を潰さないため）。
    if (loadedQuestionIdRef.current === questionId) return;
    loadedQuestionIdRef.current = questionId;
    setLoading(true);
    setDefinitionLoaded(false);
    autoRunQuestionIdRef.current = null;
    try {
      // 編集画面は開くたびにサーバ最新(.json)を取得する（キャッシュは使わない）。
      const q = await getQuestionById(questionId, { forceRefresh: true });
      if (isCancelled()) return;
      if (!q) {
        setLoading(false);
        return;
      }
      setName(q.name || "");
      setFolder(q.folder || "");
      setDriveFileUrl(q.driveFileUrl || "");
      const qMode = q.query?.mode === "gui" ? "gui" : "sql";
      setMode(qMode);
      if (qMode === "gui") {
        const g = q.query.gui;
        setGui(g ? { ...emptyGui(g.formId || ""), ...g } : emptyGui(""));
        setSelectedFormId(g?.formId || "");
      } else {
        // 保存は fileId で持つ方針なので、表示はフォーム名に戻す。
        setSql(formRefsToNames(q.query?.sql || "", buildFormIndex(forms)));
        const fid = q.query?.formSources?.[0]?.formId || "";
        setSelectedFormId(fid);
      }
      const vizState = questionVisualizationToState(q.visualization);
      setVizType(vizState.vizType);
      setXField(vizState.xField);
      setYFields(vizState.yFields);
      setHeatmap(vizState.heatmap);
      setVizOptions(vizState.vizOptions);
      setDefinitionLoaded(true);
      setLoading(false);
    } catch (_e) {
      if (!isCancelled()) setLoading(false);
    }
  }, [questionId, loadingForms]);

  const { formColumns, columnLoadError } = useMemo(() => {
    const fid = mode === "gui" ? gui.formId : selectedFormId;
    if (!fid) return { formColumns: [], columnLoadError: null };
    const targetForm = forms.find((f) => f.id === fid);
    const sheetConfig = targetForm ? getSheetConfig(targetForm) : null;
    if (!sheetConfig) {
      return { formColumns: [], columnLoadError: ERR_NO_SPREADSHEET };
    }
    try {
      // データ形式は view 形式に一本化。GUI / SQL いずれも列メタは getFormColumns（メタ列付き view 形式）。
      const cols = getFormColumns(targetForm);
      return { formColumns: cols, columnLoadError: null };
    } catch (err) {
      return { formColumns: [], columnLoadError: err.message || String(err) };
    }
  }, [mode, gui.formId, selectedFormId, forms]);

  // フォーム切替・未選択・GUI 切替で選択中の列が候補から消えたら選択を解除する。
  useEffect(() => {
    if (selectedColumnKey && !formColumns.some((c) => c.key === selectedColumnKey)) {
      setSelectedColumnKey("");
    }
  }, [formColumns, selectedColumnKey]);

  // 識別子トークンをクリップボードへコピーし、一時的に「コピー済」表示にする（フォーム名 / 列名で共用）。
  const copyToken = useCallback((token) => {
    navigator.clipboard.writeText(token).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(""), 1500);
    }).catch(() => {});
  }, []);

  const handleGuiFormChange = (newFormId) => {
    // フォーム切替時は集計・グループ化・フィルターをリセットする。
    setGui(emptyGui(newFormId));
    setQueryResult(null);
    setVizType("table");
    setXField("");
    setYFields("");
    setHeatmap({ enabled: false, direction: "column" });
    setVizOptions(emptyVizOptions());
  };

  // SQL モード用の formSources 配列を selectedFormId / forms から構築する。
  // 未選択 / フォーム不明時は空配列で通し (SQL 内の `[フォーム名]` 直接参照を許す)、
  // フォームは解決できたがシート未設定のときだけ error を返す。caller 側で表示先 (run/save) を切り替える。
  const buildSqlFormSources = useCallback(() => {
    if (!selectedFormId) return { formSources: [] };
    const form = forms.find((f) => f.id === selectedFormId);
    // 保存済みの formId が現在のフォーム一覧に無い (削除済み等) 場合でも、SQL モードは
    // [フォーム名] 直接参照で実行できるため、未選択扱いにしてエラーを出さない。
    if (!form) return { formSources: [] };
    // レコードは formId 経由で取得するため spreadsheetId は不要。設定済みかだけ確認する。
    if (!getSheetConfig(form)) return { error: ERR_NO_SPREADSHEET };
    return {
      formSources: [{
        formId: form.id,
        alias: "data",
      }],
    };
  }, [selectedFormId, forms]);

  const handleRunQuery = useCallback(async () => {
    setRunning(true);
    setRunError(null);
    setQueryResult(null);

    const run = buildRunQuery({ mode, gui, sql, sources: mode === "sql" ? buildSqlFormSources() : null });
    if (run.skip) { setRunning(false); return; }
    if (run.error) {
      setRunError(run.error);
      setRunning(false);
      return;
    }

    try {
      const result = await executeQuestion({ query: run.query }, { forms });
      if (result.ok) {
        setQueryResult(result);
      } else {
        setRunError(result.error);
      }
    } catch (err) {
      setRunError(err.message || String(err));
    } finally {
      setRunning(false);
    }
  }, [mode, gui, sql, buildSqlFormSources, forms]);

  useEffect(() => {
    if (!questionId) return;
    if (!definitionLoaded) return;
    if (forms.length === 0) return;
    if (autoRunQuestionIdRef.current === questionId) return;
    autoRunQuestionIdRef.current = questionId;
    handleRunQuery();
  }, [questionId, definitionLoaded, forms.length, handleRunQuery]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setSaveError("Question 名を入力してください。"); return; }

    // 参照は fileId（formId）のみで保持する。id 解決失敗時の復旧は中央辞書（論理パス→fileId）に
    // 集約したため、各参照に formName を二重持ちしない。読み込んだ旧 formName は剥がして保存する。
    const saveQuery = buildSaveQuery({
      mode,
      gui,
      sql,
      sources: mode === "sql" ? buildSqlFormSources() : null,
      forms,
    });
    if (saveQuery.error) { setSaveError(saveQuery.error); return; }
    const query = saveQuery.query;

    setSaving(true);
    setSaveError(null);

    const question = {
      // id ＝ Drive fileId。新規はクライアントで採番せず、保存後に GAS が返す fileId を採用する。
      id: questionId || undefined,
      // 旧 ULID id（q_...）が mapping に無い stale ケースでも、GAS が実体ファイルを driveFileUrl から
      // 特定して上書きできるよう実体 URL を保存ペイロードへ載せる（保存 JSON 本文からは除外される）。
      driveFileUrl: driveFileUrl || undefined,
      name: name.trim(),
      folder: normalizeFolderPath(folder),
      schemaVersion: 1,
      query,
      visualization: buildQuestionVisualization({ vizType, xField, yFields, heatmap, vizOptions }),
      modifiedAt: Date.now(),
    };

    try {
      await saveQuestion(question);
      navigate(location.state?.from || "/admin/questions");
    } catch (err) {
      setSaveError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [mode, name, folder, gui, sql, buildSqlFormSources, vizType, xField, yFields, heatmap, vizOptions, questionId, navigate, forms]);

  const handleSwitchToSql = () => {
    if (mode === "sql") return;
    if (!gui.formId) {
      setMode("sql");
      return;
    }
    const compiled = compileStages(gui, { formColumns });
    if (!compiled.ok) {
      window.alert("GUI から SQL への変換に失敗しました: " + compiled.errors.join(" / "));
      return;
    }
    const ok = window.confirm("GUI 状態を SQL に変換して以後 SQL として編集します。GUI へは戻せません。続行しますか？");
    if (!ok) return;
    // compileStages の出力は FROM data_<id>（canonical alias）。手書き SQL と同じく
    // エディタ表示は [フォーム名] に寄せる（保存時に formRefsToIds で fileId へ戻る）。
    setSql(canonicalAliasToName(compiled.sql, gui.formId, buildFormIndex(forms)));
    setSelectedFormId(gui.formId);
    setMode("sql");
  };

  const handleSwitchToGui = () => {
    if (mode === "gui") return;
    if (sql.trim()) {
      const ok = window.confirm("GUI モードに切り替えると現在の SQL は破棄されます。続行しますか？");
      if (!ok) return;
    }
    setGui(emptyGui(selectedFormId));
    setMode("gui");
  };

  const snapshot = useMemo(() => JSON.stringify({
    name, folder, mode, sql, gui, vizType, xField, yFields, heatmap, vizOptions, selectedFormId,
  }), [name, folder, mode, sql, gui, vizType, xField, yFields, heatmap, vizOptions, selectedFormId]);

  const baselineReady = !questionId || definitionLoaded;
  const isDirty = useDirtyTracking(snapshot, baselineReady);

  useBeforeUnloadGuard(isDirty);

  const goBack = useCallback(() => navigate(location.state?.from || "/admin/questions"), [navigate, location.state]);

  const handleBack = () => {
    if (isDirty) {
      unsavedDialog.open();
      return false;
    }
  };

  const defaultForm = forms.find((f) => f.id === (mode === "gui" ? gui.formId : selectedFormId)) || null;
  const defaultColumnIndex = defaultForm ? buildColumnIndex(defaultForm) : null;
  const viz = buildVizPreview({ vizType, xField, yFields, heatmap, vizOptions, columnIndex: defaultColumnIndex });

  return {
    // 認証 / ルーティング
    isAdmin,
    questionId,
    location,
    // 一覧 / フォーム
    forms,
    activeForms,
    // メタ情報
    name, setName,
    folder, setFolder,
    driveFileUrl,
    // モード / クエリ
    mode,
    sql, setSql,
    gui, setGui,
    selectedFormId, setSelectedFormId,
    formColumns,
    columnLoadError,
    selectedColumnKey, setSelectedColumnKey,
    copiedToken,
    // 可視化
    vizType, setVizType,
    xField, setXField,
    yFields, setYFields,
    heatmap, setHeatmap,
    vizOptions, setVizOptions,
    viz,
    queryResult,
    // 状態
    running,
    runError,
    saving,
    saveError,
    loading,
    // ハンドラ
    copyToken,
    handleGuiFormChange,
    handleRunQuery,
    handleSave,
    handleSwitchToSql,
    handleSwitchToGui,
    handleBack,
    goBack,
    // ダイアログ
    unsavedDialog,
  };
}

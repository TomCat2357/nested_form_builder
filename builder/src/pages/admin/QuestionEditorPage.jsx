import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import ConfirmDialog from "../../app/components/ConfirmDialog.jsx";
import { useConfirmDialog } from "../../app/hooks/useConfirmDialog.js";
import { useBeforeUnloadGuard } from "../../app/hooks/useBeforeUnloadGuard.js";
import { useCancellable } from "../../app/hooks/useCancellable.js";
import { useAuth } from "../../app/state/authContext.jsx";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { getSheetConfig } from "../../app/state/dataStoreHelpers.js";
import { executeQuestion, saveQuestion, getQuestionById, getFormColumns, getFormViewColumns, ERR_NO_SPREADSHEET } from "../../features/analytics/analyticsStore.js";
import { genQuestionId } from "../../core/ids.js";
import { buildColumnIndex, resolveColumnRef } from "../../features/analytics/utils/columnIdentifierResolver.js";
import { compileStages } from "../../features/analytics/utils/compileStages.js";
import GuiQueryBuilder from "../../features/analytics/components/GuiQueryBuilder.jsx";
import VisualizePanel from "../../features/analytics/components/VisualizePanel.jsx";
import { normalizeTableStyle } from "../../features/analytics/utils/tableStyle.js";
import { DEFAULT_LINE_STYLE } from "../../features/analytics/utils/chartPalette.js";
import { normalizeFolderPath } from "../../utils/folderTree.js";
import { VARIANT_LABELS, VARIANT_DESCRIPTIONS, normalizeVariant } from "../../features/analytics/variantLabels.js";

function emptyGui(formId, variant) {
  return {
    schemaVersion: 1,
    formId: formId || "",
    variant: variant === "view" ? "view" : "data",
    aggregations: [{ id: "a_1", type: "count" }],
    groupBy: [],
    filters: [],
    orderBy: [],
    limit: null,
  };
}

function emptyVizOptions() {
  return {
    format: { prefix: "", suffix: "", decimals: null, locale: "" },
    goal: null,
    pivot: { rowField: "", colField: "", valueField: "", agg: "sum" },
    geo: { latField: "", lngField: "", valueField: "", regionField: "", gridSize: 0.1 },
    sankey: { sourceField: "", targetField: "", valueField: "" },
    axis: {
      x: { auto: true, min: null, max: null, title: "" },
      y: { auto: true, min: null, max: null, title: "" },
    },
    // 折れ線系のグローバル設定。
    // curve: "linear" (カクカク) | "smooth" (曲線)
    // borderDash: [] = 実線 / [5,5] = 破線 / [2,3] = 点線
    // pointStyle: Chart.js の組込み形状名（circle / rect / triangle / rectRot / cross / star / none）
    lineStyle: { ...DEFAULT_LINE_STYLE },
    // 系列ごとの色上書き。key = 系列名（yField または x のカテゴリ値）/ value = { color }
    series: {},
    tableStyle: null,
    // グラフ全般の見た目（タイトル / 凡例 / グリッド / 背景 / 余白 等）。
    // null = 未設定（既定）/ オブジェクト = 個別カスタム。normalizeChartStyle 経由で
    // 欠落キーを補完したものを ChartStyleControls / ChartRenderer に渡す。
    chartStyle: null,
  };
}

export default function QuestionEditorPage() {
  const navigate = useNavigate();
  const { questionId } = useParams();
  const location = useLocation();
  const { isAdmin } = useAuth();
  const { forms } = useAppData();
  const isEdit = Boolean(questionId);

  const [mode, setMode] = useState("gui");
  const [name, setName] = useState("");
  const [driveFileUrl, setDriveFileUrl] = useState("");
  // 新規作成時は一覧で開いていたフォルダ (location.state.folder) を初期フォルダにする。
  const [folder, setFolder] = useState(() => isEdit ? "" : normalizeFolderPath(location.state?.folder || ""));
  const [selectedFormId, setSelectedFormId] = useState("");
  const [sqlVariant, setSqlVariant] = useState("data");
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
  const [definitionLoaded, setDefinitionLoaded] = useState(false);
  const autoRunQuestionIdRef = useRef(null);

  const unsavedDialog = useConfirmDialog();
  const baselineRef = useRef(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!isAdmin) navigate("/", { replace: true });
  }, [isAdmin, navigate]);

  const activeForms = forms.filter((f) => !f.archived);

  useCancellable(async (isCancelled) => {
    if (!questionId) return;
    setLoading(true);
    setDefinitionLoaded(false);
    autoRunQuestionIdRef.current = null;
    try {
      const q = await getQuestionById(questionId);
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
        setGui(g ? { ...emptyGui(g.formId || "", g.variant), ...g } : emptyGui(""));
        setSelectedFormId(g?.formId || "");
      } else {
        setSql(q.query?.sql || "");
        const fid = q.query?.formSources?.[0]?.formId || "";
        setSelectedFormId(fid);
        setSqlVariant(normalizeVariant(q.query?.formSources?.[0]?.variant));
      }
      const v = q.visualization || {};
      setVizType(v.type || "table");
      setXField(v.xField || "");
      setYFields(Array.isArray(v.yFields) ? v.yFields.join(",") : "");
      setHeatmap({
        enabled: !!v.heatmap?.enabled,
        direction: v.heatmap?.direction || "column",
        excludeRows: typeof v.heatmap?.excludeRows === "string" ? v.heatmap.excludeRows : "",
        excludeColumns: typeof v.heatmap?.excludeColumns === "string" ? v.heatmap.excludeColumns : "",
        minColor: typeof v.heatmap?.minColor === "string" ? v.heatmap.minColor : "",
        maxColor: typeof v.heatmap?.maxColor === "string" ? v.heatmap.maxColor : "",
      });
      const baseOpts = emptyVizOptions();
      setVizOptions({
        format: { ...baseOpts.format, ...(v.format || {}) },
        goal: v.goal === undefined ? null : v.goal,
        pivot: { ...baseOpts.pivot, ...(v.pivot || {}) },
        geo: { ...baseOpts.geo, ...(v.geo || {}) },
        sankey: { ...baseOpts.sankey, ...(v.sankey || {}) },
        axis: {
          x: { ...baseOpts.axis.x, ...(v.axis?.x || {}) },
          y: { ...baseOpts.axis.y, ...(v.axis?.y || {}) },
        },
        lineStyle: { ...baseOpts.lineStyle, ...(v.lineStyle || {}) },
        series: v.series && typeof v.series === "object" ? v.series : {},
        tableStyle: normalizeTableStyle(v.tableStyle),
        chartStyle: v.chartStyle && typeof v.chartStyle === "object" ? v.chartStyle : null,
      });
      setDefinitionLoaded(true);
      setLoading(false);
    } catch (_e) {
      if (!isCancelled()) setLoading(false);
    }
  }, [questionId]);

  const { formColumns, columnLoadError } = useMemo(() => {
    const fid = mode === "gui" ? gui.formId : selectedFormId;
    if (!fid) return { formColumns: [], columnLoadError: null };
    const targetForm = forms.find((f) => f.id === fid);
    const sheetConfig = targetForm ? getSheetConfig(targetForm) : null;
    if (!sheetConfig) {
      return { formColumns: [], columnLoadError: ERR_NO_SPREADSHEET };
    }
    try {
      // GUI / SQL いずれも形式（variant）に応じて列メタを切り替える（view 形式ではメタ列付き）。
      // SQL モードでは sqlVariant トグルが補完用に提示する列メタを決める。
      const useView = (mode === "gui" && gui.variant === "view")
        || (mode === "sql" && sqlVariant === "view");
      const cols = useView ? getFormViewColumns(targetForm) : getFormColumns(targetForm);
      return { formColumns: cols, columnLoadError: null };
    } catch (err) {
      return { formColumns: [], columnLoadError: err.message || String(err) };
    }
  }, [mode, gui.formId, gui.variant, selectedFormId, sqlVariant, forms]);

  const handleGuiFormChange = (newFormId) => {
    // フォーム切替時は variant も既定（data）にリセットする。データソース形式は
    // フォームの内容と相関するので、変更時に同一 variant を維持する強い理由がない。
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

    let questionForRun;
    if (mode === "gui") {
      if (!gui.formId) {
        setRunError("フォームを選択してください。");
        setRunning(false);
        return;
      }
      questionForRun = { query: { mode: "gui", gui } };
    } else {
      if (!sql.trim()) { setRunning(false); return; }
      const sources = buildSqlFormSources();
      if (sources.error) {
        setRunError(sources.error);
        setRunning(false);
        return;
      }
      questionForRun = {
        query: {
          mode: "sql",
          formSources: sources.formSources,
          sql,
        },
      };
    }

    try {
      const result = await executeQuestion(questionForRun, { forms });
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

    let query;
    if (mode === "gui") {
      if (!gui.formId) { setSaveError("フォームを選択してください。"); return; }
      query = { mode: "gui", gui };
    } else {
      const sources = buildSqlFormSources();
      if (sources.error) {
        setSaveError(sources.error);
        return;
      }
      query = {
        mode: "sql",
        formSources: sources.formSources,
        sql,
      };
    }

    setSaving(true);
    setSaveError(null);

    const yFieldsArr = yFields.split(",").map((s) => s.trim()).filter(Boolean);
    const question = {
      id: questionId || genQuestionId(),
      name: name.trim(),
      folder: normalizeFolderPath(folder),
      schemaVersion: 1,
      query,
      visualization: {
        type: vizType,
        xField: xField.trim(),
        yFields: yFieldsArr,
        showLegend: true,
        heatmap: {
          enabled: !!heatmap.enabled,
          direction: heatmap.direction || "column",
          excludeRows: typeof heatmap.excludeRows === "string" ? heatmap.excludeRows.slice(0, 500) : "",
          excludeColumns: typeof heatmap.excludeColumns === "string" ? heatmap.excludeColumns : "",
          minColor: typeof heatmap.minColor === "string" ? heatmap.minColor : "",
          maxColor: typeof heatmap.maxColor === "string" ? heatmap.maxColor : "",
        },
        format: vizOptions.format,
        goal: vizOptions.goal,
        pivot: vizOptions.pivot,
        geo: vizOptions.geo,
        sankey: vizOptions.sankey,
        axis: vizOptions.axis,
        lineStyle: vizOptions.lineStyle,
        series: vizOptions.series || {},
        tableStyle: normalizeTableStyle(vizOptions.tableStyle),
        chartStyle: vizOptions.chartStyle || null,
      },
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
  }, [mode, name, folder, gui, sql, buildSqlFormSources, vizType, xField, yFields, heatmap, vizOptions, questionId, navigate]);

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
    setSql(compiled.sql);
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

  useEffect(() => {
    if (!baselineReady) return;
    if (baselineRef.current === null) {
      baselineRef.current = snapshot;
      setIsDirty(false);
      return;
    }
    setIsDirty(baselineRef.current !== snapshot);
  }, [baselineReady, snapshot]);

  useBeforeUnloadGuard(isDirty);

  const goBack = useCallback(() => navigate(location.state?.from || "/admin/questions"), [navigate, location.state]);

  const handleBack = () => {
    if (isDirty) {
      unsavedDialog.open();
      return false;
    }
  };

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

  const defaultForm = forms.find((f) => f.id === (mode === "gui" ? gui.formId : selectedFormId)) || null;
  const defaultColumnIndex = defaultForm ? buildColumnIndex(defaultForm) : null;
  const resolveCol = (token) => resolveColumnRef(token, defaultColumnIndex) || token;
  const viz = {
    type: vizType,
    xField: resolveCol(xField.trim()),
    yFields: yFields.split(",").map((s) => s.trim()).filter(Boolean).map(resolveCol),
    heatmap,
    format: vizOptions.format,
    goal: vizOptions.goal,
    pivot: vizOptions.pivot,
    geo: vizOptions.geo,
    sankey: vizOptions.sankey,
    axis: vizOptions.axis,
    lineStyle: vizOptions.lineStyle,
    series: vizOptions.series,
    tableStyle: vizOptions.tableStyle,
    chartStyle: vizOptions.chartStyle,
  };

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

        <div>
          <label className="nf-label">Question 名</label>
          <input
            className="nf-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 月別集計"
            style={{ width: "100%", maxWidth: "400px" }}
          />
        </div>

        <div>
          <label className="nf-label">フォルダ（任意）</label>
          <input
            className="nf-input"
            type="text"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="例: 営業/月次  （空欄=フォルダなし）"
            style={{ width: "100%", maxWidth: "400px" }}
          />
        </div>

        {questionId && driveFileUrl && (
          <div>
            <label className="nf-label">実体ファイル URL（Drive 上の JSON）</label>
            <input
              className="nf-input nf-input--readonly"
              type="text"
              value={driveFileUrl}
              readOnly
              onFocus={(e) => e.target.select()}
              title="この Question の実体（Drive 上の JSON ファイル）の URL。表示専用で編集できません。"
              style={{ width: "100%", maxWidth: "640px", background: "var(--surface-subtle)", color: "var(--text-muted)" }}
            />
            <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
              この Question 定義が保存されている Drive 上の場所です。どれが実体かを確認するための表示専用で、編集はできません。
            </p>
          </div>
        )}

        <p className="nf-text-11 nf-text-muted nf-mb-0">
          Question 定義は標準フォルダ構成の <code>02_questions</code> に保存されます。
        </p>

        <fieldset style={{ border: "1px solid var(--nf-border)", borderRadius: "4px", padding: "8px 12px", margin: 0 }}>
          <legend style={{ fontSize: "12px", padding: "0 6px" }}>クエリ作成方法</legend>
          <label style={{ marginRight: "16px" }}>
            <input
              type="radio"
              name="query-mode"
              value="gui"
              checked={mode === "gui"}
              onChange={handleSwitchToGui}
              style={{ marginRight: "4px" }}
            />
            GUI
          </label>
          <label>
            <input
              type="radio"
              name="query-mode"
              value="sql"
              checked={mode === "sql"}
              onChange={handleSwitchToSql}
              style={{ marginRight: "4px" }}
            />
            SQL
          </label>
        </fieldset>

        {mode === "gui" ? (
          <>
            {columnLoadError && <p className="nf-text-warning">列情報の取得に失敗: {columnLoadError}</p>}
            <GuiQueryBuilder
              gui={gui}
              onChange={setGui}
              formColumns={formColumns}
              activeForms={activeForms}
              onFormChange={handleGuiFormChange}
            />
            <div>
              <button type="button" onClick={handleRunQuery} disabled={running} className="nf-btn-outline">
                {running ? "実行中..." : "クエリ実行"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="nf-label">データソース（既定フォーム・任意）</label>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
                <select
                  className="nf-input"
                  value={selectedFormId}
                  onChange={(e) => setSelectedFormId(e.target.value)}
                  style={{ maxWidth: "400px", flex: "0 0 auto" }}
                >
                  <option value="">（未選択：SQL 内で [フォーム名] を直接参照）</option>
                  {activeForms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.settings?.formTitle || f.id}
                    </option>
                  ))}
                </select>
                {selectedFormId && (() => {
                  const f = forms.find((x) => x.id === selectedFormId);
                  if (!f) return null;
                  const title = f.settings?.formTitle || f.id;
                  const suffix = sqlVariant === "view" ? ":view" : "";
                  const tableNameToken = "[" + title + suffix + "]";
                  const tableIdToken = "[" + f.id + suffix + "]";
                  const copy = (token) => {
                    navigator.clipboard.writeText(token).then(() => {
                      setCopiedToken(token);
                      setTimeout(() => setCopiedToken(""), 1500);
                    }).catch(() => {});
                  };
                  const rowStyle = { display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" };
                  const codeStyle = { fontFamily: "monospace", background: "var(--nf-input-bg, #f6f6f6)", border: "1px solid var(--nf-border)", borderRadius: "3px", padding: "2px 6px" };
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
                        <label style={{ fontSize: "12px" }}>
                          <input
                            type="radio"
                            name="sql-variant"
                            value="data"
                            checked={sqlVariant === "data"}
                            onChange={() => setSqlVariant("data")}
                            style={{ marginRight: 4 }}
                          />
                          {VARIANT_LABELS.data}
                        </label>
                        <label style={{ fontSize: "12px" }}>
                          <input
                            type="radio"
                            name="sql-variant"
                            value="view"
                            checked={sqlVariant === "view"}
                            onChange={() => setSqlVariant("view")}
                            style={{ marginRight: 4 }}
                          />
                          {VARIANT_LABELS.view}
                        </label>
                      </div>
                      <span className="nf-text-subtle" style={{ fontSize: "12px" }}>
                        {VARIANT_DESCRIPTIONS[sqlVariant]}
                      </span>
                      <div style={rowStyle}>
                        <span className="nf-text-muted" style={{ minWidth: "70px" }}>テーブル名:</span>
                        <code style={codeStyle}>{tableNameToken}</code>
                        <button type="button" className="nf-btn-outline" style={{ padding: "2px 8px", fontSize: "11px" }} onClick={() => copy(tableNameToken)}>
                          {copiedToken === tableNameToken ? "コピー済" : "コピー"}
                        </button>
                      </div>
                      <div style={rowStyle}>
                        <span className="nf-text-muted" style={{ minWidth: "70px" }}>テーブルID:</span>
                        <code style={codeStyle}>{tableIdToken}</code>
                        <button type="button" className="nf-btn-outline" style={{ padding: "2px 8px", fontSize: "11px" }} onClick={() => copy(tableIdToken)}>
                          {copiedToken === tableIdToken ? "コピー済" : "コピー"}
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
            <div>
              <label className="nf-label">SQL（AlaSQL 方言）</label>
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                rows={8}
                style={{ width: "100%", fontFamily: "monospace", fontSize: "13px", padding: "8px", boxSizing: "border-box", border: "1px solid var(--nf-border)", borderRadius: "4px", background: "var(--nf-input-bg, #fff)", color: "var(--nf-text)", resize: "vertical", minHeight: "160px" }}
                placeholder={"例: SELECT [基本情報|区], COUNT(*) AS count FROM [data] GROUP BY [基本情報|区]\n他フォーム参照: SELECT * FROM [フォーム名] AS f\nバッククォートも使用可: SELECT * FROM `フォーム名`"}
              />
              <div style={{ marginTop: "6px" }}>
                <button type="button" onClick={handleRunQuery} disabled={running} className="nf-btn-outline">
                  {running ? "実行中..." : "クエリ実行"}
                </button>
              </div>
            </div>
          </>
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

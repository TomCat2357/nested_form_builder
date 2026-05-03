import React, { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import { useAuth } from "../../app/state/authContext.jsx";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { useBuilderSettings } from "../../features/settings/settingsStore.js";
import { executeQuestion, saveQuestion, listQuestions, getSnapshotColumns } from "../../features/analytics/analyticsStore.js";
import { generateQuestionId } from "../../features/analytics/utils/generateId.js";
import { buildColumnIndex, resolveColumnRef } from "../../features/analytics/utils/columnIdentifierResolver.js";
import { compileGuiToSql } from "../../features/analytics/utils/compileGuiToSql.js";
import ChartRenderer from "../../features/analytics/components/ChartRenderer.jsx";
import GuiQueryBuilder from "../../features/analytics/components/GuiQueryBuilder.jsx";

const VIZ_TYPES = [
  { value: "table", label: "テーブル" },
  { value: "scalar", label: "単一値" },
  { value: "bar", label: "棒グラフ" },
  { value: "line", label: "折れ線グラフ" },
  { value: "pie", label: "円グラフ" },
];

function emptyGui(formId) {
  return {
    schemaVersion: 1,
    formId: formId || "",
    aggregations: [{ id: "a_1", type: "count" }],
    groupBy: [],
    filters: [],
    orderBy: [],
    limit: null,
  };
}

function recommendVizType(compiledColumns) {
  const dims = compiledColumns.filter((c) => c.role === "dimension").length;
  const metrics = compiledColumns.filter((c) => c.role === "metric").length;
  if (dims === 0 && metrics === 1) return "scalar";
  if (dims === 0) return "table";
  if (dims === 1) return "bar";
  return "table";
}

export default function QuestionEditorPage() {
  const navigate = useNavigate();
  const { questionId } = useParams();
  const { isAdmin } = useAuth();
  const { forms } = useAppData();
  const { settings } = useBuilderSettings();

  const [mode, setMode] = useState("gui");
  const [name, setName] = useState("");
  const [selectedFormId, setSelectedFormId] = useState("");
  const [sql, setSql] = useState("");
  const [gui, setGui] = useState(() => emptyGui(""));
  const [vizType, setVizType] = useState("table");
  const [xField, setXField] = useState("");
  const [yFields, setYFields] = useState("");

  const [snapshotColumns, setSnapshotColumns] = useState([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState(null);

  const [queryResult, setQueryResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [loading, setLoading] = useState(false);

  if (!isAdmin) {
    navigate("/analytics", { replace: true });
    return null;
  }

  const activeForms = forms.filter((f) => !f.archived);

  useEffect(() => {
    if (!questionId) return;
    let cancelled = false;
    setLoading(true);
    listQuestions().then((qs) => {
      if (cancelled) return;
      const q = qs.find((x) => x.id === questionId);
      if (!q) {
        setLoading(false);
        return;
      }
      setName(q.name || "");
      const qMode = q.query?.mode === "gui" ? "gui" : "sql";
      setMode(qMode);
      if (qMode === "gui") {
        const g = q.query.gui;
        setGui(g ? { ...emptyGui(g.formId || ""), ...g } : emptyGui(""));
        setSelectedFormId(g?.formId || "");
      } else {
        setSql(q.query?.sql || "");
        const fid = q.query?.formSources?.[0]?.formId || "";
        setSelectedFormId(fid);
      }
      const v = q.visualization || {};
      setVizType(v.type || "table");
      setXField(v.xField || "");
      setYFields(Array.isArray(v.yFields) ? v.yFields.join(",") : "");
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [questionId]);

  useEffect(() => {
    const fid = mode === "gui" ? gui.formId : selectedFormId;
    if (!fid || !settings?.spreadsheetId) {
      setSnapshotColumns([]);
      return;
    }
    let cancelled = false;
    setSnapshotLoading(true);
    setSnapshotError(null);
    getSnapshotColumns({
      formId: fid,
      spreadsheetId: settings.spreadsheetId,
      sheetName: settings.sheetName || "Data",
    }).then((cols) => {
      if (!cancelled) setSnapshotColumns(cols);
    }).catch((err) => {
      if (!cancelled) setSnapshotError(err.message || String(err));
    }).finally(() => {
      if (!cancelled) setSnapshotLoading(false);
    });
    return () => { cancelled = true; };
  }, [mode, gui.formId, selectedFormId, settings?.spreadsheetId, settings?.sheetName]);

  const guiForm = useMemo(() => forms.find((f) => f.id === gui.formId) || null, [forms, gui.formId]);

  const handleGuiFormChange = (newFormId) => {
    setGui(emptyGui(newFormId));
    setQueryResult(null);
    setVizType("table");
    setXField("");
    setYFields("");
  };

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
      if (!selectedFormId) {
        setRunError("フォームを選択してください。");
        setRunning(false);
        return;
      }
      const form = forms.find((f) => f.id === selectedFormId);
      if (!form) {
        setRunError("選択したフォームが見つかりません。");
        setRunning(false);
        return;
      }
      questionForRun = {
        query: {
          mode: "sql",
          formSources: [{
            formId: form.id,
            alias: "data",
            spreadsheetId: settings.spreadsheetId,
            sheetName: settings.sheetName || "Data",
          }],
          sql,
        },
      };
    }

    try {
      const result = await executeQuestion(questionForRun, { forms, settings });
      if (result.ok) {
        setQueryResult(result);
        if (mode === "gui" && Array.isArray(result.compiledColumns)) {
          const dims = result.compiledColumns.filter((c) => c.role === "dimension");
          const metrics = result.compiledColumns.filter((c) => c.role === "metric");
          const recommended = recommendVizType(result.compiledColumns);
          setVizType(recommended);
          setXField(dims[0]?.name || "");
          setYFields(metrics.map((m) => m.name).join(","));
        }
      } else {
        setRunError(result.error);
      }
    } catch (err) {
      setRunError(err.message || String(err));
    } finally {
      setRunning(false);
    }
  }, [mode, gui, sql, selectedFormId, forms, settings]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setSaveError("Question 名を入力してください。"); return; }

    let query;
    if (mode === "gui") {
      if (!gui.formId) { setSaveError("フォームを選択してください。"); return; }
      query = { mode: "gui", gui };
    } else {
      if (!selectedFormId) { setSaveError("フォームを選択してください。"); return; }
      const form = forms.find((f) => f.id === selectedFormId);
      if (!form) return;
      query = {
        mode: "sql",
        formSources: [{
          formId: form.id,
          alias: "data",
          spreadsheetId: settings.spreadsheetId,
          sheetName: settings.sheetName || "Data",
        }],
        sql,
      };
    }

    setSaving(true);
    setSaveError(null);

    const yFieldsArr = yFields.split(",").map((s) => s.trim()).filter(Boolean);
    const question = {
      id: questionId || generateQuestionId(),
      name: name.trim(),
      schemaVersion: 1,
      query,
      visualization: {
        type: vizType,
        xField: xField.trim(),
        yFields: yFieldsArr,
        showLegend: true,
      },
      modifiedAt: Date.now(),
    };

    try {
      await saveQuestion(question);
      navigate("/analytics");
    } catch (err) {
      setSaveError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [mode, name, gui, sql, selectedFormId, vizType, xField, yFields, questionId, forms, settings, navigate]);

  const handleSwitchToSql = () => {
    if (mode === "sql") return;
    if (!gui.formId) {
      setMode("sql");
      return;
    }
    const compiled = compileGuiToSql(gui, { form: guiForm, snapshotColumns });
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

  const defaultForm = forms.find((f) => f.id === (mode === "gui" ? gui.formId : selectedFormId)) || null;
  const defaultColumnIndex = defaultForm ? buildColumnIndex(defaultForm) : null;
  const resolveCol = (token) => resolveColumnRef(token, defaultColumnIndex) || token;
  const viz = {
    type: vizType,
    xField: resolveCol(xField.trim()),
    yFields: yFields.split(",").map((s) => s.trim()).filter(Boolean).map(resolveCol),
  };

  return (
    <AppLayout
      title={questionId ? "Question 編集" : "Question 作成"}
      fallbackPath="/analytics"
      sidebarActions={
        <>
          <button type="button" onClick={handleSave} disabled={saving} className="nf-btn-outline nf-btn-sidebar">
            {saving ? "保存中..." : "保存"}
          </button>
          <button type="button" onClick={() => navigate("/analytics")} className="nf-btn-outline nf-btn-sidebar">
            キャンセル
          </button>
        </>
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

        <div style={{ display: "flex", gap: 6, borderBottom: "1px solid var(--nf-border)", paddingBottom: 0 }}>
          <button
            type="button"
            onClick={handleSwitchToGui}
            className={mode === "gui" ? "nf-btn" : "nf-btn-outline"}
            style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          >
            GUI
          </button>
          <button
            type="button"
            onClick={handleSwitchToSql}
            className={mode === "sql" ? "nf-btn" : "nf-btn-outline"}
            style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          >
            SQL
          </button>
        </div>

        {mode === "gui" ? (
          <>
            {snapshotError && <p className="nf-text-warning">列情報の取得に失敗: {snapshotError}</p>}
            <GuiQueryBuilder
              gui={gui}
              onChange={setGui}
              snapshotColumns={snapshotColumns}
              form={guiForm}
              activeForms={activeForms}
              onFormChange={handleGuiFormChange}
            />
            <div>
              <button type="button" onClick={handleRunQuery} disabled={running || snapshotLoading} className="nf-btn-outline">
                {running ? "実行中..." : "クエリ実行"}
              </button>
              {snapshotLoading && <span className="nf-text-subtle" style={{ marginLeft: 8 }}>列情報を取得中...</span>}
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="nf-label">データソース（既定フォーム）</label>
              <select
                className="nf-input"
                value={selectedFormId}
                onChange={(e) => setSelectedFormId(e.target.value)}
                style={{ maxWidth: "400px" }}
              >
                <option value="">フォームを選択...</option>
                {activeForms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.settings?.formTitle || f.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="nf-label">SQL（AlaSQL 方言）</label>
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                rows={6}
                style={{ width: "100%", fontFamily: "monospace", fontSize: "13px", padding: "8px", boxSizing: "border-box", border: "1px solid var(--nf-border)", borderRadius: "4px", background: "var(--nf-input-bg, #fff)", color: "var(--nf-text)" }}
                placeholder={"例: SELECT [基本情報|区], COUNT(*) AS count FROM [data] GROUP BY [基本情報|区]\n他フォーム参照: SELECT * FROM [フォーム名] AS f"}
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

        {queryResult && (
          <div>
            <label className="nf-label">可視化設定</label>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "10px" }}>
              <div>
                <span style={{ fontSize: "12px", marginRight: "6px" }}>グラフ種別</span>
                <select className="nf-input" value={vizType} onChange={(e) => setVizType(e.target.value)}>
                  {VIZ_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              {vizType !== "table" && (
                <>
                  {vizType !== "scalar" && (
                    <div>
                      <span style={{ fontSize: "12px", marginRight: "6px" }}>X 軸</span>
                      <input className="nf-input" type="text" value={xField} onChange={(e) => setXField(e.target.value)} placeholder="列名" style={{ width: "120px" }} />
                    </div>
                  )}
                  <div>
                    <span style={{ fontSize: "12px", marginRight: "6px" }}>{vizType === "scalar" ? "値の列" : "Y 軸（カンマ区切り）"}</span>
                    <input className="nf-input" type="text" value={yFields} onChange={(e) => setYFields(e.target.value)} placeholder={vizType === "scalar" ? "a_1" : "count,total"} style={{ width: "160px" }} />
                  </div>
                </>
              )}
            </div>

            <div style={{ border: "1px solid var(--nf-border)", borderRadius: "4px", padding: "12px" }}>
              <ChartRenderer viz={viz} rows={queryResult.rows} columns={queryResult.columns} />
            </div>
            <p className="nf-text-subtle" style={{ marginTop: "6px" }}>
              {queryResult.rows.length} 行
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

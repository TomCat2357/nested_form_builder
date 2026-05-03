import React, { useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import { useAuth } from "../../app/state/authContext.jsx";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { useBuilderSettings } from "../../features/settings/settingsStore.js";
import { executeQuestion, saveQuestion } from "../../features/analytics/analyticsStore.js";
import { generateQuestionId } from "../../features/analytics/utils/generateId.js";
import ChartRenderer from "../../features/analytics/components/ChartRenderer.jsx";
import ResultTable from "../../features/analytics/components/ResultTable.jsx";

const VIZ_TYPES = [
  { value: "table", label: "テーブル" },
  { value: "bar", label: "棒グラフ" },
  { value: "line", label: "折れ線グラフ" },
  { value: "pie", label: "円グラフ" },
];

export default function QuestionEditorPage() {
  const navigate = useNavigate();
  const { questionId } = useParams();
  const { isAdmin } = useAuth();
  const { forms } = useAppData();
  const { settings } = useBuilderSettings();

  const [name, setName] = useState("");
  const [selectedFormId, setSelectedFormId] = useState("");
  const [sql, setSql] = useState("");
  const [vizType, setVizType] = useState("table");
  const [xField, setXField] = useState("");
  const [yFields, setYFields] = useState("");

  const [queryResult, setQueryResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  if (!isAdmin) {
    navigate("/analytics", { replace: true });
    return null;
  }

  const activeForms = forms.filter((f) => !f.archived);

  const handleRunQuery = useCallback(async () => {
    if (!sql.trim()) return;
    if (!selectedFormId) {
      setRunError("フォームを選択してください。");
      return;
    }
    const form = forms.find((f) => f.id === selectedFormId);
    if (!form) {
      setRunError("選択したフォームが見つかりません。");
      return;
    }

    setRunning(true);
    setRunError(null);
    setQueryResult(null);

    const question = {
      query: {
        formSources: [{
          formId: form.id,
          alias: "data",
          spreadsheetId: settings.spreadsheetId,
          sheetName: settings.sheetName || "Data",
        }],
        sql,
      },
    };

    try {
      const result = await executeQuestion(question);
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
  }, [sql, selectedFormId, forms, settings]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setSaveError("Question 名を入力してください。");
      return;
    }
    if (!selectedFormId) {
      setSaveError("フォームを選択してください。");
      return;
    }
    const form = forms.find((f) => f.id === selectedFormId);
    if (!form) return;

    setSaving(true);
    setSaveError(null);

    const yFieldsArr = yFields.split(",").map((s) => s.trim()).filter(Boolean);
    const question = {
      id: questionId || generateQuestionId(),
      name: name.trim(),
      schemaVersion: 1,
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
  }, [name, selectedFormId, sql, vizType, xField, yFields, questionId, forms, settings, navigate]);

  const viz = { type: vizType, xField: xField.trim(), yFields: yFields.split(",").map((s) => s.trim()).filter(Boolean) };

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
          <label className="nf-label">データソース（フォーム）</label>
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
            placeholder={"例: SELECT createdAt, COUNT(*) AS count FROM data GROUP BY createdAt"}
          />
          <div style={{ marginTop: "6px" }}>
            <button
              type="button"
              onClick={handleRunQuery}
              disabled={running}
              className="nf-btn-outline"
            >
              {running ? "実行中..." : "クエリ実行"}
            </button>
          </div>
          {runError && <p className="nf-text-warning" style={{ marginTop: "6px" }}>{runError}</p>}
        </div>

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
                  <div>
                    <span style={{ fontSize: "12px", marginRight: "6px" }}>X 軸</span>
                    <input className="nf-input" type="text" value={xField} onChange={(e) => setXField(e.target.value)} placeholder="列名" style={{ width: "120px" }} />
                  </div>
                  <div>
                    <span style={{ fontSize: "12px", marginRight: "6px" }}>Y 軸（カンマ区切り）</span>
                    <input className="nf-input" type="text" value={yFields} onChange={(e) => setYFields(e.target.value)} placeholder="count,total" style={{ width: "160px" }} />
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

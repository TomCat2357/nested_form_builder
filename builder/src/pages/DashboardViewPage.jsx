import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useAlert } from "../app/hooks/useAlert.js";
import { dataStore } from "../app/state/dataStore.js";
import { loadDashboardDataSources } from "../features/dashboards/dataSourceLoader.js";
import { executeQueries } from "../features/dashboards/sqlEngine.js";
import EChartsWidget, { buildChartOption } from "../features/dashboards/widgets/EChartsWidget.jsx";
import TableWidget from "../features/dashboards/widgets/TableWidget.jsx";
import echarts from "../features/dashboards/echartsRegistry.js";
import { renderTemplate, buildIframeDocument, mountWidgetsIntoIframe } from "../features/dashboards/templateRenderer.js";
import { getDashboardTemplate } from "../services/gasClient.js";

const collectInitialParams = (queries) => {
  const params = {};
  for (const query of queries || []) {
    for (const def of query?.params || []) {
      if (!def || !def.name) continue;
      params[def.name] = def.default;
    }
  }
  return params;
};

const collectParamDefs = (queries) => {
  const seen = new Map();
  for (const query of queries || []) {
    for (const def of query?.params || []) {
      if (!def || !def.name || seen.has(def.name)) continue;
      seen.set(def.name, def);
    }
  }
  return Array.from(seen.values());
};

const coerceParamValue = (def, raw) => {
  if (def.type === "number") {
    if (raw === "" || raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return raw;
};

export default function DashboardViewPage() {
  const { id: dashboardId } = useParams();
  const navigate = useNavigate();
  const { getDashboardById, refreshDashboards, dashboards } = useAppData();
  const { showAlert } = useAlert();

  const [dashboard, setDashboard] = useState(() => getDashboardById(dashboardId));
  const [loading, setLoading] = useState(false);
  const [tables, setTables] = useState({});
  const [queryResults, setQueryResults] = useState({});
  const [queryErrors, setQueryErrors] = useState([]);
  const [params, setParams] = useState({});
  const [renderMode, setRenderMode] = useState("widgets"); // "widgets" | "template"
  const [templateHtml, setTemplateHtml] = useState("");
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const iframeRef = useRef(null);
  const widgetCleanupRef = useRef(null);

  // ダッシュボード定義の取得
  useEffect(() => {
    const inMemory = getDashboardById(dashboardId);
    if (inMemory) {
      setDashboard(inMemory);
      return;
    }
    refreshDashboards({ reason: "view-mount", background: false }).catch(console.error);
  }, [dashboardId, getDashboardById, refreshDashboards, dashboards.length]);

  useEffect(() => {
    if (!dashboard) return;
    setParams((prev) => ({ ...collectInitialParams(dashboard.queries), ...prev }));
  }, [dashboard]);

  const paramDefs = useMemo(() => collectParamDefs(dashboard?.queries), [dashboard]);

  // データ取得 + alasql 登録
  const reloadData = useCallback(async () => {
    if (!dashboard) return;
    setLoading(true);
    try {
      const { tables: tableSummary } = await loadDashboardDataSources(dashboard, {
        fetcher: dataStore.listEntries.bind(dataStore),
      });
      setTables(tableSummary);
      const { results, errors } = executeQueries(dashboard.queries || [], params);
      setQueryResults(results);
      setQueryErrors(errors);
    } catch (err) {
      console.error("[DashboardViewPage] reload failed:", err);
      showAlert(`データの取得に失敗しました: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  }, [dashboard, params, showAlert]);

  useEffect(() => {
    if (dashboard) reloadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard?.id]);

  const handleRunQueries = () => {
    if (!dashboard) return;
    try {
      const { results, errors } = executeQueries(dashboard.queries || [], params);
      setQueryResults(results);
      setQueryErrors(errors);
    } catch (err) {
      showAlert(`クエリ実行に失敗しました: ${err.message || err}`);
    }
  };

  const handleParamChange = (name, value, def) => {
    setParams((prev) => ({ ...prev, [name]: coerceParamValue(def, value) }));
  };

  const handleEdit = () => {
    navigate(`/dashboards/${dashboardId}/edit`);
  };

  // テンプレモード時の取得
  useEffect(() => {
    if (renderMode !== "template") return;
    if (!dashboard?.templateUrl) {
      setTemplateError("テンプレートURLが設定されていません。編集画面で設定してください。");
      setTemplateHtml("");
      return;
    }
    setTemplateLoading(true);
    setTemplateError("");
    getDashboardTemplate(dashboard.templateUrl)
      .then((res) => setTemplateHtml(res.html || ""))
      .catch((err) => {
        console.error("[DashboardViewPage] template fetch failed:", err);
        setTemplateError(err.message || "テンプレートの取得に失敗しました");
        setTemplateHtml("");
      })
      .finally(() => setTemplateLoading(false));
  }, [renderMode, dashboard?.templateUrl]);

  // iframe へのウィジェット差込
  const renderedHtml = useMemo(() => {
    if (renderMode !== "template" || !templateHtml) return "";
    const replaced = renderTemplate(templateHtml, { queryResults, params });
    return buildIframeDocument(replaced);
  }, [renderMode, templateHtml, queryResults, params]);

  const widgetsById = useMemo(() => {
    const map = {};
    for (const widget of dashboard?.widgets || []) {
      if (!widget?.id) continue;
      map[widget.id] = { widget, rows: queryResults[widget.queryId] || [] };
    }
    return map;
  }, [dashboard?.widgets, queryResults]);

  const handleIframeLoad = () => {
    if (widgetCleanupRef.current) {
      widgetCleanupRef.current();
      widgetCleanupRef.current = null;
    }
    if (renderMode !== "template") return;
    widgetCleanupRef.current = mountWidgetsIntoIframe(iframeRef.current, widgetsById, echarts, buildChartOption);
  };

  useEffect(() => () => {
    if (widgetCleanupRef.current) {
      widgetCleanupRef.current();
      widgetCleanupRef.current = null;
    }
  }, []);

  if (!dashboard) {
    return (
      <AppLayout title="ダッシュボード" badge="閲覧" fallbackPath="/dashboards">
        <p className="nf-text-subtle">読み込み中...</p>
      </AppLayout>
    );
  }

  const widgets = Array.isArray(dashboard.widgets) ? dashboard.widgets : [];

  return (
    <AppLayout
      title={dashboard.settings?.title || "(無題)"}
      badge="ダッシュボード閲覧"
      fallbackPath="/dashboards"
      sidebarActions={
        <>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-13" onClick={reloadData} disabled={loading}>
            {loading ? "🔄 取得中..." : "🔄 再取得"}
          </button>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-13" onClick={handleRunQueries} disabled={loading}>
            ▶ クエリ再実行
          </button>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-13"
            onClick={() => setRenderMode((m) => (m === "template" ? "widgets" : "template"))}
            disabled={!dashboard.templateUrl}
            title={dashboard.templateUrl ? "テンプレ⇔ウィジェット表示を切替" : "テンプレートURLが未設定"}
          >
            {renderMode === "template" ? "📐 ウィジェット表示" : "📄 テンプレ表示"}
          </button>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-13" onClick={handleEdit} disabled={dashboard.readOnly}>
            ✏ 編集
          </button>
        </>
      }
    >
      {dashboard.description && (
        <p className="nf-text-muted nf-text-14 nf-mb-16 nf-pre-wrap">{dashboard.description}</p>
      )}

      {paramDefs.length > 0 && (
        <div className="nf-card nf-mb-16">
          <h3 className="nf-settings-group-title nf-mb-12">パラメータ</h3>
          <div className="nf-row nf-gap-12 nf-flex-wrap">
            {paramDefs.map((def) => (
              <div key={def.name} className="nf-col nf-gap-4">
                <label className="nf-text-12 nf-fw-600">{def.label || def.name}</label>
                <input
                  type={def.type === "number" ? "number" : "text"}
                  value={params[def.name] ?? ""}
                  onChange={(e) => handleParamChange(def.name, e.target.value, def)}
                  className="nf-input admin-input"
                  style={{ minWidth: 160 }}
                />
              </div>
            ))}
            <button type="button" className="nf-btn-outline nf-text-13" onClick={handleRunQueries} style={{ alignSelf: "flex-end" }}>
              適用
            </button>
          </div>
        </div>
      )}

      <div className="nf-card nf-mb-16">
        <h3 className="nf-settings-group-title nf-mb-12">データソース</h3>
        <ul className="nf-text-12 nf-text-muted">
          {Object.entries(tables).map(([alias, summary]) => (
            <li key={alias}>
              <code>{alias}</code> ← formId={summary.formId}, rows={summary.rowCount}
              {summary.error && <span className="nf-text-danger-strong"> ({summary.error})</span>}
            </li>
          ))}
          {Object.keys(tables).length === 0 && <li>データソースが定義されていません。</li>}
        </ul>
      </div>

      {queryErrors.length > 0 && (
        <div className="nf-card nf-mb-16">
          <h3 className="nf-settings-group-title nf-mb-12 nf-text-danger-strong">クエリエラー</h3>
          <ul className="nf-text-12">
            {queryErrors.map((err, idx) => (
              <li key={idx}><code>{err.queryId}</code>: {err.error}</li>
            ))}
          </ul>
        </div>
      )}

      {renderMode === "template" ? (
        <div className="dashboard-template-frame-wrap">
          {templateLoading && <p className="nf-text-subtle">テンプレート取得中...</p>}
          {templateError && <p className="nf-text-danger-strong">{templateError}</p>}
          {!templateLoading && !templateError && renderedHtml && (
            <iframe
              ref={iframeRef}
              srcDoc={renderedHtml}
              onLoad={handleIframeLoad}
              sandbox="allow-same-origin"
              title="ダッシュボードテンプレート"
              style={{ width: "100%", minHeight: "600px", border: "1px solid #ddd", background: "white" }}
            />
          )}
        </div>
      ) : (
        <div className="dashboard-widget-grid">
          {widgets.map((widget) => {
            const rows = queryResults[widget.queryId] || [];
            if (widget.type === "echarts") {
              return <EChartsWidget key={widget.id} widget={widget} rows={rows} />;
            }
            if (widget.type === "table") {
              return <TableWidget key={widget.id} widget={widget} rows={rows} />;
            }
            return (
              <div key={widget.id} className="dashboard-widget">
                <p className="nf-text-muted">未対応のウィジェット種別: {widget.type}</p>
              </div>
            );
          })}
          {widgets.length === 0 && (
            <p className="nf-text-subtle">ウィジェットが定義されていません。編集画面でウィジェットを追加してください。</p>
          )}
        </div>
      )}
    </AppLayout>
  );
}

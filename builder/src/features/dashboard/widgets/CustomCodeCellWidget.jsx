import React, { useCallback, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { runCustomCodeCell } from "../codeCellSandbox.js";
import { CHART_COLORS } from "../chartColors.js";

const SAMPLE_CODE = `// ctx.records: 選択フォームの entries
// ctx.recordsByForm: {[formId]: { entries, ... }}
// ctx.helpers: groupBy / sumBy / meanBy / describeNumeric / pivot / bucketByDate / flattenForms
// ctx.chart: bar / line / pie  /  ctx.table({ rows, columns })  /  ctx.text(msg)
const data = ctx.helpers.groupBy(ctx.records, "Q1").map((row) => ({
  name: row.key,
  value: row.count,
}));
return ctx.chart.bar({ data, title: "Q1 集計" });
`;

export default function CustomCodeCellWidget({ widget, forms, formsById, recordsByForm, selectedFormIds, onUpdate }) {
  const config = widget.config || {};
  const formId = widget.formId || selectedFormIds[0] || "";
  const sourceMode = config.sourceMode || "single"; // "single" | "all"
  const records = useMemo(() => {
    if (sourceMode === "all") {
      const flat = [];
      selectedFormIds.forEach((id) => {
        const entries = recordsByForm[id]?.entries || [];
        const formTitle = formsById[id]?.settings?.formTitle || "";
        entries.forEach((e) => flat.push({ ...e, __formId: id, __formTitle: formTitle }));
      });
      return flat;
    }
    return recordsByForm[formId]?.entries || [];
  }, [sourceMode, formId, selectedFormIds, recordsByForm, formsById]);

  const [draft, setDraft] = useState(config.code || SAMPLE_CODE);
  const [result, setResult] = useState(null);

  const persist = useCallback(() => {
    onUpdate({ config: { ...config, code: draft } });
  }, [draft, config, onUpdate]);

  const run = useCallback(() => {
    const out = runCustomCodeCell(draft, {
      records,
      forms,
      formsById,
      recordsByForm,
      selectedFormIds,
    });
    setResult(out);
    persist();
  }, [draft, records, forms, formsById, recordsByForm, selectedFormIds, persist]);

  return (
    <div className="dashboard-widget-body">
      <div className="nf-row nf-gap-8 nf-flex-wrap nf-mb-8">
        <label className="nf-text-13">
          データ源:
          <select
            value={sourceMode}
            onChange={(e) => onUpdate({ config: { ...config, sourceMode: e.target.value } })}
            className="nf-ml-4"
          >
            <option value="single">単一フォーム</option>
            <option value="all">選択中フォームすべて (横断)</option>
          </select>
        </label>
        {sourceMode === "single" && (
          <label className="nf-text-13">
            フォーム:
            <select value={formId} onChange={(e) => onUpdate({ formId: e.target.value })} className="nf-ml-4">
              {selectedFormIds.length === 0 && <option value="">(フォーム未選択)</option>}
              {selectedFormIds.map((id) => (
                <option key={id} value={id}>{formsById[id]?.settings?.formTitle || id}</option>
              ))}
            </select>
          </label>
        )}
        <span className="nf-text-subtle nf-text-12">{records.length}件のレコードが渡されます</span>
      </div>
      <textarea
        className="dashboard-code-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        rows={10}
        style={{ width: "100%", fontFamily: "monospace", fontSize: 13 }}
      />
      <div className="nf-row nf-gap-8 nf-mt-8">
        <button type="button" className="nf-btn-outline nf-text-13" onClick={run}>実行</button>
        <button type="button" className="nf-btn-outline nf-text-13" onClick={() => setDraft(SAMPLE_CODE)}>
          サンプルを挿入
        </button>
      </div>
      <div className="nf-mt-12">
        {result == null ? (
          <p className="nf-text-subtle nf-text-13">「実行」を押すと、戻り値の spec を描画します。</p>
        ) : !result.ok ? (
          <pre className="nf-text-danger nf-text-13 nf-pre-wrap">{result.error}</pre>
        ) : (
          <SpecRenderer spec={result.spec} />
        )}
      </div>
    </div>
  );
}

function SpecRenderer({ spec }) {
  if (!spec) return null;
  if (spec.kind === "text") {
    return <pre className="nf-text-13 nf-pre-wrap">{spec.message}</pre>;
  }
  if (spec.kind === "chart") {
    return <ChartFromSpec spec={spec} />;
  }
  if (spec.kind === "table") {
    return <TableFromSpec spec={spec} />;
  }
  return (
    <pre className="nf-text-13 nf-pre-wrap">
      未知の spec.kind: {String(spec.kind)} {"\n"}
      {JSON.stringify(spec, null, 2)}
    </pre>
  );
}

function ChartFromSpec({ spec }) {
  if (!Array.isArray(spec.data) || spec.data.length === 0) {
    return <p className="nf-text-subtle">データがありません</p>;
  }
  return (
    <div>
      {spec.title && <h4 className="nf-mt-0 nf-mb-8 nf-text-13">{spec.title}</h4>}
      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer>
          {spec.type === "pie" ? (
            <PieChart>
              <Pie data={spec.data} nameKey={spec.nameKey} dataKey={spec.valueKey} outerRadius={120} label>
                {spec.data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          ) : spec.type === "line" ? (
            <LineChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={spec.xKey} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey={spec.yKey} stroke={CHART_COLORS[0]} dot={false} />
            </LineChart>
          ) : (
            <BarChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={spec.xKey} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey={spec.yKey} fill={CHART_COLORS[0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TableFromSpec({ spec }) {
  const columns = Array.isArray(spec.columns) && spec.columns.length > 0
    ? spec.columns
    : (spec.rows[0] ? Object.keys(spec.rows[0]) : []);
  if (columns.length === 0) {
    return <p className="nf-text-subtle">列が定義されていません</p>;
  }
  return (
    <div>
      {spec.title && <h4 className="nf-mt-0 nf-mb-8 nf-text-13">{spec.title}</h4>}
      <div className="search-table-wrap">
        <table className="search-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={typeof col === "string" ? col : col.key} className="search-th">
                  {typeof col === "string" ? col : (col.label || col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => {
                  const key = typeof col === "string" ? col : col.key;
                  const val = row?.[key];
                  return <td key={key} className="search-td">{val === null || val === undefined ? "" : String(val)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

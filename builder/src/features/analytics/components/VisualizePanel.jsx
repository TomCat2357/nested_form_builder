import React from "react";
import ChartRenderer from "./ChartRenderer.jsx";
import { CHART_AXIS_REQUIREMENTS } from "../utils/suggestChartType.js";

const VIZ_TYPES = [
  { value: "table", label: "テーブル" },
  { value: "scalar", label: "単一値" },
  { value: "bar", label: "棒グラフ" },
  { value: "line", label: "折れ線グラフ" },
  { value: "pie", label: "円グラフ" },
  { value: "scatter", label: "散布図" },
];

/**
 * クエリ実行結果に対する可視化選択 + チャート描画。
 * クエリ組み立て（StagesPanel / SQL textarea）からは独立。
 */
export default function VisualizePanel({
  vizType,
  xField,
  yFields,
  onVizTypeChange,
  onXFieldChange,
  onYFieldsChange,
  result,
  viz,
}) {
  if (!result) return null;

  const req = CHART_AXIS_REQUIREMENTS[vizType] || CHART_AXIS_REQUIREMENTS.table;
  const xLabel = req.xLabel || "X 軸";
  const yLabel = req.yLabel || (req.y === "single" ? "値の列" : "Y 軸（カンマ区切り）");
  const availableColumns = Array.isArray(result.columns) ? result.columns : [];
  const datalistId = "viz-cols-" + (availableColumns.length || 0);

  return (
    <div>
      <label className="nf-label">可視化</label>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "10px" }}>
        <div>
          <span style={{ fontSize: "12px", marginRight: "6px" }}>グラフ種別</span>
          <select className="nf-input" value={vizType} onChange={(e) => onVizTypeChange(e.target.value)}>
            {VIZ_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        {req.x && (
          <div>
            <span style={{ fontSize: "12px", marginRight: "6px" }}>{xLabel}</span>
            {availableColumns.length > 0 ? (
              <select
                className="nf-input"
                value={xField}
                onChange={(e) => onXFieldChange(e.target.value)}
                style={{ minWidth: "140px" }}
              >
                <option value="">列を選択...</option>
                {availableColumns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <input
                className="nf-input"
                type="text"
                value={xField}
                onChange={(e) => onXFieldChange(e.target.value)}
                placeholder="列名"
                style={{ width: "120px" }}
              />
            )}
          </div>
        )}
        {req.y && (
          <div>
            <span style={{ fontSize: "12px", marginRight: "6px" }}>{yLabel}</span>
            <input
              className="nf-input"
              type="text"
              value={yFields}
              onChange={(e) => onYFieldsChange(e.target.value)}
              placeholder={req.y === "single" ? "a_1" : "count,total"}
              style={{ width: "200px" }}
              list={availableColumns.length > 0 ? datalistId : undefined}
            />
            {availableColumns.length > 0 && (
              <datalist id={datalistId}>
                {availableColumns.map((c) => <option key={c} value={c} />)}
              </datalist>
            )}
          </div>
        )}
      </div>

      <div style={{ border: "1px solid var(--nf-border)", borderRadius: "4px", padding: "12px" }}>
        <ChartRenderer viz={viz} rows={result.rows} columns={result.columns} />
      </div>
      <p className="nf-text-subtle" style={{ marginTop: "6px" }}>
        {result.rows.length} 行
      </p>
    </div>
  );
}

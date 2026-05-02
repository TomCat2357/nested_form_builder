import React, { useMemo } from "react";
import { pivot } from "../aggregate.js";
import { collectAggregatableFields, filterFieldsByKind, FIELD_KIND } from "../fieldTypeUtil.js";

const AGGREGATORS = [
  { value: "count", label: "件数" },
  { value: "sum", label: "合計" },
  { value: "mean", label: "平均" },
];

const formatCell = (value, aggregator) => {
  if (value === null || value === undefined) return "—";
  if (aggregator === "mean" && typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
};

export default function PivotTableWidget({ widget, formsById, recordsByForm, selectedFormIds, onUpdate }) {
  const config = widget.config || {};
  const formId = widget.formId || selectedFormIds[0] || "";
  const form = formsById[formId];
  const records = recordsByForm[formId]?.entries || [];

  const allFields = useMemo(() => collectAggregatableFields(form), [form]);
  const categoricalFields = useMemo(
    () => filterFieldsByKind(allFields, [FIELD_KIND.CATEGORICAL, FIELD_KIND.TEXT]),
    [allFields],
  );
  const numericFields = useMemo(() => filterFieldsByKind(allFields, [FIELD_KIND.NUMERIC]), [allFields]);

  const rowField = config.rowField || categoricalFields[0]?.path || "";
  const colField = config.colField || categoricalFields[1]?.path || categoricalFields[0]?.path || "";
  const aggregator = config.aggregator || "count";
  const valuePath = config.valuePath || numericFields[0]?.path || "";

  const result = useMemo(() => {
    if (!rowField || !colField) return null;
    return pivot(records, rowField, colField, {
      valueAggregator: aggregator,
      valuePath: aggregator === "count" ? null : valuePath,
    });
  }, [records, rowField, colField, aggregator, valuePath]);

  return (
    <div className="dashboard-widget-body">
      <div className="nf-row nf-gap-8 nf-flex-wrap nf-mb-8">
        <label className="nf-text-13">
          フォーム:
          <select value={formId} onChange={(e) => onUpdate({ formId: e.target.value })} className="nf-ml-4">
            {selectedFormIds.length === 0 && <option value="">(フォーム未選択)</option>}
            {selectedFormIds.map((id) => (
              <option key={id} value={id}>{formsById[id]?.settings?.formTitle || id}</option>
            ))}
          </select>
        </label>
        <label className="nf-text-13">
          行:
          <select
            value={rowField}
            onChange={(e) => onUpdate({ config: { ...config, rowField: e.target.value } })}
            className="nf-ml-4"
          >
            {categoricalFields.length === 0 && <option value="">(なし)</option>}
            {categoricalFields.map((f) => (
              <option key={f.path} value={f.path}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="nf-text-13">
          列:
          <select
            value={colField}
            onChange={(e) => onUpdate({ config: { ...config, colField: e.target.value } })}
            className="nf-ml-4"
          >
            {categoricalFields.length === 0 && <option value="">(なし)</option>}
            {categoricalFields.map((f) => (
              <option key={f.path} value={f.path}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="nf-text-13">
          集計:
          <select
            value={aggregator}
            onChange={(e) => onUpdate({ config: { ...config, aggregator: e.target.value } })}
            className="nf-ml-4"
          >
            {AGGREGATORS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        {aggregator !== "count" && (
          <label className="nf-text-13">
            値:
            <select
              value={valuePath}
              onChange={(e) => onUpdate({ config: { ...config, valuePath: e.target.value } })}
              className="nf-ml-4"
            >
              {numericFields.length === 0 && <option value="">(なし)</option>}
              {numericFields.map((f) => (
                <option key={f.path} value={f.path}>{f.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!result || result.rows.length === 0 ? (
        <p className="nf-text-subtle">データがありません</p>
      ) : (
        <div className="search-table-wrap">
          <table className="search-table">
            <thead>
              <tr>
                <th className="search-th"></th>
                {result.cols.map((col) => (
                  <th key={col} className="search-th">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row}>
                  <th className="search-th">{row}</th>
                  {result.cols.map((col) => (
                    <td key={col} className="search-td">{formatCell(result.cells[row][col], aggregator)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

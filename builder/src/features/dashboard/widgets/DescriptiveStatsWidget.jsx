import React, { useMemo } from "react";
import { describeNumeric } from "../aggregate.js";
import { collectAggregatableFields, filterFieldsByKind, FIELD_KIND } from "../fieldTypeUtil.js";

const STAT_LABELS = [
  ["count", "件数"],
  ["nullCount", "未回答"],
  ["min", "最小"],
  ["max", "最大"],
  ["mean", "平均"],
  ["median", "中央値"],
  ["p25", "25%"],
  ["p75", "75%"],
  ["sum", "合計"],
];

const formatNumber = (n) => {
  if (n === null || n === undefined) return "—";
  if (typeof n !== "number") return String(n);
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
};

export default function DescriptiveStatsWidget({ widget, formsById, recordsByForm, selectedFormIds, onUpdate }) {
  const config = widget.config || {};
  const formId = widget.formId || selectedFormIds[0] || "";
  const form = formsById[formId];
  const records = recordsByForm[formId]?.entries || [];

  const numericFields = useMemo(
    () => filterFieldsByKind(collectAggregatableFields(form), [FIELD_KIND.NUMERIC]),
    [form],
  );

  const selectedPaths = Array.isArray(config.fieldPaths) && config.fieldPaths.length > 0
    ? config.fieldPaths
    : numericFields.map((f) => f.path);

  const togglePath = (path) => {
    const current = new Set(selectedPaths);
    if (current.has(path)) current.delete(path);
    else current.add(path);
    onUpdate({ config: { ...config, fieldPaths: Array.from(current) } });
  };

  const rows = useMemo(
    () => selectedPaths
      .map((path) => {
        const field = numericFields.find((f) => f.path === path);
        if (!field) return null;
        return { field, stats: describeNumeric(records, path) };
      })
      .filter(Boolean),
    [records, selectedPaths, numericFields],
  );

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
        <span className="nf-text-13 nf-text-muted">対象フィールド:</span>
        {numericFields.length === 0 && (
          <span className="nf-text-subtle nf-text-12">数値フィールドがありません</span>
        )}
        {numericFields.map((f) => (
          <label key={f.path} className="nf-text-13">
            <input
              type="checkbox"
              checked={selectedPaths.includes(f.path)}
              onChange={() => togglePath(f.path)}
            />
            <span className="nf-ml-4">{f.label}</span>
          </label>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="nf-text-subtle">データがありません</p>
      ) : (
        <div className="search-table-wrap">
          <table className="search-table">
            <thead>
              <tr>
                <th className="search-th">フィールド</th>
                {STAT_LABELS.map(([key, label]) => (
                  <th key={key} className="search-th">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ field, stats }) => (
                <tr key={field.path}>
                  <th className="search-th">{field.label}</th>
                  {STAT_LABELS.map(([key]) => (
                    <td key={key} className="search-td">{formatNumber(stats[key])}</td>
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

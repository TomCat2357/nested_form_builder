import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { groupBy } from "../aggregate.js";
import { collectAggregatableFields, filterFieldsByKind, FIELD_KIND } from "../fieldTypeUtil.js";
import { CHART_COLORS } from "../chartColors.js";

const MODE_OPTIONS = [
  { value: "bar", label: "棒グラフ" },
  { value: "pie", label: "円グラフ" },
];

export default function BarPieChartWidget({ widget, formsById, recordsByForm, selectedFormIds, onUpdate }) {
  const config = widget.config || {};
  const formId = widget.formId || selectedFormIds[0] || "";
  const form = formsById[formId];
  const records = recordsByForm[formId]?.entries || [];

  const aggregatableFields = useMemo(
    () => filterFieldsByKind(collectAggregatableFields(form), [FIELD_KIND.CATEGORICAL, FIELD_KIND.TEXT]),
    [form],
  );

  const fieldPath = config.fieldPath || aggregatableFields[0]?.path || "";
  const mode = config.mode || "bar";

  const data = useMemo(() => {
    if (!fieldPath) return [];
    return groupBy(records, fieldPath).map((row) => ({ name: row.key, value: row.count }));
  }, [records, fieldPath]);

  return (
    <div className="dashboard-widget-body">
      <div className="nf-row nf-gap-8 nf-flex-wrap nf-mb-8">
        <label className="nf-text-13">
          フォーム:
          <select
            value={formId}
            onChange={(e) => onUpdate({ formId: e.target.value })}
            className="nf-ml-4"
          >
            {selectedFormIds.length === 0 && <option value="">(フォーム未選択)</option>}
            {selectedFormIds.map((id) => (
              <option key={id} value={id}>{formsById[id]?.settings?.formTitle || id}</option>
            ))}
          </select>
        </label>
        <label className="nf-text-13">
          フィールド:
          <select
            value={fieldPath}
            onChange={(e) => onUpdate({ config: { ...config, fieldPath: e.target.value } })}
            className="nf-ml-4"
          >
            {aggregatableFields.length === 0 && <option value="">(集計可能なフィールドなし)</option>}
            {aggregatableFields.map((field) => (
              <option key={field.path} value={field.path}>{field.label} ({field.type})</option>
            ))}
          </select>
        </label>
        <label className="nf-text-13">
          表示:
          <select
            value={mode}
            onChange={(e) => onUpdate({ config: { ...config, mode: e.target.value } })}
            className="nf-ml-4"
          >
            {MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
      </div>
      {data.length === 0 ? (
        <p className="nf-text-subtle">データがありません</p>
      ) : (
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            {mode === "pie" ? (
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" outerRadius={120} label>
                  {data.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            ) : (
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill={CHART_COLORS[0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

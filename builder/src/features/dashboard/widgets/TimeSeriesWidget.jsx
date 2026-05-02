import React, { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { bucketByDate } from "../aggregate.js";
import { collectAggregatableFields, filterFieldsByKind, FIELD_KIND } from "../fieldTypeUtil.js";
import { CHART_COLORS } from "../chartColors.js";

const GRANULARITIES = [
  { value: "day", label: "日" },
  { value: "week", label: "週" },
  { value: "month", label: "月" },
];
const AGGREGATORS = [
  { value: "count", label: "件数" },
  { value: "sum", label: "合計" },
  { value: "mean", label: "平均" },
];

export default function TimeSeriesWidget({ widget, formsById, recordsByForm, selectedFormIds, onUpdate }) {
  const config = widget.config || {};
  const formId = widget.formId || selectedFormIds[0] || "";
  const form = formsById[formId];
  const records = recordsByForm[formId]?.entries || [];

  const allFields = useMemo(() => collectAggregatableFields(form), [form]);
  const dateFields = useMemo(() => filterFieldsByKind(allFields, [FIELD_KIND.TEMPORAL]), [allFields]);
  const numericFields = useMemo(() => filterFieldsByKind(allFields, [FIELD_KIND.NUMERIC]), [allFields]);

  const dateField = config.dateField || dateFields[0]?.path || "";
  const granularity = config.granularity || "day";
  const aggregator = config.aggregator || "count";
  const valuePath = config.valuePath || numericFields[0]?.path || "";

  const data = useMemo(() => {
    if (!dateField) return [];
    return bucketByDate(records, dateField, {
      granularity,
      aggregator,
      valuePath: aggregator === "count" ? null : valuePath,
    });
  }, [records, dateField, granularity, aggregator, valuePath]);

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
          日付フィールド:
          <select
            value={dateField}
            onChange={(e) => onUpdate({ config: { ...config, dateField: e.target.value } })}
            className="nf-ml-4"
          >
            {dateFields.length === 0 && <option value="">(日付フィールドなし)</option>}
            {dateFields.map((f) => (
              <option key={f.path} value={f.path}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="nf-text-13">
          粒度:
          <select
            value={granularity}
            onChange={(e) => onUpdate({ config: { ...config, granularity: e.target.value } })}
            className="nf-ml-4"
          >
            {GRANULARITIES.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
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
            値フィールド:
            <select
              value={valuePath}
              onChange={(e) => onUpdate({ config: { ...config, valuePath: e.target.value } })}
              className="nf-ml-4"
            >
              {numericFields.length === 0 && <option value="">(数値フィールドなし)</option>}
              {numericFields.map((f) => (
                <option key={f.path} value={f.path}>{f.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {data.length === 0 ? (
        <p className="nf-text-subtle">データがありません</p>
      ) : (
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="value" stroke={CHART_COLORS[0]} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

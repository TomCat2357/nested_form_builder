import React from "react";

/**
 * ダッシュボード共通フィルタの操作 UI。
 * dateRange / category / text / number / numberRange に対応する。
 */

function DateRangeInput({ value, onChange }) {
  const v = value || { from: null, to: null };
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input
        type="date"
        className="nf-input"
        value={v.from || ""}
        onChange={(e) => onChange({ ...v, from: e.target.value || null })}
        style={{ fontSize: 12, padding: "2px 6px" }}
      />
      <span className="nf-text-subtle" style={{ fontSize: 12 }}>〜</span>
      <input
        type="date"
        className="nf-input"
        value={v.to || ""}
        onChange={(e) => onChange({ ...v, to: e.target.value || null })}
        style={{ fontSize: 12, padding: "2px 6px" }}
      />
    </span>
  );
}

function NumberRangeInput({ value, onChange }) {
  const v = value || { min: null, max: null };
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input
        type="number"
        className="nf-input"
        value={v.min ?? ""}
        onChange={(e) => onChange({ ...v, min: e.target.value === "" ? null : Number(e.target.value) })}
        placeholder="min"
        style={{ width: 80, fontSize: 12, padding: "2px 6px" }}
      />
      <span className="nf-text-subtle" style={{ fontSize: 12 }}>〜</span>
      <input
        type="number"
        className="nf-input"
        value={v.max ?? ""}
        onChange={(e) => onChange({ ...v, max: e.target.value === "" ? null : Number(e.target.value) })}
        placeholder="max"
        style={{ width: 80, fontSize: 12, padding: "2px 6px" }}
      />
    </span>
  );
}

function CategoryInput({ filter, value, onChange }) {
  const opts = filter.options?.values || [];
  const multi = !!filter.options?.multi;
  if (multi) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <select
        className="nf-input"
        multiple
        value={selected}
        onChange={(e) => {
          const arr = Array.from(e.target.selectedOptions).map((o) => o.value);
          onChange(arr);
        }}
        style={{ fontSize: 12, minWidth: 120, padding: "2px 6px" }}
      >
        {opts.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
      </select>
    );
  }
  return (
    <select
      className="nf-input"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      style={{ fontSize: 12, padding: "2px 6px" }}
    >
      <option value="">(指定なし)</option>
      {opts.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
    </select>
  );
}

function FilterInput({ filter, value, onChange }) {
  switch (filter.type) {
    case "dateRange": return <DateRangeInput value={value} onChange={onChange} />;
    case "numberRange": return <NumberRangeInput value={value} onChange={onChange} />;
    case "category": return <CategoryInput filter={filter} value={value} onChange={onChange} />;
    case "text":
      return (
        <input
          type="text"
          className="nf-input"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="(部分一致)"
          style={{ fontSize: 12, padding: "2px 6px", minWidth: 140 }}
        />
      );
    case "number":
      return (
        <input
          type="number"
          className="nf-input"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          style={{ fontSize: 12, width: 100, padding: "2px 6px" }}
        />
      );
    default:
      return null;
  }
}

export default function DashboardFilterBar({ filters, values, onChange }) {
  if (!filters || filters.length === 0) return null;

  const handleChange = (filterId, v) => {
    onChange({ ...(values || {}), [filterId]: v });
  };

  return (
    <div
      className="nf-card"
      style={{
        padding: "8px 12px",
        marginBottom: 12,
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        alignItems: "center",
      }}
    >
      {filters.map((f) => (
        <div key={f.id} style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 11 }} className="nf-text-subtle">{f.label || f.id}</span>
          <FilterInput
            filter={f}
            value={values ? values[f.id] : undefined}
            onChange={(v) => handleChange(f.id, v)}
          />
        </div>
      ))}
    </div>
  );
}

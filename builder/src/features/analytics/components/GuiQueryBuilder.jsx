import React, { useMemo } from "react";
import { traverseSchema } from "../../../core/schemaUtils.js";
import {
  AGG_TYPE_MATRIX,
  FIXED_DATE_KEYS,
  isAggCompatible,
  resolveColumnType,
} from "../utils/aggregationCompatibility.js";

const AGG_LABELS = {
  count: "件数 (COUNT *)",
  countNotNull: "非空件数",
  sum: "合計",
  avg: "平均",
  min: "最小",
  max: "最大",
};

const AGG_OPTIONS = Object.keys(AGG_LABELS).map((value) => ({
  value,
  label: AGG_LABELS[value],
  needsColumn: AGG_TYPE_MATRIX[value].columnRequired,
  allowedTypes: AGG_TYPE_MATRIX[value].allowedTypes,
}));

const OPERATOR_OPTIONS = [
  { value: "=", label: "等しい" },
  { value: "!=", label: "等しくない" },
  { value: ">", label: "より大きい" },
  { value: ">=", label: "以上" },
  { value: "<", label: "より小さい" },
  { value: "<=", label: "以下" },
  { value: "between", label: "範囲内" },
  { value: "contains", label: "含む" },
  { value: "startsWith", label: "で始まる" },
  { value: "isNull", label: "空である" },
  { value: "isNotNull", label: "空でない" },
];

const BUCKET_OPTIONS = [
  { value: "", label: "そのまま" },
  { value: "year", label: "年単位" },
  { value: "month", label: "月単位" },
  { value: "day", label: "日単位" },
];

function buildColumnTypeMap(form) {
  const map = new Map();
  if (!form || !Array.isArray(form.schema)) return map;
  traverseSchema(form.schema, (field, ctx) => {
    const pipePath = (ctx?.pathSegments || []).join("|");
    if (!pipePath) return;
    if (!map.has(pipePath)) map.set(pipePath, field.type);
  });
  return map;
}

function getColumnType(snapshotColumns, typeMap, key) {
  // snapshotColumns 由来の type を優先（analyticsStore 側で正規化済み）
  if (Array.isArray(snapshotColumns)) {
    const c = snapshotColumns.find((x) => x.key === key);
    if (c && c.type) return c.type;
  }
  return resolveColumnType(typeMap, key);
}

function isDateColumn(snapshotColumns, typeMap, key) {
  return getColumnType(snapshotColumns, typeMap, key) === "date";
}

function nextAggId(aggs) {
  let n = 1;
  const used = new Set((aggs || []).map((a) => a.id));
  while (used.has("a_" + n)) n++;
  return "a_" + n;
}

function nextFilterId(filters) {
  let n = 1;
  const used = new Set((filters || []).map((f) => f.id));
  while (used.has("f_" + n)) n++;
  return "f_" + n;
}

export default function GuiQueryBuilder({ gui, onChange, snapshotColumns, form, activeForms, onFormChange }) {
  const typeMap = useMemo(() => buildColumnTypeMap(form), [form]);

  const update = (patch) => onChange({ ...gui, ...patch });

  const updateAggregation = (id, patch) => {
    update({
      aggregations: gui.aggregations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  };
  const removeAggregation = (id) => {
    update({ aggregations: gui.aggregations.filter((a) => a.id !== id) });
  };
  const addAggregation = () => {
    update({
      aggregations: gui.aggregations.concat([{ id: nextAggId(gui.aggregations), type: "count" }]),
    });
  };

  const updateGroup = (i, patch) => {
    update({ groupBy: gui.groupBy.map((g, idx) => (idx === i ? { ...g, ...patch } : g)) });
  };
  const removeGroup = (i) => {
    update({ groupBy: gui.groupBy.filter((_g, idx) => idx !== i) });
  };
  const addGroup = () => {
    update({ groupBy: gui.groupBy.concat([{ column: "" }]) });
  };

  const updateFilter = (id, patch) => {
    update({ filters: gui.filters.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  };
  const removeFilter = (id) => {
    update({ filters: gui.filters.filter((f) => f.id !== id) });
  };
  const addFilter = () => {
    update({
      filters: gui.filters.concat([{ id: nextFilterId(gui.filters), column: "", operator: "=", value: "" }]),
    });
  };

  const handleFormSelect = (e) => {
    const newId = e.target.value;
    if (newId === gui.formId) return;
    const hasState = gui.aggregations.length > 1
      || gui.groupBy.length > 0
      || gui.filters.length > 0
      || (gui.aggregations[0] && gui.aggregations[0].type !== "count");
    if (hasState) {
      const ok = window.confirm("フォームを変更すると現在の集計・グループ化・フィルターはリセットされます。続行しますか？");
      if (!ok) return;
    }
    onFormChange(newId);
  };

  const renderColumnSelect = (value, onChangeFn, allowedTypes) => {
    const options = allowedTypes
      ? snapshotColumns.filter((c) => {
          const t = getColumnType(snapshotColumns, typeMap, c.key);
          // 型が不明な列は許可（snapshot に type が無いケース・固定外列）
          if (!t || t === "unknown") return true;
          return allowedTypes.includes(t);
        })
      : snapshotColumns;
    return (
      <select className="nf-input" value={value || ""} onChange={(e) => onChangeFn(e.target.value)} style={{ minWidth: 180 }}>
        <option value="">列を選択...</option>
        {options.map((c) => (
          <option key={c.key} value={c.key}>{c.key}</option>
        ))}
      </select>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section>
        <label className="nf-label">データソース（単一フォーム）</label>
        <select className="nf-input" value={gui.formId || ""} onChange={handleFormSelect} style={{ maxWidth: 400 }}>
          <option value="">フォームを選択...</option>
          {activeForms.map((f) => (
            <option key={f.id} value={f.id}>{f.settings?.formTitle || f.id}</option>
          ))}
        </select>
      </section>

      {gui.formId && (
        <>
          <section>
            <label className="nf-label">集計</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {gui.aggregations.map((agg) => {
                const def = AGG_OPTIONS.find((o) => o.value === agg.type);
                const needsColumn = def?.needsColumn;
                // 現在の列が新しい集計種別と非互換なら列を解除する
                const handleAggTypeChange = (e) => {
                  const newType = e.target.value;
                  const newDef = AGG_OPTIONS.find((o) => o.value === newType);
                  let nextColumn = agg.column;
                  if (newType === "count" || !newDef?.needsColumn) {
                    nextColumn = undefined;
                  } else if (agg.column && newDef?.allowedTypes) {
                    const t = getColumnType(snapshotColumns, typeMap, agg.column);
                    if (t && t !== "unknown" && !newDef.allowedTypes.includes(t)) {
                      nextColumn = undefined;
                    }
                  }
                  updateAggregation(agg.id, { type: newType, column: nextColumn });
                };
                return (
                  <div key={agg.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <select
                      className="nf-input"
                      value={agg.type}
                      onChange={handleAggTypeChange}
                    >
                      {AGG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {needsColumn && renderColumnSelect(agg.column, (v) => updateAggregation(agg.id, { column: v }), def?.allowedTypes)}
                    <button type="button" className="nf-btn-outline" onClick={() => removeAggregation(agg.id)} disabled={gui.aggregations.length <= 1}>削除</button>
                  </div>
                );
              })}
              <div>
                <button type="button" className="nf-btn-outline" onClick={addAggregation}>+ 集計を追加</button>
              </div>
            </div>
          </section>

          <section>
            <label className="nf-label">グループ化</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {gui.groupBy.map((g, i) => {
                const isDate = isDateColumn(snapshotColumns, typeMap, g.column);
                return (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {renderColumnSelect(g.column, (v) => updateGroup(i, { column: v, bucket: undefined }))}
                    {isDate && (
                      <select className="nf-input" value={g.bucket || ""} onChange={(e) => updateGroup(i, { bucket: e.target.value || undefined })}>
                        {BUCKET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    )}
                    <button type="button" className="nf-btn-outline" onClick={() => removeGroup(i)}>削除</button>
                  </div>
                );
              })}
              <div>
                <button type="button" className="nf-btn-outline" onClick={addGroup}>+ グループ化を追加</button>
              </div>
            </div>
          </section>

          <section>
            <label className="nf-label">フィルター</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {gui.filters.map((f) => {
                const showValue = f.operator !== "isNull" && f.operator !== "isNotNull";
                const showSecond = f.operator === "between";
                return (
                  <div key={f.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {renderColumnSelect(f.column, (v) => updateFilter(f.id, { column: v }))}
                    <select className="nf-input" value={f.operator} onChange={(e) => updateFilter(f.id, { operator: e.target.value })}>
                      {OPERATOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {showValue && (
                      <input
                        className="nf-input"
                        type="text"
                        value={f.value ?? ""}
                        onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                        placeholder="値"
                        style={{ width: 140 }}
                      />
                    )}
                    {showSecond && (
                      <input
                        className="nf-input"
                        type="text"
                        value={f.value2 ?? ""}
                        onChange={(e) => updateFilter(f.id, { value2: e.target.value })}
                        placeholder="上限"
                        style={{ width: 140 }}
                      />
                    )}
                    <button type="button" className="nf-btn-outline" onClick={() => removeFilter(f.id)}>削除</button>
                  </div>
                );
              })}
              <div>
                <button type="button" className="nf-btn-outline" onClick={addFilter}>+ フィルターを追加</button>
              </div>
            </div>
          </section>

          <section>
            <label className="nf-label">上限行数（任意）</label>
            <input
              className="nf-input"
              type="number"
              min="1"
              value={gui.limit ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                update({ limit: v === "" ? null : Math.max(1, Number(v)) });
              }}
              placeholder="未指定"
              style={{ width: 120 }}
            />
          </section>
        </>
      )}
    </div>
  );
}

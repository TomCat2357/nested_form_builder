import React from "react";
import { AGG_TYPE_MATRIX, ALL_COLUMNS_TOKEN, resolveColumnType } from "../utils/aggregationCompatibility.js";
import SearchableSelect from "../../../app/components/SearchableSelect.jsx";
import { formsToOptions } from "../../../app/components/searchableSelectOptions.js";

const AGG_LABELS = {
  count: "件数 (COUNT *)",
  countNotNull: "非空件数",
  sum: "合計",
  avg: "平均",
  min: "最小",
  max: "最大",
  raw: "集計なし (生データ)",
};

const AGG_OPTIONS = Object.keys(AGG_LABELS).map((value) => ({
  value,
  label: AGG_LABELS[value],
  needsColumn: AGG_TYPE_MATRIX[value].columnRequired,
  allowedTypes: AGG_TYPE_MATRIX[value].allowedTypes,
  isRawMode: !!AGG_TYPE_MATRIX[value].isRawMode,
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

function getColumnType(formColumns, key) {
  if (!Array.isArray(formColumns)) return "unknown";
  return resolveColumnType((k) => {
    const c = formColumns.find((x) => x.key === k);
    return c && c.type;
  }, key);
}

function isDateColumn(formColumns, key) {
  return getColumnType(formColumns, key) === "date";
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

export default function GuiQueryBuilder({ gui, onChange, formColumns, activeForms, onFormChange }) {
  const hasRaw = Array.isArray(gui.aggregations) && gui.aggregations.some((a) => a && a.type === "raw");

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

  const renderColumnSelect = (value, onChangeFn, allowedTypes, includeAllOption) => {
    const options = allowedTypes
      ? formColumns.filter((c) => {
          const t = getColumnType(formColumns, c.key);
          // 型が不明な列は許可（formColumns に type が無いケース・固定外列）
          if (!t || t === "unknown") return true;
          return allowedTypes.includes(t);
        })
      : formColumns;
    return (
      <select className="nf-input" value={value || ""} onChange={(e) => onChangeFn(e.target.value)} style={{ minWidth: 180 }}>
        <option value="">列を選択...</option>
        {includeAllOption && <option value={ALL_COLUMNS_TOKEN}>全列対象</option>}
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
        <SearchableSelect
          value={gui.formId || ""}
          onChange={(value) => handleFormSelect({ target: { value } })}
          placeholder="フォームを選択..."
          options={formsToOptions(activeForms)}
          style={{ maxWidth: 400 }}
        />
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
                  // raw mode を選んだときは集計欄を 1 行 (raw のみ) に強制し、グループ化もクリア。
                  if (newDef?.isRawMode) {
                    update({ aggregations: [{ id: agg.id, type: "raw" }], groupBy: [] });
                    return;
                  }
                  let nextColumn = agg.column;
                  if (newType === "count" || !newDef?.needsColumn) {
                    nextColumn = undefined;
                  } else if (agg.column === ALL_COLUMNS_TOKEN) {
                    // 「全列対象」は列必須種別どうしの切替で維持（展開時に互換列のみ絞られる）
                    nextColumn = ALL_COLUMNS_TOKEN;
                  } else if (agg.column && newDef?.allowedTypes) {
                    const t = getColumnType(formColumns, agg.column);
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
                    {needsColumn && renderColumnSelect(agg.column, (v) => updateAggregation(agg.id, { column: v || undefined }), def?.allowedTypes, true)}
                    {needsColumn && agg.column === ALL_COLUMNS_TOKEN && (
                      <span className="nf-text-subtle" style={{ fontSize: 12 }}>互換性のある全列を集計します</span>
                    )}
                    <button type="button" className="nf-btn-outline" onClick={() => removeAggregation(agg.id)} disabled={gui.aggregations.length <= 1}>削除</button>
                  </div>
                );
              })}
              {!hasRaw && (
                <div>
                  <button type="button" className="nf-btn-outline" onClick={addAggregation}>+ 集計を追加</button>
                </div>
              )}
              {hasRaw && (
                <p className="nf-text-subtle" style={{ fontSize: 12, margin: 0 }}>
                  生データモード：行ごとの値をそのまま取得します（グループ化は無効）。散布図やテーブル可視化向け。
                </p>
              )}
            </div>
          </section>

          {!hasRaw && (
          <section>
            <label className="nf-label">グループ化</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {gui.groupBy.map((g, i) => {
                const isDate = isDateColumn(formColumns, g.column);
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
          )}

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

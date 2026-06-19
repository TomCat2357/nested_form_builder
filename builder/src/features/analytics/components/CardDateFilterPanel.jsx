import { ensureArray } from "../../../utils/arrays.js";
import React, { useMemo } from "react";
import { detectColumnType } from "../utils/columnValueInference.js";
import { filterDisplayColumns, getColumnDisplayLabel } from "../utils/metaColumnDisplay.js";
import { datePresets, timePresets, inferRangeKind } from "../utils/dateRangePresets.js";

const DATE_PRESETS = datePresets();
const TIME_PRESETS = timePresets();

// 期間フィルタの候補にできる列を返す。表示列の日付型（date / datetime / time フィールドは
// analytics 上ではすべて "date" に正規化される）に加え、作成日時 (createdAt) も許可する。
export function getDateColumns(columns, compiledColumns, fallbackTypeMap) {
  const cols = ensureArray(columns);
  const candidates = new Set(filterDisplayColumns(cols));
  if (cols.includes("createdAt")) candidates.add("createdAt");
  return cols.filter((c) => c !== "deletedAt" && candidates.has(c)
    && detectColumnType(compiledColumns, c, fallbackTypeMap || null) === "date");
}

function dateColLabel(col, compiledColumns) {
  if (col === "createdAt") return "作成日時";
  return getColumnDisplayLabel(col, compiledColumns);
}

/**
 * 閲覧者がカードに一時的にかける期間フィルタの UI。
 * 元の Question / Dashboard は変更しない。
 *
 * 選んだ列が日付系か時刻系かを結果行の値から判定し、日付列なら日付ピッカー＋日付プリセット、
 * 時刻列なら時刻ピッカー＋時刻プリセットに自動で切り替える。
 *
 * props:
 *   columns / compiledColumns / fallbackTypeMap … 日付系列の判定用
 *   rows … 結果行（列が日付か時刻かの sniff に使う）
 *   dateFilter … 現在の { column, kind, from, to } または null
 *   onChange(next | null) … フィルタ更新（null で解除）
 */
export default function CardDateFilterPanel({ columns, compiledColumns, fallbackTypeMap, rows, dateFilter, onChange }) {
  const dateColumns = useMemo(
    () => getDateColumns(columns, compiledColumns, fallbackTypeMap),
    [columns, compiledColumns, fallbackTypeMap]
  );

  if (dateColumns.length === 0) {
    return <p className="nf-text-subtle" style={{ fontSize: 12, margin: 0 }}>日付・時刻の列がありません。</p>;
  }

  const column = dateFilter?.column && dateColumns.includes(dateFilter.column) ? dateFilter.column : dateColumns[0];
  const kind = (dateFilter?.kind === "time" || dateFilter?.kind === "date")
    ? dateFilter.kind
    : inferRangeKind(rows, column);
  const from = dateFilter?.from || "";
  const to = dateFilter?.to || "";

  const isTime = kind === "time";
  const presets = isTime ? TIME_PRESETS : DATE_PRESETS;
  const inputType = isTime ? "time" : "date";

  const emit = (next) => {
    if (!next || (!next.from && !next.to)) { onChange(null); return; }
    onChange({ column: next.column || column, kind: next.kind || kind, from: next.from || null, to: next.to || null });
  };

  const handleColumnChange = (newColumn) => {
    const newKind = inferRangeKind(rows, newColumn);
    const keep = newKind === kind;
    // 列を変えると日付↔時刻で入力欄の型が変わりうるため、型が変わる場合は from/to をクリアする。
    // 列だけは選択状態を保てるよう、範囲が空でも column+kind を持つオブジェクトを emit する。
    onChange({
      column: newColumn,
      kind: newKind,
      from: keep ? (from || null) : null,
      to: keep ? (to || null) : null,
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 240 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>対象列</span>
        <select
          className="nf-input"
          value={column}
          onChange={(e) => handleColumnChange(e.target.value)}
          style={{ fontSize: 12, flex: 1 }}
        >
          {dateColumns.map((c) => <option key={c} value={c}>{dateColLabel(c, compiledColumns)}</option>)}
        </select>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            className="nf-btn-outline"
            style={{ fontSize: 11, padding: "2px 8px" }}
            onClick={() => { const r = p.range(); emit({ column, kind, from: r.from, to: r.to }); }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          開始
          <input className="nf-input" type={inputType} value={from} onChange={(e) => emit({ column, kind, from: e.target.value, to })} style={{ fontSize: 12 }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          終了
          <input className="nf-input" type={inputType} value={to} onChange={(e) => emit({ column, kind, from, to: e.target.value })} style={{ fontSize: 12 }} />
        </label>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="nf-btn-outline"
          style={{ fontSize: 11, padding: "2px 8px" }}
          disabled={!dateFilter}
          onClick={() => onChange(null)}
        >
          全期間
        </button>
      </div>
    </div>
  );
}

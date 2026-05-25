import React, { useMemo } from "react";
import AxisRangeControls from "./AxisRangeControls.jsx";
import { VIZ_TYPES } from "../utils/suggestChartType.js";
import { detectAxisTypes } from "../utils/axisTypes.js";

/**
 * 閲覧者がカードのグラフ見た目を一時上書きする軽量パネル。
 * 元の Question / Dashboard は変更しない。
 *
 * props:
 *   viz           … 現在の（上書き適用後の）visualization
 *   vizOverride   … 現在の sparse な上書きオブジェクト（{ type?, showLegend?, axis? }）または null
 *   columns / compiledColumns / fallbackTypeMap … 列型判定用
 *   onChange(nextOverride | null) … 上書きを更新（null でリセット）
 */
export default function CardVizOverridePanel({ viz, vizOverride, columns, compiledColumns, fallbackTypeMap, onChange }) {
  const type = viz?.type || "table";

  // 既定の集計結果（yFields 未指定）は数値とみなして Y 軸スケール UI を出す（yTypeWhenEmpty: "number"）。
  const { xAxisType, yAxisType, showAxis, showX, showY, showLegend } = useMemo(
    () => detectAxisTypes({
      type,
      xField: viz?.xField,
      yFields: viz?.yFields,
      columns,
      compiledColumns,
      fallbackTypeMap,
      yTypeWhenEmpty: "number",
    }),
    [type, viz, columns, compiledColumns, fallbackTypeMap]
  );

  const patch = (extra) => onChange({ ...(vizOverride || {}), ...extra });

  const legendOn = viz?.showLegend !== false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 260 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>グラフ種別</span>
        <select
          className="nf-input"
          value={type}
          onChange={(e) => patch({ type: e.target.value })}
          style={{ fontSize: 12, flex: 1 }}
        >
          {VIZ_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {showLegend && (
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={legendOn} onChange={(e) => patch({ showLegend: e.target.checked })} />
          凡例を表示
        </label>
      )}

      {showAxis && (showX || showY) && (
        <AxisRangeControls
          axis={viz?.axis}
          xType={xAxisType}
          yType={yAxisType}
          showX={showX}
          showY={showY}
          onChange={(axis) => patch({ axis })}
        />
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="nf-btn-outline"
          style={{ fontSize: 11, padding: "2px 8px" }}
          disabled={!vizOverride}
          onClick={() => onChange(null)}
        >
          リセット
        </button>
      </div>
    </div>
  );
}

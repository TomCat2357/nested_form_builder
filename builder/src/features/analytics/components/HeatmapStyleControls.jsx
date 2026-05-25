import React from "react";
import { LABEL_STYLE, HEADER_LABEL_STYLE, RESET_BUTTON_STYLE } from "../utils/styleConstants.js";

/**
 * ヒートマップ設定セクション（TableStyleControls のサブ UI）。
 *
 * 方向 / 除外行式 / 除外列リスト / min・max 色 (透明可) を編集する。
 * 親 (TableStyleControls) がレイアウト用に grid を提供しているので、
 * その grid 内にフラットに並ぶ DOM (Fragment) を返す。
 */
const HEATMAP_DIRECTIONS = [
  { value: "column", label: "列ごと" },
  { value: "row", label: "行ごと" },
  { value: "all", label: "テーブル全体" },
];

const HEATMAP_DATALIST_ID = "viz-cols-heatmap-exclude";

function buildSetHeat(heatmap, onHeatmapChange) {
  return (patch) => onHeatmapChange?.({
    enabled: heatmap?.enabled || false,
    direction: heatmap?.direction || "column",
    excludeRows: heatmap?.excludeRows || "",
    excludeColumns: heatmap?.excludeColumns || "",
    minColor: heatmap?.minColor || "",
    maxColor: heatmap?.maxColor || "",
    ...patch,
  });
}

export default function HeatmapStyleControls({ heatmap, onHeatmapChange, availableColumns }) {
  const heatEnabled = !!heatmap?.enabled;
  const setHeat = buildSetHeat(heatmap, onHeatmapChange);

  // 透明扱いを "transparent" 文字列で表す。色ピッカーは透明色を扱えないので
  // 「透明」チェックボックス + カラーピッカーの組合せで UI を作る。空文字は既定 (白→青) 扱い。
  const minColorTransparent = heatmap?.minColor === "transparent";
  const maxColorTransparent = heatmap?.maxColor === "transparent";
  const minColorValue = heatmap?.minColor && !minColorTransparent ? heatmap.minColor : "#ffffff";
  const maxColorValue = heatmap?.maxColor && !maxColorTransparent ? heatmap.maxColor : "#4c7eff";

  const dimmed = { ...LABEL_STYLE, opacity: heatEnabled ? 1 : 0.5 };

  return (
    <>
      <span style={HEADER_LABEL_STYLE}>ヒートマップ:</span>
      <label style={LABEL_STYLE}>
        <input
          type="checkbox"
          checked={heatEnabled}
          onChange={(e) => setHeat({ enabled: e.target.checked })}
          style={{ marginRight: 4 }}
        />
        有効
      </label>
      <label style={dimmed}>
        方向
        <select
          className="nf-input"
          value={heatmap?.direction || "column"}
          disabled={!heatEnabled}
          onChange={(e) => setHeat({ direction: e.target.value })}
          style={{ marginLeft: 4 }}
        >
          {HEATMAP_DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </label>
      <span />

      <span style={HEADER_LABEL_STYLE}>　除外する行:</span>
      <label style={{ ...dimmed, gridColumn: "span 3" }}>
        <input
          className="nf-input"
          type="text"
          value={heatmap?.excludeRows || ""}
          disabled={!heatEnabled}
          placeholder="AlaSQL の WHERE 式（true で除外）。例: _dispRow = 1 OR `項目` = '小計'"
          onChange={(e) => setHeat({ excludeRows: e.target.value })}
          style={{ width: "100%" }}
        />
      </label>

      <span style={HEADER_LABEL_STYLE}>　除外する列:</span>
      <label style={{ ...dimmed, gridColumn: "span 3" }}>
        <input
          className="nf-input"
          type="text"
          value={heatmap?.excludeColumns || ""}
          disabled={!heatEnabled}
          placeholder="カンマ区切り（列名で一致）"
          onChange={(e) => setHeat({ excludeColumns: e.target.value })}
          style={{ width: "100%" }}
          list={HEATMAP_DATALIST_ID}
        />
        <datalist id={HEATMAP_DATALIST_ID}>
          {(availableColumns || []).map((c) => <option key={c} value={c} />)}
        </datalist>
      </label>

      <ColorEndpointRow
        label="　最小値色:"
        heatEnabled={heatEnabled}
        colorValue={minColorValue}
        transparent={minColorTransparent}
        onColorChange={(v) => setHeat({ minColor: v })}
        onTransparentChange={(checked) => setHeat({ minColor: checked ? "transparent" : "" })}
        resetTitle="既定 (白) に戻す"
      />

      <ColorEndpointRow
        label="　最大値色:"
        heatEnabled={heatEnabled}
        colorValue={maxColorValue}
        transparent={maxColorTransparent}
        onColorChange={(v) => setHeat({ maxColor: v })}
        onTransparentChange={(checked) => setHeat({ maxColor: checked ? "transparent" : "" })}
        resetTitle="既定 (青) に戻す"
      />
    </>
  );
}

function ColorEndpointRow({ label, heatEnabled, colorValue, transparent, onColorChange, onTransparentChange, resetTitle }) {
  const dimmed = { ...LABEL_STYLE, opacity: heatEnabled ? 1 : 0.5 };
  return (
    <>
      <span style={HEADER_LABEL_STYLE}>{label}</span>
      <label style={dimmed}>
        <input
          type="color"
          value={colorValue}
          disabled={!heatEnabled || transparent}
          onChange={(e) => onColorChange(e.target.value)}
          style={{ marginRight: 4, verticalAlign: "middle" }}
        />
        <button
          type="button"
          onClick={() => onColorChange("")}
          disabled={!heatEnabled}
          title={resetTitle}
          style={RESET_BUTTON_STYLE}
        >×</button>
      </label>
      <label style={dimmed}>
        <input
          type="checkbox"
          checked={transparent}
          disabled={!heatEnabled}
          onChange={(e) => onTransparentChange(e.target.checked)}
          style={{ marginRight: 4 }}
        />
        透明
      </label>
      <span />
    </>
  );
}
